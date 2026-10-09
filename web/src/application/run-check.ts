// One monitoring check (slots.html runCheck(), recordScheduleSnapshot(), getUpcomingReleases(),
// alertSlots(), alertSession()) as a function over the state and the ports. No timers: monitor.ts
// plans the checks. Order of effects as in the original: request -> calculation -> new state ->
// alert -> extension -> log -> next check.
import type { ReservedSlot, ScheduleResponse, ScheduleRow } from '@/domain/contracts/econsul.ts';
import { SessionExpiredError } from '@/domain/contracts/errors.ts';
import type { Institution, Locations } from '@/domain/contracts/locations.ts';
import { diffSnapshots, scheduleSnapshot } from '@/domain/monitoring/schedule-changes.ts';
import { upcomingReleases } from '@/domain/monitoring/releases.ts';
import { SCHEDULE_REFRESH_MS, type Release } from '@/domain/monitoring/schedule.ts';
import { diffFreeSlots, formatSlotLines, type DateRange, type SlotKey } from '@/domain/monitoring/slots-diff.ts';
import { calculateFreeSlots, collectNonWorking, type FreeSlots } from '@/domain/slots/free-slots.ts';
import {
    buildScheduleDays,
    holidaySet,
    serviceConsulHashes,
    type ScheduleInput,
} from '@/domain/slots/schedule-days.ts';
import { consulateOffset } from '@/domain/slots/time.ts';
import type { Alerts, Clock, EconsulApi, ServerApi, SettingsStore } from './ports.ts';

export type StopCause = 'user' | 'session' | 'other';
export type CheckKind = 'scheduled' | 'fast' | 'manual';
export type MonitorLogEntry = { at: number; message: string; kind: 'info' | 'found' | 'warn' | 'error' };

export type MonitorState = {
    locations: Locations | null;
    selection: { institution: Institution; serviceCode: string } | null;
    hasToken: boolean;
    running: boolean;
    checking: boolean;
    checks: number;
    nextAt: number;
    nextKind: 'scheduled' | 'fast';
    lastResult: string;
    stoppedBy: StopCause | null;
    interval: { min: number; max: number };
    fastChecks: boolean;
    dateRange: DateRange;
    schedule: { rows: ScheduleRow[]; fetchedAt: number } | null;
    reserved: ReservedSlot[] | null;
    free: FreeSlots | null;
    releases: Release[];
    outOfRange: { dropped: number; total: number; at: number } | null;
    lastFresh: SlotKey[];
    log: MonitorLogEntry[]; // newest first, at most 100
};

export const DEFAULT_TITLE = 'Монітор слотів';
const DEFAULT_SLOT_MINUTES = 10;
const DEFAULT_NUMBER_WEEKS = 25;

export type RunCheckContext = {
    econsul: EconsulApi;
    server: ServerApi;
    settings: SettingsStore;
    alerts: Alerts;
    clock: Clock;
    extensionConnected: () => boolean;
    openBooking: () => void;
    getState: () => MonitorState;
    patch: (patch: Partial<MonitorState>) => void;
    log: (message: string, kind?: MonitorLogEntry['kind']) => void;
    getToken: () => string;
    getKnownFree: () => ReadonlySet<SlotKey> | null;
    setKnownFree: (known: Set<SlotKey>) => void;
    stop: (reason: string, cause: StopCause) => void;
    emitNewSlots: (fresh: SlotKey[], free: FreeSlots) => void;
    emitAuthFailed: (status: number, token: string) => void;
};

// "HH:MM:SS" in the browser's time zone, from the clock port (no Date.now(), no locale)
function formatTime(clock: Clock, ms: number): string {
    return new Date(ms + clock.browserOffsetMinutes(ms) * 60000).toISOString().slice(11, 19);
}

function rowsOf(response: ScheduleResponse): ScheduleRow[] {
    return response.data.flatMap((entry) => (entry.data ? [entry.data] : []));
}

