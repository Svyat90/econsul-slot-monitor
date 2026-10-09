import { describe, expect, it } from 'vitest';
import { checkEntrySchema, type CheckEntry } from '@contracts/checks.ts';
import { reservationEventSchema, type ReservationEvent } from '@contracts/reservation-log.ts';
import locationsJson from '../../../server/data/locations.json';
import houston from '../domain/__fixtures__/econsul/houston-2026-10-09.json';
import { reservedResponseSchema, scheduleResponseSchema, type ReservedResponse, type ScheduleResponse } from '@/domain/contracts/econsul.ts';
import { SessionExpiredError, EconsulUnavailableError } from '@/domain/contracts/errors.ts';
import { locationsSchema } from '@/domain/contracts/locations.ts';
import { upcomingReleases } from '@/domain/monitoring/releases.ts';
import { FAST_CHECKS, SCHEDULE_REFRESH_MS } from '@/domain/monitoring/schedule.ts';
import { holidaySet } from '@/domain/slots/schedule-days.ts';
import { utcOffsetDateKey } from '@/domain/slots/time.ts';
import { createMonitor } from './monitor.ts';
import type {
    Alerts,
    Clock,
    EconsulApi,
    IntervalBounds,
    NotificationPermissionState,
    RequestMeta,
    ScheduleSnapshot,
    Scheduler,
    SettingsStore,
    TimerHandle,
} from './ports.ts';

const locations = locationsSchema.parse(locationsJson);
const scheduleResponse = scheduleResponseSchema.parse(houston.schedule);
const reservedResponse = reservedResponseSchema.parse(houston.reserved);
const CODE = houston.institutionCode;
const NOW = houston.recordedAtMs;
const TAB = '11111111-1111-4111-8111-111111111111';
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// Houston is fully booked in the fixture: free slots appear when reserved slots are removed
const reservedWithout = (...indices: number[]): ReservedResponse => ({
    ...reservedResponse,
    data: {
        ...reservedResponse.data,
        reservedSlots: reservedResponse.data.reservedSlots.filter((_, i) => !indices.includes(i)),
    },
});

