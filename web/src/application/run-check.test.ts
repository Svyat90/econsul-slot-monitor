import { describe, expect, it } from 'vitest';
import { checkEntrySchema, type CheckEntry } from '@contracts/checks.ts';
import { reservationEventSchema, type ReservationEvent } from '@contracts/reservation-log.ts';
import locationsJson from '../../../server/data/locations.json';
import houston from '../domain/__fixtures__/econsul/houston-2026-10-09.json';
import { reservedResponseSchema, scheduleResponseSchema, type ReservedResponse, type ReservedSlot } from '@/domain/contracts/econsul.ts';
import { EconsulSchemaError, EconsulUnavailableError, SessionExpiredError } from '@/domain/contracts/errors.ts';
import { locationsSchema } from '@/domain/contracts/locations.ts';
import { SCHEDULE_REFRESH_MS } from '@/domain/monitoring/schedule.ts';
import { utcOffsetDateKey } from '@/domain/slots/time.ts';
import type { Alerts, Clock, EconsulApi, RequestMeta, ScheduleSnapshot, SettingsStore } from './ports.ts';
import { runCheck, type MonitorState, type RunCheckContext } from './run-check.ts';

const locations = locationsSchema.parse(locationsJson);
const institution = locations.institutions.find((i) => i.code === houston.institutionCode)!;
const scheduleResponse = scheduleResponseSchema.parse(houston.schedule);
const reservedResponse = reservedResponseSchema.parse(houston.reserved);
const NOW = houston.recordedAtMs;
const TAB = '11111111-1111-4111-8111-111111111111';

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