function scheduleInput(
    selection: NonNullable<MonitorState['selection']>,
    locations: Locations,
    rows: readonly ScheduleRow[],
    reserved: readonly ReservedSlot[],
    clock: Clock,
    nowMs: number,
): ScheduleInput {
    const { institution, serviceCode } = selection;
    const sampleIsos = [
        ...rows.flatMap((row) => (row.nonWorkingTime ?? []).map((z) => z.notWorkingDateAndHoursFrom)),
        ...reserved.map((slot) => slot.receptionDateAndTimeFrom),
    ];
    return {
        rows,
        serviceCode,
        numberWeeks: institution.numberWeeks || DEFAULT_NUMBER_WEEKS,
        offset: consulateOffset(institution.timeZone, sampleIsos, clock.browserOffsetMinutes(nowMs)),
        holidays: holidaySet(locations.holidays, serviceCode),
        localDateKey: (ms) => clock.localDateKey(ms),
    };
}

// recordScheduleSnapshot(): compare with the snapshot kept in the settings store and report a change
function recordScheduleSnapshot(ctx: RunCheckContext, institution: Institution, rows: readonly ScheduleRow[]): void {
    const now = ctx.clock.now();
    const snapshotRows = scheduleSnapshot(rows);
    const prev = ctx.settings.loadScheduleSnapshot(institution.code);
    let entry:
        | { type: 'baseline'; changes: string[] }
        | { type: 'changed'; previousCheckAt: string; changes: string[] }
        | null = null;
    if (!prev) {
        const consuls = new Set(snapshotRows.map((row) => row.consul)).size;
        entry = {
            type: 'baseline',
            changes: [`first snapshot: ${snapshotRows.length} schedule entries, ${consuls} consul(s)`],
        };
    } else {
        const changes = diffSnapshots(prev.rows, snapshotRows, ctx.clock.localDateKey(now));
        if (changes.length) entry = { type: 'changed', previousCheckAt: prev.checkedAt, changes };
    }
    const checkedAt = new Date(now).toISOString();
    ctx.settings.saveScheduleSnapshot(institution.code, { checkedAt, rows: snapshotRows });
    if (entry) {
        ctx.server.recordScheduleChange({
            time: checkedAt,
            institutionCode: institution.code,
            institution: institution.name,
            ...entry,
        });
        ctx.log(
            entry.type === 'baseline'
                ? 'Розклад: збережено перший знімок'
                : `Розклад змінено: змін — ${entry.changes.length}`,
            entry.type === 'baseline' ? 'info' : 'warn',
        );
    }
}

// getUpcomingReleases(): recomputed after every schedule refresh instead of cached with a TTL
function computeReleases(
    selection: NonNullable<MonitorState['selection']>,
    locations: Locations,
    rows: readonly ScheduleRow[],
    clock: Clock,
): Release[] {
    const now = clock.now();
    return upcomingReleases(scheduleInput(selection, locations, rows, [], clock, now), now);
}

function alertSlots(ctx: RunCheckContext, institution: Institution, fresh: readonly SlotKey[], totalFree: number): void {
    const lines = formatSlotLines(fresh);
    const body =
        lines.slice(0, 4).join('\n') +
        (lines.length > 4 ? `\n…і ще днів: ${lines.length - 4}` : '') +
        `\nУсього вільних: ${totalFree}`;
    ctx.alerts.newSlots({
        title: `Нові вільні слоти: ${institution.name}`,
        body: `${body}\nНатисніть, щоб записатися на e-consul`,
        onClick: ctx.openBooking,
    });
    ctx.alerts.setTabTitle(`🟢 Нових слотів: ${fresh.length} — ${DEFAULT_TITLE}`);
}

function alertSession(ctx: RunCheckContext, error: SessionExpiredError): void {
    // With the extension connected it shows its own system notification with "Увійти"
    ctx.alerts.sessionExpired({
        title: 'Сесія e-consul завершилась',
        body: `Токен більше не працює (${error.message}). Увійдіть на e-consul.gov.ua, вставте новий токен і запустіть моніторинг знову.`,
        notify: !ctx.extensionConnected(),
    });
    ctx.alerts.setTabTitle(`🔴 Сесія завершилась — ${DEFAULT_TITLE}`);
}

