// What the «Наступне відкриття» card shows, computed from the monitor's releases (slots.html
// renderReleaseInfo() / describeRelease()). Pure: the browser and consulate offsets come in.
import { FAST_CHECKS, fastWindow, type Release } from '@/domain/monitoring/schedule.ts';
import { dayOfWeek, parseTimeFromISO } from '@/domain/slots/time.ts';

const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export type ReleasesView = {
    moment: string; // «сб, 10.10 о 10:00», browser time
    consulate: string; // «09:00 за часом консульства (GMT−06:00)»
    opens: string; // «пт, 02.04.2027»
    slotsText: string; // «18 слотів по 10 хв»
    countdown: string; // «через 17 год 12 хв» / «відкрито»
    fastWindow: string; // «Часті перевірки 09:58–10:03», browser time
    active: boolean; // inside the fast window now
    later: string[]; // «вт, 13.10 → пн, 05.04», up to two more moments
};

const pad = (n: number): string => String(n).padStart(2, '0');

// 'YYYY-MM-DD' → 'ср, 31.03'
export function formatDayLabel(dateKey: string): string {
    return `${WEEKDAYS[dayOfWeek(dateKey)]}, ${dateKey.slice(8, 10)}.${dateKey.slice(5, 7)}`;
}

// '-06:00' → 'GMT−06:00' (a real minus sign, as in the design)
export function formatGmt(offset: string): string {
    return `GMT${offset.replace('-', '−')}`;
}

export function formatCountdown(ms: number): string {
    if (ms < 60_000) return `${Math.max(0, Math.ceil(ms / 1000))} с`;
    const totalMinutes = Math.round(ms / 60_000);
    const d = Math.floor(totalMinutes / 1440);
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    if (d) return `${d} д ${h} год`;
    return h ? `${h} год ${pad(m)} хв` : `${m} хв`;
}

function browserParts(ms: number, offsetMinutes: number): { dateKey: string; time: string } {
    const iso = new Date(ms + offsetMinutes * 60_000).toISOString();
    return { dateKey: iso.slice(0, 10), time: iso.slice(11, 16) };
}

function slotCount(days: Release['days'], slotMinutes: number): number {
    return days.reduce((sum, day) => {
        const [from = '', to = ''] = day.display.split('-');
        const minutes = parseTimeFromISO(`0000-00-00T${to}`).totalMinutes - parseTimeFromISO(`0000-00-00T${from}`).totalMinutes;
        return sum + Math.max(0, Math.floor(minutes / slotMinutes));
    }, 0);
}

function opensLabel(days: Release['days']): string {
    return days.map((day) => `${formatDayLabel(day.dateKey)}.${day.dateKey.slice(0, 4)}`).join(', ');
}

export function buildReleasesView(input: {
    releases: readonly Release[];
    nowMs: number;
    browserOffsetMinutes: number;
    consulateOffset: string; // '-06:00'
    slotMinutes: number;
}): ReleasesView | null {
    const { releases, nowMs, browserOffsetMinutes, consulateOffset, slotMinutes } = input;
    const { active } = fastWindow(releases, nowMs);
    const current = active ?? releases[0];
    if (!current) return null;
    const moment = browserParts(current.at, browserOffsetMinutes);
    const from = browserParts(current.at - FAST_CHECKS.beforeMs, browserOffsetMinutes).time;
    const to = browserParts(current.at + FAST_CHECKS.afterMs, browserOffsetMinutes).time;
    const later = releases
        .filter((release) => release !== current && release.at > current.at)
        .slice(0, 2)
        .map((release) => {
            const day = browserParts(release.at, browserOffsetMinutes).dateKey;
            const opened = release.days.map((d) => formatDayLabel(d.dateKey)).join(', ');
            return `${formatDayLabel(day)} → ${opened}`;
        });
    const total = slotCount(current.days, slotMinutes);
    return {
        moment: `${formatDayLabel(moment.dateKey)} о ${moment.time}`,
        consulate: `${current.opening} за часом консульства (${formatGmt(consulateOffset)})`,
        opens: opensLabel(current.days),
        slotsText: `${total} слотів по ${slotMinutes} хв`,
        countdown: current.at > nowMs ? `через ${formatCountdown(current.at - nowMs)}` : 'відкрито',
        fastWindow: `Часті перевірки ${from}–${to}`,
        active: active !== null,
        later,
    };
}
