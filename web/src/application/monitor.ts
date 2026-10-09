// Monitoring session (slots.html startMonitoring(), stopMonitoring(), checkNow(),
// scheduleNextCheck(), resetMonitorState()): state, timers through the Scheduler, planning of the
// next check, events for the extension link. The check itself is run-check.ts.
import type { FreeSlots } from '@/domain/slots/free-slots.ts';
import { clampIntervalBounds, FAST_CHECKS, planNextCheck } from '@/domain/monitoring/schedule.ts';
import type { DateRange, SlotKey } from '@/domain/monitoring/slots-diff.ts';
import type { ReservedSlot } from '@/domain/contracts/econsul.ts';
import { SessionExpiredError } from '@/domain/contracts/errors.ts';
import type { Alerts, AppSession, Clock, EconsulApi, Ids, LocationsSource, NotificationPermissionState, Random, Scheduler, ServerApi, SettingsStore, TimerHandle } from './ports.ts';
import {
    alertSession,
    alertSlots,
    DEFAULT_TITLE,
    runCheck,
    setTabTitle,
    type CheckKind,
    type MonitorLogEntry,
    type MonitorState,
    type RunCheckContext,
    type StopCause,
} from './run-check.ts';

export type { CheckKind, MonitorLogEntry, MonitorState, StopCause };

export type MonitorEvents = {
    newSlots: (fresh: SlotKey[], free: FreeSlots) => void; // after the alert, for app:slots
    authFailed: (status: number, token: string) => void; // for app:auth-failed
    changed: () => void; // after every state change
};

export interface Monitor {
    getState(): MonitorState;
    subscribe(listener: () => void): () => void; // useSyncExternalStore
    on<K extends keyof MonitorEvents>(event: K, listener: MonitorEvents[K]): () => void;
    init(): Promise<void>; // loads locations and saved settings
    start(options?: { resumed?: boolean }): Promise<void>;
    stop(reason: string, cause: StopCause): void;
    checkNow(): Promise<void>;
    setToken(token: string, source: 'extension' | 'manual'): void; // resumes after 'session' stop
    sessionLost(reason: string): void; // ext:auth loggedIn: false
    setSelection(institutionCode: string, serviceCode: string): void;
    setInterval(bounds: { min: number; max: number }): void;
    setFastChecks(enabled: boolean): void;
    setDateRange(range: DateRange): void;
    setTabTitleMarks(on: boolean): void;
    notificationPermission(): NotificationPermissionState;
    requestNotifications(): Promise<NotificationPermissionState>;
    audioReady(): boolean;
    testAlert(kind: 'slots' | 'session'): Promise<void>; // the alert with made-up data, nothing is booked
    log(message: string, kind?: MonitorLogEntry['kind']): void;
    dispose(): void;
}

export type MonitorDeps = {
    econsul: EconsulApi;
    server: ServerApi;
    locations: LocationsSource;
    settings: SettingsStore;
    alerts: Alerts;
    clock: Clock;
    ids: Ids;
    session: AppSession;
    random: Random;
    scheduler: Scheduler;
    extensionConnected: () => boolean; // alertSession(): notification only without the extension
    openBooking: () => void; // click on the new-slots notification
};

const DEFAULT_INSTITUTION = '1000000510'; // Houston
const DEFAULT_SERVICE = '1';
const LOG_LIMIT = 100;
const TEST_SLOTS: SlotKey[] = ['2027-03-31 09:50', '2027-03-31 10:10'];
const TEST_TITLE_RESET_MS = 5000;

type Handlers = { [K in keyof MonitorEvents]: Set<MonitorEvents[K]> };

