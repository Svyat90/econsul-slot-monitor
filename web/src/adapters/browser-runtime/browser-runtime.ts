// Clock, Random and Scheduler over the browser's Date, Math.random and timers.
import type { Clock, Ids, Random, Scheduler, TimerHandle } from '@/application/ports.ts';

const pad = (n: number): string => String(n).padStart(2, '0');

export const browserClock: Clock = {
    now: () => Date.now(),
    // slots.html getDateKey(): the browser's own calendar date
    localDateKey(ms) {
        const date = new Date(ms);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },
    browserOffsetMinutes: (ms) => -new Date(ms).getTimezoneOffset(),
};

export const browserRandom: Random = {
    next: () => Math.random(),
};

export const browserIds: Ids = {
    uuid: () => crypto.randomUUID(),
};

export const browserScheduler: Scheduler = {
    setTimeout(callback, delayMs) {
        return { id: globalThis.setTimeout(callback, delayMs) };
    },
    setInterval(callback, everyMs) {
        return { id: globalThis.setInterval(callback, everyMs) };
    },
    clear(handle: TimerHandle | null) {
        if (!handle) return;
        // clearTimeout and clearInterval share one id space in browsers
        globalThis.clearTimeout(handle.id as ReturnType<typeof setTimeout>);
    },
};