function setup(options: { startAt?: number; random?: number } = {}) {
    let nowMs = options.startAt ?? NOW;
    const clock: Clock = { now: () => nowMs, localDateKey: utcOffsetDateKey(-300), browserOffsetMinutes: () => -300 };

    type Timer = { id: number; callback: () => void; at: number };
    let timers: Timer[] = [];
    let nextId = 1;
    const scheduler: Scheduler = {
        setTimeout(callback, delayMs) {
            const timer = { id: nextId++, callback, at: nowMs + delayMs };
            timers.push(timer);
            return { id: timer.id };
        },
        setInterval: () => ({ id: nextId++ }),
        clear(handle: TimerHandle | null) {
            if (handle) timers = timers.filter((t) => t.id !== handle.id);
        },
    };
    // runs the earliest pending timer, moving the clock to its time
    const fire = async () => {
        const timer = [...timers].sort((a, b) => a.at - b.at)[0]!;
        timers = timers.filter((t) => t !== timer);
        nowMs = Math.max(nowMs, timer.at);
        timer.callback();
        await flush();
    };

    const calls = { schedule: 0, reserved: 0 };
    const metas: (RequestMeta | undefined)[] = [];
    const responses = { schedule: scheduleResponse as ScheduleResponse, reserved: reservedWithout(0, 1) };
    let failure: Error | null = null;
    const econsul: EconsulApi = {
        async getSchedule(_code, _token, meta) {
            metas.push(meta);
            calls.schedule++;
            if (failure) throw failure;
            return responses.schedule;
        },
        async getReservedSlots(_request, _token, meta) {
            metas.push(meta);
            calls.reserved++;
            if (failure) throw failure;
            return responses.reserved;
        },
    };

    const alertCalls: string[] = [];
    const titles: string[] = [];
    const slotAlerts: { title: string; body: string }[] = [];
    let permission: NotificationPermissionState = 'granted';
    const alerts: Alerts = {
        notificationPermission: () => permission,
        requestNotificationPermission: async () => {
            alertCalls.push('request');
            permission = 'granted';
            return permission;
        },
        unlockAudio: () => void alertCalls.push('unlock'),
        audioReady: () => true,
        newSlots: (a) => {
            alertCalls.push('newSlots');
            slotAlerts.push(a);
        },
        sessionExpired: (a) => void alertCalls.push(`sessionExpired:${a.notify}`),
        playSessionSound: () => undefined,
        setTabTitle: (title) => void titles.push(title),
        openUrl: () => undefined,
    };

    const snapshots = new Map<string, ScheduleSnapshot>();
    const store: Record<string, unknown> = {};
    const settings: SettingsStore = {
        loadSelection: () => (store.selection as { institution: string; service: string }) ?? {},
        saveSelection: (s) => void (store.selection = s),
        loadInterval: () => (store.interval as IntervalBounds) ?? null,
        saveInterval: (b) => void (store.interval = b),
        loadDateRange: () => (store.range as { from: string | null; to: string | null }) ?? { from: null, to: null },
        saveDateRange: (r) => void (store.range = r),
        loadDraft: () => null,
        saveDraft: () => undefined,
        loadTabTitleMarks: () => (store.tabTitleMarks as boolean | undefined) ?? true,
        saveTabTitleMarks: (on) => void (store.tabTitleMarks = on),
        loadScheduleSnapshot: (code) => snapshots.get(code) ?? null,
        saveScheduleSnapshot: (code, s) => void snapshots.set(code, s),
    };

    const scheduleChanges: unknown[] = [];
    const checkEntries: CheckEntry[] = [];
    const reservationEvents: ReservationEvent[] = [];
    let uuidCounter = 0;
    const monitor = createMonitor({
        econsul,
        server: {
            recordScheduleChange: (e) => void scheduleChanges.push(e),
            recordRequest: () => undefined,
            recordCheck: (e) => void checkEntries.push(e),
            recordReservations: (batch) => void reservationEvents.push(...batch),
        },
        ids: { uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}` },
        session: { tabSessionId: TAB, appVersion: '1.0.0' },
        locations: { load: async () => locations },
        settings,
        alerts,
        clock,
        random: { next: () => options.random ?? 0.5 },
        scheduler,
        extensionConnected: () => false,
        openBooking: () => undefined,
    });
    return {
        monitor,
        calls,
        responses,
        alertCalls,
        titles,
        slotAlerts,
        setPermission: (p: NotificationPermissionState) => void (permission = p),
        scheduleChanges,
        metas,
        checkEntries,
        reservationEvents,
        store,
        fire,
        pending: () => timers.map((t) => t.at - nowMs),
        advance: (ms: number) => void (nowMs += ms),
        fail: (e: Error | null) => void (failure = e),
    };
}

async function ready(t: ReturnType<typeof setup>) {
    await t.monitor.init();
    t.monitor.setToken('secret-token', 'manual');
}

const messages = (t: ReturnType<typeof setup>) => t.monitor.getState().log.map((e) => e.message);

describe('monitor', () => {
    it('tab title marks: on by default, loaded by init, saved; off keeps the title untouched', async () => {
        const t = setup();
        t.store.tabTitleMarks = false;
        await t.monitor.init();
        expect(t.monitor.getState().tabTitleMarks).toBe(false);
        t.monitor.setToken('secret-token', 'manual');
        await t.monitor.start();
        expect(t.alertCalls).toContain('newSlots');
        expect(t.titles).toEqual([]);
        t.monitor.setTabTitleMarks(true);
        expect(t.store.tabTitleMarks).toBe(true);
        expect(t.monitor.getState().tabTitleMarks).toBe(true);
    });

    it('testAlert(slots) asks for permission, shows two made-up slots and restores the title after 5 s', async () => {
        const t = setup();
        await t.monitor.init();
        t.setPermission('default');
        await t.monitor.testAlert('slots');
        expect(t.alertCalls).toEqual(['unlock', 'request', 'newSlots']);
        expect(t.slotAlerts[0]?.body).toContain('Усього вільних: 2');
        expect(t.slotAlerts[0]?.body).toMatch(/31\.03\.2027/);
        expect(t.titles).toEqual(['🟢 Нових слотів: 2 — Монітор слотів']);
        expect(t.pending()).toEqual([5000]);
        await t.fire();
        expect(t.titles.at(-1)).toBe('Монітор слотів');
    });

    it('testAlert(session) raises the session alert; notification and audio state come from the ports', async () => {
        const t = setup();
        await t.monitor.init();
        await t.monitor.testAlert('session');
        expect(t.alertCalls).toEqual(['unlock', 'sessionExpired:true']);
        expect(t.monitor.notificationPermission()).toBe('granted');
        expect(t.monitor.audioReady()).toBe(true);
        t.setPermission('default');
        await expect(t.monitor.requestNotifications()).resolves.toBe('granted');
    });

    it('init loads locations and defaults to Houston; start runs a check at once and plans the next', async () => {
        const t = setup();
        await ready(t);
        expect(t.monitor.getState().selection?.institution.code).toBe(CODE);
        expect(t.monitor.getState().selection?.serviceCode).toBe('1');
        await t.monitor.start();
        const s = t.monitor.getState();
        expect(s.running).toBe(true);
        expect(s.checks).toBe(1);
        expect(s.nextAt).toBe(NOW + 120000); // 60..180 s, random 0.5
        expect(s.nextKind).toBe('scheduled');
        expect(t.pending()).toEqual([120000]);
        expect(messages(t).some((m) => m.startsWith('Запущено: '))).toBe(true);
    });

    it('start without a token does nothing but a warning', async () => {
        const t = setup();
        await t.monitor.init();
        await t.monitor.start();
        expect(t.monitor.getState().running).toBe(false);
        expect(t.calls).toEqual({ schedule: 0, reserved: 0 });
        expect(t.monitor.getState().log[0]?.kind).toBe('warn');
    });

    it('requests the schedule once per 30 minutes, in between only reserved slots', async () => {
        const t = setup({ random: 0 }); // 60 s between checks
        await ready(t);
        await t.monitor.start();
        await t.fire();
        await t.fire();
        expect(t.calls).toEqual({ schedule: 1, reserved: 3 });
        t.advance(SCHEDULE_REFRESH_MS);
        await t.fire();
        expect(t.calls).toEqual({ schedule: 2, reserved: 4 });
    });

    it('new slots: the first check reports all, the next only those that appeared', async () => {
        const t = setup();
        await ready(t);
        const events: string[][] = [];
        t.monitor.on('newSlots', (fresh) => void events.push(fresh));
        await t.monitor.start();
        expect(events).toHaveLength(1);
        expect(events[0]).toHaveLength(2);
        expect(t.alertCalls.filter((c) => c === 'newSlots')).toHaveLength(1);
        await t.fire();
        expect(events).toHaveLength(1); // nothing new: no alert, no event
        t.responses.reserved = reservedWithout(0, 1, 3);
        await t.fire();
        expect(events).toHaveLength(2);
        expect(events[1]).toEqual(['2026-10-14 10:30']);
        expect(t.monitor.getState().lastFresh).toEqual(['2026-10-14 10:30']);
    });

    it('slots outside the date range are not new', async () => {
        const t = setup();
        await ready(t);
        t.monitor.setDateRange({ from: '2026-11-01', to: null });
        expect(t.store.range).toEqual({ from: '2026-11-01', to: null });
        const events: string[][] = [];
        t.monitor.on('newSlots', (fresh) => void events.push(fresh));
        await t.monitor.start();
        expect(events).toEqual([['2026-12-28 11:20']]);
        t.responses.reserved = reservedWithout(0, 1, 3);
        await t.fire();
        expect(events).toHaveLength(1);
    });

    it('fast window: 15-20 s delay and kind fast; a delay running into the window is cut to its start', async () => {
        const probe = locationsSchema.parse(locationsJson).institutions.find((i) => i.code === CODE)!;
        const releases = upcomingReleases(
            {
                rows: scheduleResponse.data.flatMap((e) => (e.data ? [e.data] : [])),
                serviceCode: '1',
                numberWeeks: probe.numberWeeks,
                offset: '-05:00',
                holidays: holidaySet(locations.holidays, '1'),
                localDateKey: utcOffsetDateKey(-300),
            },
            NOW,
        );
        const at = releases[0]!.at;

        const inside = setup({ startAt: at - 60000, random: 0 });
        await ready(inside);
        await inside.monitor.start();
        expect(inside.monitor.getState().nextKind).toBe('fast');
        expect(inside.pending()).toEqual([15000]);

        const before = setup({ startAt: at - FAST_CHECKS.beforeMs - 30000, random: 0.5 });
        await ready(before);
        await before.monitor.start();
        expect(before.monitor.getState().nextKind).toBe('fast');
        expect(before.pending()).toEqual([30000]);

        const off = setup({ startAt: at - 60000, random: 0 });
        await ready(off);
        off.monitor.setFastChecks(false);
        await off.monitor.start();
        expect(off.monitor.getState().nextKind).toBe('scheduled');
        expect(off.pending()).toEqual([60000]);
    });

    it('401 stops with cause session; setToken from the extension resumes and keeps the known slots', async () => {
        const t = setup();
        await ready(t);
        const auth: [number, string][] = [];
        const fresh: string[][] = [];
        t.monitor.on('authFailed', (status, token) => void auth.push([status, token]));
        t.monitor.on('newSlots', (f) => void fresh.push(f));
        await t.monitor.start();
        expect(fresh).toHaveLength(1);
        t.fail(new SessionExpiredError(401));
        await t.fire();
        const s = t.monitor.getState();
        expect(s.running).toBe(false);
        expect(s.stoppedBy).toBe('session');
        expect(t.pending()).toEqual([]);
        expect(t.alertCalls).toContain('sessionExpired:true');
        expect(auth).toEqual([[401, 'secret-token']]);
        expect(JSON.stringify(s)).not.toContain('secret-token');

        t.fail(null);
        t.monitor.setToken('new-token', 'extension');
        await flush();
        const resumed = t.monitor.getState();
        expect(resumed.running).toBe(true);
        expect(resumed.stoppedBy).toBeNull();
        expect(messages(t).some((m) => m.startsWith('Відновлено після входу'))).toBe(true);
        expect(resumed.checks).toBe(3); // the counter is kept
        expect(fresh).toHaveLength(1); // knownFree kept: the same slots are not new again
        expect(t.pending()).toHaveLength(1);
    });

    it('stop by the user: a new token does not resume', async () => {
        const t = setup();
        await ready(t);
        await t.monitor.start();
        t.monitor.stop('Зупинено користувачем', 'user');
        expect(t.monitor.getState()).toMatchObject({ running: false, stoppedBy: 'user', nextAt: 0 });
        expect(t.pending()).toEqual([]);
        t.monitor.setToken('new-token', 'extension');
        await flush();
        expect(t.monitor.getState().running).toBe(false);
    });

    it('sessionLost stops a running monitor with cause session', async () => {
        const t = setup();
        await ready(t);
        await t.monitor.start();
        t.monitor.sessionLost('logged out');
        expect(t.monitor.getState()).toMatchObject({ running: false, stoppedBy: 'session' });
    });

    it('500 is logged and monitoring goes on', async () => {
        const t = setup();
        await ready(t);
        await t.monitor.start();
        t.fail(new EconsulUnavailableError(500, 'HTTP 500'));
        await t.fire();
        const s = t.monitor.getState();
        expect(s.running).toBe(true);
        expect(s.log[0]).toMatchObject({ kind: 'error', message: 'Перевірка #2: помилка: HTTP 500' });
        expect(t.pending()).toHaveLength(1);
    });

    it('checkNow runs a manual check without a running monitor and plans from it when running', async () => {
        const t = setup();
        await ready(t);
        await t.monitor.checkNow();
        expect(t.monitor.getState()).toMatchObject({ running: false, checks: 1, checking: false });
        expect(t.pending()).toEqual([]);
        expect(messages(t).some((m) => m.startsWith('Перевірка #1 (ручна)'))).toBe(true);
        await t.monitor.start();
        await t.monitor.checkNow();
        expect(t.pending()).toHaveLength(1);
    });

    it('changing the institution resets the state: the next check takes the schedule again and all slots are new', async () => {
        const t = setup();
        await ready(t);
        const fresh: string[][] = [];
        t.monitor.on('newSlots', (f) => void fresh.push(f));
        await t.monitor.start();
        expect(t.calls.schedule).toBe(1);
        const other = locations.institutions.find((i) => i.code !== CODE && i.serviceMinutes['1'])!;
        t.monitor.setSelection(other.code, '1');
        expect(t.store.selection).toEqual({ institution: other.code, service: '1' });
        expect(t.monitor.getState()).toMatchObject({ schedule: null, free: null, releases: [] });
        await t.fire();
        expect(t.calls.schedule).toBe(2);
        // same selection again: no reset
        t.monitor.setSelection(other.code, '1');
        expect(t.monitor.getState().schedule).not.toBeNull();
    });

    it('schedule change: baseline first, then changed; the snapshot is saved', async () => {
        const t = setup({ random: 0 });
        await ready(t);
        await t.monitor.start();
        expect(t.scheduleChanges).toHaveLength(1);
        expect(t.scheduleChanges[0]).toMatchObject({ type: 'baseline', institutionCode: CODE });
        expect(JSON.stringify(t.scheduleChanges)).not.toContain('secret-token');

        const rows = scheduleResponse.data.map((entry) => entry.data && { ...entry, data: { ...entry.data, receptionCitizensTime: [] } });
        t.responses.schedule = { ...scheduleResponse, data: rows.filter((r): r is NonNullable<typeof r> => !!r) };
        t.advance(SCHEDULE_REFRESH_MS + 1000);
        await t.fire();
        expect(t.scheduleChanges).toHaveLength(2);
        expect(t.scheduleChanges[1]).toMatchObject({ type: 'changed', institutionCode: CODE });
        expect(messages(t).some((m) => m.startsWith('Розклад змінено'))).toBe(true);
    });

    it('notifies subscribers and the changed event on every state change; dispose clears the timer', async () => {
        const t = setup();
        let notified = 0;
        let changed = 0;
        const off = t.monitor.subscribe(() => void notified++);
        t.monitor.on('changed', () => void changed++);
        await ready(t);
        expect(notified).toBeGreaterThan(0);
        expect(changed).toBe(notified);
        await t.monitor.start();
        expect(t.pending()).toHaveLength(1);
        t.monitor.dispose();
        expect(t.pending()).toEqual([]);
        off();
    });

    it('setInterval clamps to the minimum and saves', async () => {
        const t = setup();
        t.monitor.setInterval({ min: 3, max: 5 });
        expect(t.monitor.getState().interval).toEqual({ min: 10, max: 10 });
        expect(t.store.interval).toEqual({ min: 10, max: 10 });
    });

    it('records each check with its kind and sequence; scheduled and manual checks are told apart', async () => {
        const t = setup({ random: 0 });
        await ready(t);
        await t.monitor.start();
        await t.fire();
        await t.monitor.checkNow();
        const entries = t.checkEntries.map((e) => checkEntrySchema.parse(e));
        expect(entries.map((e) => [e.kind, e.checkSeq, e.outcome])).toEqual([
            ['scheduled', 1, 'ok'],
            ['scheduled', 2, 'ok'],
            ['manual', 3, 'ok'],
        ]);
        expect(t.metas.map((m) => m?.checkSeq)).toEqual([1, 1, 2, 3]);
        expect(t.metas[0]).toEqual({ checkKind: 'scheduled', checkSeq: 1 });
        expect(entries[0]!.tabSessionId).toBe(TAB);
        expect(JSON.stringify(t.checkEntries)).not.toContain('secret-token');
    });

    it('reservations: none on the first check, one reserved event on the second; a new institution starts a new baseline', async () => {
        const t = setup({ random: 0 });
        await ready(t);
        await t.monitor.start();
        expect(t.reservationEvents).toEqual([]);
        t.responses.reserved = reservedWithout(1, 3);
        await t.fire();
        const events = t.reservationEvents.map((e) => reservationEventSchema.parse(e));
        expect(events.map((e) => e.kind).sort()).toEqual(['released', 'reserved']);
        expect(events[0]).toMatchObject({ institutionCode: CODE, tabSessionId: TAB });
        t.reservationEvents.length = 0;

        const other = locations.institutions.find((i) => i.code !== CODE)!;
        t.monitor.setSelection(other.code, '1');
        t.responses.reserved = reservedWithout(0, 1, 3);
        await t.fire();
        expect(t.reservationEvents).toEqual([]);
    });
});