// Returns false if a check is already running or the session ended, true otherwise.
export async function runCheck(ctx: RunCheckContext, kind: CheckKind = 'scheduled'): Promise<boolean> {
    const before = ctx.getState();
    if (before.checking) return false;
    const { selection, locations } = before;
    if (!selection || !locations) return false;
    const { institution, serviceCode } = selection;
    const checkNumber = before.checks + 1;
    const label =
        `Перевірка #${checkNumber}` + (kind === 'scheduled' ? '' : kind === 'fast' ? ' (часта)' : ' (ручна)');
    ctx.patch({ checking: true, checks: checkNumber, nextAt: 0 });
    // the user may switch the institution while a request is in flight: drop the stale answer
    const stale = () => ctx.getState().selection !== selection;
    try {
        let state = ctx.getState();
        if (!state.schedule || ctx.clock.now() - state.schedule.fetchedAt > SCHEDULE_REFRESH_MS) {
            const response = await ctx.econsul.getSchedule(institution.code, ctx.getToken());
            if (stale()) return true;
            const rows = rowsOf(response);
            ctx.patch({
                schedule: { rows, fetchedAt: ctx.clock.now() },
                releases: computeReleases(selection, locations, rows, ctx.clock),
            });
            recordScheduleSnapshot(ctx, institution, rows);
            state = ctx.getState();
        }
        const scheduleRows = state.schedule?.rows ?? [];
        const consulHashes = serviceConsulHashes(scheduleRows, serviceCode);
        if (consulHashes.length === 0) {
            ctx.patch({ lastResult: 'жоден консул не надає цієї послуги' });
            ctx.log(`${label}: жоден консул цієї установи не надає вибрану послугу`, 'warn');
            return true;
        }
        const reservedResponse = await ctx.econsul.getReservedSlots(
            { institutionCode: institution.code, consulIpnHash: consulHashes },
            ctx.getToken(),
        );
        if (stale()) return true;
        const reserved = reservedResponse.data.reservedSlots;
        const now = ctx.clock.now();
        const free = calculateFreeSlots({
            days: buildScheduleDays(scheduleInput(selection, locations, scheduleRows, reserved, ctx.clock, now), now),
            nonWorking: collectNonWorking(scheduleRows, serviceCode),
            reserved,
            slotMinutes: institution.serviceMinutes[serviceCode] || DEFAULT_SLOT_MINUTES,
        });

        // knownFree holds every free slot, so a slot outside the date range does not count as
        // new later just because the range was widened
        const { inRange, fresh, outside, known } = diffFreeSlots({
            free: free.keys,
            knownFree: ctx.getKnownFree(),
            range: state.dateRange,
        });
        ctx.setKnownFree(known);
        const lastResult =
            `вільних: ${inRange.length}` +
            (outside ? ` (ще ${outside} поза датами)` : '') +
            (fresh.length ? `, нових: ${fresh.length}` : '') +
            `, о ${formatTime(ctx.clock, now)}`;
        ctx.patch({
            reserved,
            free,
            outOfRange: { dropped: outside, total: free.keys.length, at: now },
            lastResult,
            lastFresh: fresh,
        });
        // The log shows newest entries first: add the per-date lines before the check line
        // so they read below it, earliest date first
        formatSlotLines(fresh)
            .reverse()
            .forEach((line) => ctx.log(`  нові: ${line}`, 'found'));
        ctx.log(
            `${label}: вільних слотів: ${inRange.length}` +
                (outside ? `, поза діапазоном дат: ${outside}` : '') +
                (fresh.length ? `, нових: ${fresh.length}` : ''),
            fresh.length ? 'found' : 'info',
        );
        if (fresh.length) {
            alertSlots(ctx, institution, fresh, inRange.length);
            ctx.emitNewSlots(fresh, free);
        }
    } catch (error) {
        if (error instanceof SessionExpiredError) {
            ctx.patch({ lastResult: `сесія завершилась (${error.message})` });
            ctx.stop(`Сесія завершилась (${error.message})`, 'session');
            alertSession(ctx, error);
            ctx.emitAuthFailed(error.status, ctx.getToken());
            return false;
        }
        const message = error instanceof Error ? error.message : String(error);
        ctx.patch({ lastResult: `помилка: ${message}` });
        ctx.log(`${label}: помилка: ${message}`, 'error');
    } finally {
        ctx.patch({ checking: false });
    }
    return true;
}