function setup(options: { dateRange?: { from: string | null; to: string | null }; tabTitleMarks?: boolean } = {}) {
    const events: string[] = [];
    const titles: string[] = [];
    const calls = { schedule: 0, reserved: 0 };
    let nowMs = NOW;
    let reserved: ReservedResponse = reservedWithout(0, 1);
    let failure: Error | null = null;
    const snapshots = new Map<string, ScheduleSnapshot>();
    const fresh: string[][] = [];
    const metas: (RequestMeta | undefined)[] = [];
    const checkEntries: CheckEntry[] = [];
    const reservationEvents: ReservationEvent[] = [];
    let uuidCounter = 0;
    let prevReserved: { slots: ReservedSlot[]; at: number } | null = null;
    const auth: [number, string][] = [];
    const clock: Clock = {
        now: () => nowMs,
        localDateKey: utcOffsetDateKey(-300),
        browserOffsetMinutes: () => -300,
    };
    const econsul: EconsulApi = {
        async getSchedule(_code, _token, meta) {
            metas.push(meta);
            calls.schedule++;
            events.push('request');
            if (failure) throw failure;
            return scheduleResponse;
        },
        async getReservedSlots(_request, _token, meta) {
            metas.push(meta);
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
        setTabTitle: (title: string) => void titles.push(title),
    } as unknown as Alerts;
    let state: MonitorState = {
        tabTitleMarks: options.tabTitleMarks ?? true,
        locations,
        selection: { institution, serviceCode: '1' },
        hasToken: true,
        running: true,
        checking: false,
        currentCheck: null,
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
    let calendarSent: string | null = null;
    const ctx: RunCheckContext = {
        econsul,
        server: {
            recordScheduleChange: () => events.push('server'),
            recordRequest: () => undefined,
            recordCheck: (entry) => void checkEntries.push(entry),
            recordReservations: (batch) => void reservationEvents.push(...batch),
            recordCalendar: () => undefined,
        },
        ids: { uuid: () => `00000000-0000-4000-8000-${String(++uuidCounter).padStart(12, '0')}` },
        session: { tabSessionId: TAB, appVersion: '1.0.0' },
        getCalendarSent: () => calendarSent,
        setCalendarSent: (key) => {
            calendarSent = key;
        },
        getPrevReserved: () => prevReserved,
        setPrevReserved: (p) => {
            prevReserved = p;
        },
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
        titles,
        fresh,
        auth,
        metas,
        checkEntries,
        reservationEvents,
        resetPrevReserved: () => void (prevReserved = null),
        state: () => state,
        advance: (ms: number) => void (nowMs += ms),
        setReserved: (r: ReservedResponse) => void (reserved = r),
        fail: (e: Error | null) => void (failure = e),
    };
}


describe('runCheck', () => {
    it('marks the tab title on new slots and on session loss; not when tab title marks are off', async () => {
        const on = setup();
        await runCheck(on.ctx, 'scheduled');
        expect(on.titles).toEqual(['🟢 Нових слотів: 2 — Монітор слотів']);
        const off = setup({ tabTitleMarks: false });
        await runCheck(off.ctx, 'scheduled');
        expect(off.events).toContain('alert');
        expect(off.titles).toEqual([]);
        off.fail(new SessionExpiredError(401));
        await runCheck(off.ctx, 'scheduled');
        expect(off.titles).toEqual([]);
    });

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
    it('records every check: success with new slots, passes the check meta to both requests, no token', async () => {
        const t = setup();
        await runCheck(t.ctx, 'fast');
        expect(t.metas).toEqual([
            { checkKind: 'fast', checkSeq: 1 },
            { checkKind: 'fast', checkSeq: 1 },
        ]);
        expect(t.checkEntries).toHaveLength(1);
        const entry = checkEntrySchema.parse(t.checkEntries[0]);
        expect(entry).toMatchObject({
            kind: 'fast',
            checkSeq: 1,
            institutionCode: institution.code,
            serviceCode: '1',
            outcome: 'ok',
            freeCount: 2,
            newCount: 2,
            outOfRangeCount: 0,
            durationMs: 0,
            tabSessionId: TAB,
            appVersion: '1.0.0',
            errorMessage: null,
            startedAt: new Date(NOW).toISOString(),
        });
        expect(entry.newSlots.map((s) => `${s.date} ${s.time}`).sort()).toEqual(FIRST_FREE);
        expect(entry.newSlots.every((s) => s.consulIpnHash)).toBe(true);
        expect(JSON.stringify(t.checkEntries)).not.toContain('secret-token');
    });

    it('records out-of-range slots separately from the free count', async () => {
        const t = setup({ dateRange: { from: '2026-11-01', to: null } });
        await runCheck(t.ctx);
        expect(t.checkEntries[0]).toMatchObject({ freeCount: 1, newCount: 1, outOfRangeCount: 1 });
    });

    it('records a failed check: 500 as unavailable, 401 as session_expired, schema as schema_error', async () => {
        const t = setup();
        t.fail(new EconsulUnavailableError(500, 'HTTP 500'));
        await runCheck(t.ctx);
        t.fail(new SessionExpiredError(401));
        await runCheck(t.ctx);
        t.fail(new EconsulSchemaError('bad format'));
        await runCheck(t.ctx);
        t.fail(new Error('Failed to fetch'));
        await runCheck(t.ctx);
        const parsed = t.checkEntries.map((e) => checkEntrySchema.parse(e));
        expect(parsed.map((e) => e.outcome)).toEqual(['unavailable', 'session_expired', 'schema_error', 'network_error']);
        expect(parsed[0]).toMatchObject({ freeCount: null, newCount: null, outOfRangeCount: null, newSlots: [], errorMessage: 'HTTP 500' });
        expect(parsed.map((e) => e.checkSeq)).toEqual([1, 2, 3, 4]);
    });

    it('the first check writes no reservations; a slot taken between checks is reserved, one freed is released', async () => {
        const t = setup();
        await runCheck(t.ctx);
        expect(t.reservationEvents).toEqual([]);
        // slots 0 and 1 are the fixture's reserved slots that are free in this setup; reserve slot 0 again, free slot 3
        t.setReserved(reservedWithout(1, 3));
        t.advance(60000);
        await runCheck(t.ctx);
        const events = t.reservationEvents.map((e) => reservationEventSchema.parse(e));
        const slot = (i: number) => reservedResponse.data.reservedSlots[i]!;
        expect(events.map((e) => [e.kind, e.slotFrom]).sort()).toEqual(
            [
                ['reserved', slot(0).receptionDateAndTimeFrom],
                ['released', slot(3).receptionDateAndTimeFrom],
            ].sort(),
        );
        for (const e of events) {
            expect(e).toMatchObject({
                institutionCode: institution.code,
                tabSessionId: TAB,
                previousCheckAt: new Date(NOW).toISOString(),
                detectedAt: new Date(NOW + 60000).toISOString(),
            });
        }
        expect(new Set(events.map((e) => e.clientId)).size).toBe(2);
    });

    it('a failed check keeps the previous reserved slots for the next diff', async () => {
        const t = setup();
        await runCheck(t.ctx);
        t.fail(new EconsulUnavailableError(500, 'HTTP 500'));
        t.advance(60000);
        await runCheck(t.ctx);
        t.fail(null);
        t.setReserved(reservedWithout(0, 1, 3));
        t.advance(60000);
        await runCheck(t.ctx);
        expect(t.reservationEvents).toHaveLength(1);
        expect(t.reservationEvents[0]).toMatchObject({ kind: 'released', previousCheckAt: new Date(NOW).toISOString() });
    });

    it('after the previous reserved slots are reset (institution change) there are no false reservations', async () => {
        const t = setup();
        await runCheck(t.ctx);
        t.resetPrevReserved();
        t.setReserved(reservedWithout(1, 3));
        t.advance(60000);
        await runCheck(t.ctx);
        expect(t.reservationEvents).toEqual([]);
    });
});
