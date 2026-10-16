import type { ExtensionState } from '@/application/extension-link.ts';

export const TOKEN_WARNING_MS = 30 * 60_000; // the same threshold as slots.html

export type SessionBanner =
    | { kind: 'login'; resumes: boolean } // not logged in; `resumes`: the monitor was stopped by the session
    | { kind: 'expiring'; exp: number };

// Same rules as slots.html renderExtStatus(): nothing without the extension or while its
// session state is unknown
export function sessionBanner(
    extension: Pick<ExtensionState, 'connected' | 'auth'>,
    stoppedBy: string | null,
    nowMs: number,
): SessionBanner | null {
    const { connected, auth } = extension;
    if (!connected || !auth || auth.loggedIn === null) return null;
    if (!auth.loggedIn || (auth.exp !== null && auth.exp <= nowMs)) return { kind: 'login', resumes: stoppedBy === 'session' };
    if (auth.exp !== null && auth.exp - nowMs < TOKEN_WARNING_MS) return { kind: 'expiring', exp: auth.exp };
    return null;
}

const DRAFT_TTL_MS = 24 * 3600_000; // the site deletes an unsent draft a day after creation

export type DraftBanner =
    | { kind: 'creating' } // the extension is filling steps 1–3
    | { kind: 'failed'; text: string | null }
    | { kind: 'missing' } // monitoring runs, but there is no draft to pick a slot in
    | { kind: 'expired'; at: number };

// Monitoring finds slots, but the extension picks one only in a draft. Warn when there is none
// (or the site has deleted it) while monitoring runs. Nothing without the extension, and nothing
// while the session banner already asks to log in
export function draftBanner(
    extension: Pick<ExtensionState, 'connected' | 'auth' | 'draft' | 'draftJob'>,
    monitorRunning: boolean,
    nowMs: number,
): DraftBanner | null {
    const { connected, auth, draft, draftJob } = extension;
    if (!connected || auth?.loggedIn !== true) return null;
    if (draftJob?.status === 'running') return { kind: 'creating' };
    if (draftJob?.status === 'failed') return { kind: 'failed', text: draftJob.text };
    if (!monitorRunning) return null;
    if (!draft) return { kind: 'missing' };
    const expiresAt = draft.expiresAt ?? draft.savedAt + DRAFT_TTL_MS;
    return nowMs >= expiresAt ? { kind: 'expired', at: expiresAt } : null;
}

const ALARM_AFTER_MS = 3 * 60_000; // the reminder lasts until a little after the opening

// The reminder fired and the opening is near: the session banner adds the opening time, and a
// monitor that is not running gets its own banner. Gone as soon as the monitor runs, or the
// opening has passed
export function alarmActive(alarm: ExtensionState['alarm'], nowMs: number): alarm is { at: number } {
    return alarm !== null && nowMs < alarm.at + ALARM_AFTER_MS;
}

const WEEKDAYS = ['нд', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

// ['2027-03-31 09:50', '2027-03-31 11:40'] -> 'ср 31.03 09:50, 11:40'; days separated by ' · '
// At most MAX_DAYS days, like the notification of slots.html alertSlots(): "…and N more day(s)"
const MAX_DAYS = 4;

export function formatFreshSlots(keys: readonly string[]): string {
    const days = new Map<string, string[]>();
    for (const key of [...keys].sort()) {
        const [date, time] = key.split(' ');
        if (!date || !time) continue;
        days.set(date, [...(days.get(date) ?? []), time]);
    }
    const shown = [...days].slice(0, MAX_DAYS);
    const more = days.size - shown.length;
    return shown
        .map(([date, times]) => {
            const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
            const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
            return `${weekday} ${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')} ${times.join(', ')}`;
        })
        .join(' · ') + (more > 0 ? ` · …і ще ${more} дн.` : '');
}

// '2 нові', '1 новий', '5 нових'
export function freshBadge(count: number): string {
    const last = count % 10;
    const teen = count % 100 >= 11 && count % 100 <= 14;
    const word = last === 1 && !teen ? 'новий' : last >= 2 && last <= 4 && !teen ? 'нові' : 'нових';
    return `${count} ${word}`;
}

export function formatClock(ms: number): string {
    return new Date(ms).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}
