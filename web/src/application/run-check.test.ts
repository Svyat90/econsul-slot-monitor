import { describe, expect, it } from 'vitest';
import locationsJson from '../../../server/data/locations.json';
import houston from '../domain/__fixtures__/econsul/houston-2026-10-09.json';
import { reservedResponseSchema, scheduleResponseSchema, type ReservedResponse } from '@/domain/contracts/econsul.ts';
import { EconsulUnavailableError, SessionExpiredError } from '@/domain/contracts/errors.ts';
import { locationsSchema } from '@/domain/contracts/locations.ts';
import { SCHEDULE_REFRESH_MS } from '@/domain/monitoring/schedule.ts';
import { utcOffsetDateKey } from '@/domain/slots/time.ts';
import type { Alerts, Clock, EconsulApi, ScheduleSnapshot, SettingsStore } from './ports.ts';
import { runCheck, type MonitorState, type RunCheckContext } from './run-check.ts';

const locations = locationsSchema.parse(locationsJson);
const institution = locations.institutions.find((i) => i.code === houston.institutionCode)!;
const scheduleResponse = scheduleResponseSchema.parse(houston.schedule);
const reservedResponse = reservedResponseSchema.parse(houston.reserved);
const NOW = houston.recordedAtMs;

// Houston is fully booked in the fixture: free slots appear when reserved slots are removed.
// Fixture slots 0, 1 and 3: 2026-10-12 10:50, 2026-12-28 11:20, 2026-10-14 10:30.
const reservedWithout = (...indices: number[]): ReservedResponse => ({
    ...reservedResponse,
    data: {
        ...reservedResponse.data,
        reservedSlots: reservedResponse.data.reservedSlots.filter((_, i) => !indices.includes(i)),
    },
});
const FIRST_FREE = ['2026-10-12 10:50', '2026-12-28 11:20'];
const NEXT_FREED = '2026-10-14 10:30';

function setup(options: { dateRange?: { from: string | null; to: string | null } } = {}) {
    const events: string[] = [];
    const calls = { schedule: 0, reserved: 0 };
    let nowMs = NOW;
    let reserved: ReservedResponse = reservedWithout(0, 1);
    let failure: Error | null = null;
    const snapshots = new Map<string, ScheduleSnapshot>();
    const fresh: string[][] = [];
    const auth: [number, string][] = [];
    const clock: Clock = {
        now: () => nowMs,
        localDateKey: utcOffsetDateKey(-300),
        browserOffsetMinutes: () => -300,
    };
    const econsul: EconsulApi = {
        async getSchedule() {
            calls.schedule++;
            events.push('request');
            if (failure) throw failure;
            return scheduleResponse;
        },
        async getReservedSlots() {
            calls.reserved++;
            events.push('request');
            if (failure) throw failure;
            return reserved;
        },
    };
    const settings = {
        loadScheduleSnapshot: (code: string) => snapshots.get(code) ?? null,
        saveScheduleSnapshot: (code: string, s: ScheduleSnapshot) => void snapshots.set(code, s),
    } as unknown as SettingsStore;
    const alerts = {
        newSlots: () => events.push('alert'),
        sessionExpired: () => events.push('session-alert'),
        setTabTitle: () => undefined,
    } as unknown as Alerts;
    let state: MonitorState = {
        locations,
        selection: { institution, serviceCode: '1' },
        hasToken: true,
        running: true,
        checking: false,
        checks: 0,
        nextAt: 0,
        nextKind: 'scheduled',
        lastResult: '',
        stoppedBy: null,
        interval: { min: 60, max: 180 },
        fastChecks: true,
        dateRange: options.dateRange ?? { from: null, to: null },
        schedule: null,
        reserved: null,
        free: null,
        releases: [],
        outOfRange: null,
        lastFresh: [],
        log: [],
    };
    let known: ReadonlySet<string> | null = null;
    const ctx: RunCheckContext = {
        econsul,
        server: { recordScheduleChange: () => events.push('server') },
        settings,
        alerts,
        clock,
        extensionConnected: () => false,
        openBooking: () => undefined,
        getState: () => state,
        patch: (p) => {
            state = { ...state, ...p };
        },
        log: (message, kind = 'info') => {
            state = { ...state, log: [{ at: nowMs, message, kind }, ...state.log] };
            events.push('log');
        },
        getToken: () => 'secret-token',
        getKnownFree: () => known,
        setKnownFree: (k) => {
            known = k;
        },
        stop: (reason, cause) => {
            state = { ...state, running: false, stoppedBy: cause };
            events.push(`stop:${cause}`);
        },
        emitNewSlots: (f) => {
            fresh.push(f);
            events.push('newSlots');
        },
        emitAuthFailed: (status, token) => {
            auth.push([status, token]);
        },
    };
    return {
        ctx,
        calls,
        events,
        fresh,
        auth,
        state: () => state,
        advance: (ms: number) => void (nowMs += ms),
        setReserved: (r: ReservedResponse) => void (reserved = r),
        fail: (e: Error | null) => void (failure = e),
    };
}


