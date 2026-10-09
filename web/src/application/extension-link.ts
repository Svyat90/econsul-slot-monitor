// Link between the app and the e-Consul Helper extension (slots.html extHello(), reportMonitor(),
// reportSelection(), sendSlotsToExtension(), onExtAuth(), onExtToken(), onExtDraft(), the window
// message listener, the login link and testExtension()). The bridge adapter does origin/source
// checks and contract parsing; this use case decides what each message means.
import type { AppSlot } from '@/domain/contracts/extension-messages.ts';
import { fastWindow } from '@/domain/monitoring/schedule.ts';
import type { SlotKey } from '@/domain/monitoring/slots-diff.ts';
import type { FreeSlots } from '@/domain/slots/free-slots.ts';
import type { Monitor } from './monitor.ts';
import type { Alerts, Clock, Draft, ExtensionBridge, Scheduler, SettingsStore, TimerHandle } from './ports.ts';
import { DEFAULT_TITLE } from './run-check.ts';

export type ExtensionState = {
    connected: boolean;
    version: string | null;
    auth: { loggedIn: boolean | null; exp: number | null; reason: string | null } | null;
    autoBook: boolean;
    draft: Draft | null;
};

export interface ExtensionLink {
    getState(): ExtensionState;
    subscribe(listener: () => void): () => void; // useSyncExternalStore
    start(): void;
    dispose(): void;
    login(): void;
    setAutoBook(on: boolean): void;
    setDraftUrl(url: string): void; // a link pasted by hand; empty removes the saved one
    testSound(kind: 'selected' | 'mute' | 'slots'): void;
    userGesture(): void; // a click on the page: unlock audio and report audioReady
}

export type ExtensionLinkDeps = {
    bridge: ExtensionBridge;
    monitor: Monitor;
    settings: SettingsStore;
    alerts: Alerts;
    clock: Clock;
    scheduler: Scheduler;
};

const HELLO_EVERY_MS = 15000;
const HELLO_TIMEOUT_MS = 3000;
const SITE_URL = 'https://e-consul.gov.ua/';
const SESSION_TITLE = '🔴 Сесія завершилась — Монітор слотів';
const TEST_SLOTS: SlotKey[] = ['2027-03-31 09:50', '2027-03-31 10:10'];

const displayDate = (date: string): string => date.split('-').reverse().join('.');

