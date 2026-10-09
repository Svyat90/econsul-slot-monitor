import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserClock, browserScheduler } from './browser-runtime.ts';

afterEach(() => vi.useRealTimers());

describe('browser runtime', () => {
    it('localDateKey is the browser calendar date, as getDateKey()', () => {
        const ms = new Date(2026, 2, 5, 23, 30).getTime();
        expect(browserClock.localDateKey(ms)).toBe('2026-03-05');
        expect(browserClock.browserOffsetMinutes(ms)).toBe(-new Date(ms).getTimezoneOffset());
    });

    it('scheduler fires and clears timeouts and intervals', () => {
        vi.useFakeTimers();
        const once = vi.fn();
        const every = vi.fn();
        browserScheduler.setTimeout(once, 100);
        const handle = browserScheduler.setInterval(every, 50);
        vi.advanceTimersByTime(120);
        expect(once).toHaveBeenCalledTimes(1);
        expect(every).toHaveBeenCalledTimes(2);
        browserScheduler.clear(handle);
        browserScheduler.clear(null);
        vi.advanceTimersByTime(200);
        expect(every).toHaveBeenCalledTimes(2);
    });
});