describe('runCheck', () => {
    it('first check: schedule and reserved slots, every free slot is new, log lines, then the alert, then newSlots (as runCheck() in slots.html)', () => {
        const t = setup();
        return runCheck(t.ctx, 'scheduled').then((ok) => {
            expect(ok).toBe(true);
            expect(t.calls).toEqual({ schedule: 1, reserved: 1 });
            const s = t.state();
            expect(s.checks).toBe(1);
            expect(s.checking).toBe(false);
            expect([...s.free!.keys].sort()).toEqual(FIRST_FREE);
            expect([...s.lastFresh].sort()).toEqual(FIRST_FREE);
            expect(s.releases.length).toBeGreaterThan(0);
            expect(s.log.some((e) => e.message.startsWith('Перевірка #1: '))).toBe(true);
            const order = t.events.filter((e) => ['request', 'alert', 'newSlots'].includes(e));
            expect(order).toEqual(['request', 'request', 'alert', 'newSlots']);
            expect(t.events.indexOf('alert')).toBeLessThan(t.events.indexOf('newSlots'));
        });
    });

    it('refreshes the schedule once per 30 minutes; in between only reserved slots are requested', async () => {
        const t = setup();
        await runCheck(t.ctx);
        t.advance(60000);
        await runCheck(t.ctx, 'fast');
        expect(t.calls).toEqual({ schedule: 1, reserved: 2 });
        t.advance(SCHEDULE_REFRESH_MS);
        await runCheck(t.ctx, 'manual');
        expect(t.calls).toEqual({ schedule: 2, reserved: 3 });
        expect(t.state().log.some((e) => e.message.startsWith('Перевірка #2 (часта)'))).toBe(true);
        expect(t.state().log.some((e) => e.message.startsWith('Перевірка #3 (ручна)'))).toBe(true);
    });

    it('an empty schedule is requested again on the next check (slots.html: !scheduleRows.length)', async () => {
        const t = setup();
        t.ctx.patch({ schedule: { rows: [], fetchedAt: t.ctx.clock.now() } });
        t.advance(60000);
        await runCheck(t.ctx);
        expect(t.calls.schedule).toBe(1);
    });

    it('next check: only the slots that appeared are new; no alert without new ones', async () => {
        const t = setup();
        await runCheck(t.ctx);
        t.fresh.length = 0;
        t.advance(60000);
        await runCheck(t.ctx);
        expect(t.state().lastFresh).toEqual([]);
        expect(t.fresh).toEqual([]);
        t.setReserved(reservedWithout(0, 1, 3));
        t.advance(60000);
        await runCheck(t.ctx);
        expect(t.state().lastFresh).toEqual([NEXT_FREED]);
        expect(t.fresh).toEqual([[NEXT_FREED]]);
        expect(t.state().log[1]!.message).toBe('  нові: 14.10.2026: 10:30');
    });

    it('a slot outside the date range is not new, and does not become new when the range widens', async () => {
        const t = setup({ dateRange: { from: '2026-11-01', to: null } });
        await runCheck(t.ctx);
        const s1 = t.state();
        expect(s1.outOfRange).toMatchObject({ dropped: 1, total: 2 });
        expect(s1.lastFresh).toEqual(['2026-12-28 11:20']);
        t.fresh.length = 0;
        t.setReserved(reservedWithout(0, 1, 3));
        t.advance(60000);
        await runCheck(t.ctx);
        expect(t.fresh).toEqual([]);
        expect(t.state().lastFresh).toEqual([]);
    });

    it('401 stops with cause session, alerts and reports the token to the extension link', async () => {
        const t = setup();
        t.fail(new SessionExpiredError(401));
        const ok = await runCheck(t.ctx);
        expect(ok).toBe(false);
        expect(t.state().stoppedBy).toBe('session');
        expect(t.state().checking).toBe(false);
        expect(t.events).toEqual(['request', 'stop:session', 'session-alert']);
        expect(t.auth).toEqual([[401, 'secret-token']]);
        expect(JSON.stringify(t.state())).not.toContain('secret-token');
    });

    it('500 is logged and monitoring goes on', async () => {
        const t = setup();
        t.fail(new EconsulUnavailableError(500, 'HTTP 500'));
        const ok = await runCheck(t.ctx);
        expect(ok).toBe(true);
        expect(t.state().running).toBe(true);
        expect(t.state().lastResult).toBe('помилка: HTTP 500');
        expect(t.state().log[0]).toMatchObject({ kind: 'error', message: 'Перевірка #1: помилка: HTTP 500' });
    });

    it('does not start a second check while one is running', async () => {
        const t = setup();
        const first = runCheck(t.ctx);
        expect(await runCheck(t.ctx)).toBe(false);
        await first;
        expect(t.state().checks).toBe(1);
    });
});