export function createExtensionLink(deps: ExtensionLinkDeps): ExtensionLink {
    const { bridge, monitor, settings, alerts, clock, scheduler } = deps;
    let state: ExtensionState = {
        connected: false,
        version: null,
        auth: null,
        autoBook: false,
        draft: settings.loadDraft(),
    };
    const listeners = new Set<() => void>();
    let unsubscribers: (() => void)[] = [];
    let helloTimeout: TimerHandle | null = null;
    let heartbeat: TimerHandle | null = null;
    let sessionTitleShown = false;
    let lastSelectionKey = '';
    let started = false;

    function patch(next: Partial<ExtensionState>): void {
        state = { ...state, ...next };
        listeners.forEach((listener) => listener());
    }

    function reportSelection(): void {
        if (!state.connected) return;
        const { selection, locations } = monitor.getState();
        if (!selection || !locations) return;
        bridge.send({
            type: 'app:selection',
            selection: {
                institutionCode: selection.institution.code,
                institutionName: selection.institution.name,
                countryName: selection.institution.country,
                serviceCode: selection.serviceCode,
                serviceName: locations.services[selection.serviceCode] || selection.serviceCode,
            },
        });
    }

    function reportMonitor(): void {
        if (!state.connected) return;
        const m = monitor.getState();
        const { active, next } = fastWindow(m.releases, clock.now());
        const release = active ?? next;
        bridge.send({
            type: 'app:monitor',
            audioReady: alerts.audioReady(),
            monitor: {
                running: m.running,
                nextAt: m.nextAt || 0,
                nextKind: m.nextKind,
                checking: m.checking,
                lastResult: m.lastResult,
                stoppedBy: m.stoppedBy,
                institution: m.selection ? m.selection.institution.name : null,
                nextRelease: release ? { at: release.at, opening: release.opening } : null,
            },
        });
    }

    // The bridge answers app:hello with ext:hello; no answer within the timeout means no extension
    function hello(): void {
        bridge.send({ type: 'app:hello', audioReady: alerts.audioReady() });
        scheduler.clear(helloTimeout);
        helloTimeout = scheduler.setTimeout(() => {
            if (state.connected) patch({ connected: false });
        }, HELLO_TIMEOUT_MS);
        reportSelection();
        reportMonitor();
    }

    // New slots in the date range, earliest first
    function sendSlots(keys: readonly SlotKey[], free: Pick<FreeSlots, 'slotConsuls'> | null, test: boolean): void {
        if (!state.connected || keys.length === 0) return;
        const slots: AppSlot[] = [...keys].sort().map((key) => {
            const [date = '', time = ''] = key.split(' ');
            const hash = free?.slotConsuls[key]?.[0];
            return hash ? { date, time, consulIpnHash: hash } : { date, time };
        });
        const { from, to } = monitor.getState().dateRange;
        const range: { from?: string; to?: string } = {};
        if (from) range.from = from;
        if (to) range.to = to;
        bridge.send({ type: 'app:slots', slots, range, test });
        const first = slots[0];
        if (first) {
            monitor.log(
                `${test ? 'Тест: надіслано' : 'Надіслано'} ${slots.length} слот(ів) розширенню, найраніший ${displayDate(first.date)} ${first.time}`,
            );
        }
    }

    function onHello(version: string | undefined): void {
        scheduler.clear(helloTimeout);
        helloTimeout = null;
        const firstContact = !state.connected;
        patch({ connected: true, version: version ?? null });
        if (firstContact) {
            monitor.log(`Розширення підключено (v${version ?? '?'})`);
            bridge.send({ type: 'app:hello', audioReady: alerts.audioReady() }); // the bridge answers with the current state
            reportSelection();
            reportMonitor();
        }
    }

    function onAuth(msg: { loggedIn: boolean | null; exp?: number | null; reason?: string | null; alert?: boolean }): void {
        const wasLoggedIn = state.auth?.loggedIn === true;
        patch({ auth: { loggedIn: msg.loggedIn, exp: msg.exp ?? null, reason: msg.reason ?? null } });
        if (msg.loggedIn === false) {
            // The session ended outside a check: stop now instead of failing on the next request
            monitor.sessionLost(msg.reason || '');
            if (msg.alert) {
                alerts.playSessionSound();
                if (monitor.getState().tabTitleMarks) alerts.setTabTitle(SESSION_TITLE);
                sessionTitleShown = true;
            }
        } else if (msg.loggedIn === true && !wasLoggedIn && sessionTitleShown) {
            if (monitor.getState().tabTitleMarks) alerts.setTabTitle(DEFAULT_TITLE);
            sessionTitleShown = false;
        }
    }

    function onDraft(draft: { url: string; createdAt?: number | null; expiresAt?: number | null; foundAt?: number } | null): void {
        if (!draft || !draft.url) return; // no draft in the extension: keep a link pasted by hand
        const prev = state.draft;
        if (prev?.url !== draft.url) monitor.log('Посилання на чернетку отримано від розширення');
        // Without createdAt the 24 h hint counts from when the link was first seen
        const savedAt = draft.createdAt || (prev && prev.url === draft.url ? prev.savedAt : draft.foundAt || clock.now());
        const saved: Draft = { url: draft.url, savedAt, expiresAt: draft.expiresAt || null, fromExtension: true };
        settings.saveDraft(saved);
        patch({ draft: saved });
        bridge.send({ type: 'app:received', draftUrl: draft.url });
    }

    return {
        getState: () => state,
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        start() {
            if (started) return;
            started = true;
            unsubscribers = [
                bridge.subscribe((msg) => {
                    switch (msg.type) {
                        case 'ext:hello':
                            return onHello(msg.version);
                        case 'ext:auth':
                            return onAuth(msg);
                        case 'ext:token':
                            monitor.setToken(msg.token, 'extension');
                            bridge.send({ type: 'app:received', exp: msg.exp ?? null }); // the popup shows that the token arrived
                            return;
                        case 'ext:draft':
                            return onDraft(msg.draft);
                        case 'ext:settings':
                            return patch({ autoBook: msg.autoBook });
                        case 'ext:slot-selected':
                            return monitor.log(
                                `Розширення вибрало ${displayDate(msg.slot.date)} ${msg.slot.time} у чернетці: натисніть «Підтвердити»`,
                            );
                        case 'ext:slot-failed':
                            return monitor.log(
                                `${msg.test ? 'Тест: розширення' : 'Розширення'} не вибрало слот: ${msg.text ?? msg.error ?? ''}`,
                                msg.test ? 'info' : 'warn',
                            );
                        case 'ext:slot-booked':
                            return monitor.log(
                                `Розширення забронювало ${displayDate(msg.slot.date)} ${msg.slot.time}: сайт прийняв заявку`,
                            );
                        default:
                            return; // ext:slots-received, ext:mute: nothing to do
                    }
                }),
                monitor.on('newSlots', (fresh, free) => sendSlots(fresh, free, false)),
                monitor.on('authFailed', (status, token) => {
                    if (state.connected) bridge.send({ type: 'app:auth-failed', status, soundPlayed: true, token });
                }),
                monitor.subscribe(() => {
                    const selection = monitor.getState().selection;
                    const key = selection ? `${selection.institution.code}/${selection.serviceCode}` : '';
                    if (key !== lastSelectionKey) {
                        lastSelectionKey = key;
                        reportSelection();
                    }
                    reportMonitor();
                }),
            ];
            hello();
            heartbeat = scheduler.setInterval(hello, HELLO_EVERY_MS);
        },
        dispose() {
            unsubscribers.forEach((unsubscribe) => unsubscribe());
            unsubscribers = [];
            scheduler.clear(helloTimeout);
            scheduler.clear(heartbeat);
            helloTimeout = null;
            heartbeat = null;
            listeners.clear();
            started = false;
        },
        login() {
            if (state.connected) bridge.send({ type: 'app:login' });
            else alerts.openUrl(SITE_URL);
        },
        setAutoBook(on) {
            patch({ autoBook: on });
            bridge.send({ type: 'app:settings', patch: { autoBook: on } });
        },
        // saveDraftUrl() of slots.html: the same link keeps its savedAt, a new one starts the 24 h count
        setDraftUrl(url) {
            const value = url.trim();
            if (!value) {
                settings.saveDraft(null);
                patch({ draft: null });
                return;
            }
            if (state.draft?.url === value) return;
            const saved: Draft = { url: value, savedAt: clock.now() };
            settings.saveDraft(saved);
            patch({ draft: saved });
        },
        userGesture() {
            if (alerts.audioReady()) return;
            alerts.unlockAudio();
            scheduler.setTimeout(reportMonitor, 100); // AudioContext.resume() settles asynchronously
        },
        // The extension's "slot selected" signal, mute, and app:slots with two made-up slots
        // (the extension opens the draft and finds neither; never booked)
        testSound(kind) {
            alerts.unlockAudio(); // a click: unlock this page's audio too
            if (kind === 'selected') bridge.send({ type: 'app:test-sound', sound: 'selected' });
            else if (kind === 'mute') bridge.send({ type: 'app:mute' });
            else sendSlots(TEST_SLOTS, null, true);
        },
    };
}