export function createMonitor(deps: MonitorDeps): Monitor {
    const { econsul, server, settings, alerts, clock, ids, session, random, scheduler } = deps;
    let state: MonitorState = {
        tabTitleMarks: true,
        locations: null,
        selection: null,
        hasToken: false,
        running: false,
        checking: false,
        checks: 0,
        nextAt: 0,
        nextKind: 'scheduled',
        lastResult: '',
        stoppedBy: null,
        interval: clampIntervalBounds(undefined, undefined),
        fastChecks: true,
        dateRange: { from: null, to: null },
        schedule: null,
        reserved: null,
        free: null,
        releases: [],
        outOfRange: null,
        lastFresh: [],
        log: [],
    };
    // The session token lives only here, in memory: never in the state, the log or the settings.
    let token = '';
    let knownFree: ReadonlySet<SlotKey> | null = null;
    let prevReserved: { slots: ReservedSlot[]; at: number } | null = null;
    let timer: TimerHandle | null = null;
    let disposed = false;
    const listeners = new Set<() => void>();
    const handlers: Handlers = { newSlots: new Set(), authFailed: new Set(), changed: new Set() };

    function patch(next: Partial<MonitorState>): void {
        if (disposed) return;
        state = { ...state, ...next };
        listeners.forEach((listener) => listener());
        handlers.changed.forEach((listener) => listener());
    }

    function log(message: string, kind: MonitorLogEntry['kind'] = 'info'): void {
        patch({ log: [{ at: clock.now(), message, kind }, ...state.log].slice(0, LOG_LIMIT) });
    }

    // Called when the institution or service changes: the next check starts from scratch
    function resetMonitorState(): void {
        knownFree = null;
        prevReserved = null;
        patch({
            schedule: null,
            reserved: null,
            free: null,
            releases: [],
            outOfRange: null,
            lastFresh: [],
        });
    }

    function stop(reason: string, cause: StopCause): void {
        if (!state.running) return;
        scheduler.clear(timer);
        timer = null;
        patch({ running: false, stoppedBy: cause, nextAt: 0 });
        log(`Зупинено: ${reason}`, cause === 'session' ? 'error' : 'info');
    }

    const context: RunCheckContext = {
        econsul,
        server,
        settings,
        alerts,
        clock,
        ids,
        session,
        getPrevReserved: () => prevReserved,
        setPrevReserved: (prev) => {
            prevReserved = prev;
        },
        extensionConnected: deps.extensionConnected,
        openBooking: deps.openBooking,
        getState: () => state,
        patch,
        log,
        getToken: () => token,
        getKnownFree: () => knownFree,
        setKnownFree: (known) => {
            knownFree = known;
        },
        stop,
        emitNewSlots: (fresh, free) => handlers.newSlots.forEach((listener) => listener(fresh, free)),
        emitAuthFailed: (status, failedToken) => handlers.authFailed.forEach((listener) => listener(status, failedToken)),
    };

    // Random delay from the interval bounds; inside a fast window 15-20 s, and a normal delay
    // that would run past the start of the next fast window is cut to that start
    function scheduleNextCheck(): void {
        scheduler.clear(timer);
        const now = clock.now();
        const releases = state.releases.filter((release) => release.at + FAST_CHECKS.afterMs > now);
        const { delayMs, kind } = planNextCheck({
            nowMs: now,
            bounds: state.interval,
            fastChecks: state.fastChecks,
            releases,
            random: () => random.next(),
        });
        patch({ nextAt: now + delayMs, nextKind: kind });
        timer = scheduler.setTimeout(async () => {
            await runCheck(context, kind);
            if (state.running) scheduleNextCheck();
        }, delayMs);
    }

    // Token and institution are required for any check
    function canCheck(): boolean {
        if (!token) {
            log('Спершу вставте токен', 'warn');
            return false;
        }
        if (!state.selection) {
            log('Спершу виберіть установу', 'warn');
            return false;
        }
        return true;
    }

    async function start(options: { resumed?: boolean } = {}): Promise<void> {
        const resumed = options.resumed ?? false;
        if (state.running || !canCheck()) return;
        const selection = state.selection;
        if (!selection) return;
        if (!resumed) {
            alerts.unlockAudio(); // must run inside the click so the sound can play later
            if (alerts.notificationPermission() === 'default') await alerts.requestNotificationPermission();
        }
        if (state.running || disposed) return;
        patch({ running: true, stoppedBy: null });
        if (!resumed) {
            patch({ checks: 0 });
            resetMonitorState();
        }
        setTabTitle(context, DEFAULT_TITLE);
        const { min, max } = state.interval;
        const serviceName = state.locations?.services[selection.serviceCode] || selection.serviceCode;
        log(
            `${resumed ? 'Відновлено після входу' : 'Запущено'}: ${selection.institution.name}, ${serviceName}, кожні ${min}–${max} с`,
            resumed ? 'found' : 'info',
        );
        await runCheck(context);
        if (state.running && !state.checking) scheduleNextCheck();
    }

    // Check right away; a running monitor plans its next check from this one
    async function checkNow(): Promise<void> {
        if (state.checking || !canCheck()) return;
        alerts.unlockAudio(); // inside the click, so the slot sound can play
        scheduler.clear(timer);
        timer = null;
        if ((await runCheck(context, 'manual')) && state.running) scheduleNextCheck();
    }

    async function init(): Promise<void> {
        const saved = settings.loadSelection();
        patch({
            interval: settings.loadInterval() ?? state.interval,
            dateRange: settings.loadDateRange(),
            tabTitleMarks: settings.loadTabTitleMarks(),
        });
        try {
            const locations = await deps.locations.load();
            const institution =
                locations.institutions.find((i) => i.code === saved.institution) ??
                locations.institutions.find((i) => i.code === DEFAULT_INSTITUTION);
            patch({
                locations,
                selection: institution
                    ? { institution, serviceCode: saved.service || DEFAULT_SERVICE }
                    : null,
            });
        } catch (error) {
            log(`Не вдалося завантажити locations.json (${error instanceof Error ? error.message : String(error)})`, 'error');
        }
    }

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        on(event, listener) {
            const set = handlers[event] as Set<typeof listener>;
            set.add(listener);
            return () => {
                set.delete(listener);
            };
        },
        init,
        start,
        stop,
        checkNow,
        setToken(newToken, source) {
            const value = newToken.trim();
            if (!value) return;
            const changed = value !== token;
            token = value;
            if (changed) {
                patch({ hasToken: true });
                if (source === 'extension') log('Токен отримано від розширення');
            }
            if (source === 'extension' && !state.running && state.stoppedBy === 'session') {
                void start({ resumed: true });
            }
        },
        sessionLost(reason) {
            // The session ended outside a check (the site logged out, the token expired):
            // stop now instead of failing on the next request
            if (!state.running) return;
            patch({ lastResult: 'сесія завершилась (розширення)' });
            stop(`Сесія завершилась (розширення: ${reason || 'вихід з акаунта'})`, 'session');
        },
        setSelection(institutionCode, serviceCode) {
            const institution = state.locations?.institutions.find((i) => i.code === institutionCode);
            if (!institution) return;
            const current = state.selection;
            if (current && current.institution.code === institution.code && current.serviceCode === serviceCode) return;
            settings.saveSelection({ institution: institution.code, service: serviceCode });
            patch({ selection: { institution, serviceCode } });
            resetMonitorState(); // a running monitor switches to the new selection on its next check
        },
        setInterval(bounds) {
            const clamped = clampIntervalBounds(bounds.min, bounds.max);
            settings.saveInterval(clamped);
            patch({ interval: clamped }); // applies from the next planned check
        },
        setFastChecks(enabled) {
            patch({ fastChecks: enabled });
        },
        setDateRange(range) {
            settings.saveDateRange(range);
            patch({ dateRange: range });
        },
        setTabTitleMarks(on) {
            settings.saveTabTitleMarks(on);
            patch({ tabTitleMarks: on });
        },
        notificationPermission: () => alerts.notificationPermission(),
        requestNotifications: () => alerts.requestNotificationPermission(),
        audioReady: () => alerts.audioReady(),
        // testAlert() of slots.html: the same alert as a real one, with two made-up slots
        async testAlert(kind) {
            alerts.unlockAudio(); // inside the click, so the sound can play
            if (alerts.notificationPermission() === 'default') await alerts.requestNotificationPermission();
            if (disposed) return;
            if (kind === 'slots') {
                alertSlots(context, state.selection?.institution ?? { name: 'Test location' }, TEST_SLOTS, TEST_SLOTS.length);
            } else {
                alertSession(context, new SessionExpiredError(401, 'HTTP 401: test'));
            }
            scheduler.setTimeout(() => setTabTitle(context, DEFAULT_TITLE), TEST_TITLE_RESET_MS);
        },
        log,
        dispose() {
            scheduler.clear(timer);
            timer = null;
            disposed = true;
            listeners.clear();
            Object.values(handlers).forEach((set) => set.clear());
        },
    };
}
