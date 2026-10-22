// Check cadence: random interval, plus a short fast-check window around each day-opening moment.

export const FAST_CHECKS = { beforeMs: 120000, afterMs: 180000, minSeconds: 15, maxSeconds: 20 } as const;
// No check starts this close to an opening: at that moment the extension opens the calendar on the
// site with the same token, and a check started a second before it (5–13 s at the opening) was in
// flight with it on 2026-10-20, when the site's calendar answered «no time» at once. Fewer requests
// from one account also keep it clear of looking like a bot (the owner's decision, 2026-10-20)
export const QUIET_AT_RELEASE = { beforeMs: 15000, afterMs: 15000 } as const;
export const MIN_INTERVAL_SECONDS = 10;
export const SCHEDULE_REFRESH_MS = 1800000;
export const RELEASE_LOOKAHEAD_DAYS = 8; // enough to get past weekends and holidays

export type Release = {
  at: number;
  opening: string;
  days: { dateKey: string; display: string }[];
};

export function clampIntervalBounds(
  min: number | undefined,
  max: number | undefined,
): { min: number; max: number } {
  const lo = Math.max(MIN_INTERVAL_SECONDS, Number(min) || 60);
  const hi = Math.max(lo, Number(max) || 180);
  return { min: lo, max: hi };
}

// { active, next }: the release whose fast window contains now, and the next one after it
export function fastWindow(
  releases: readonly Release[],
  nowMs: number,
): { active: Release | null; next: Release | null } {
  const active =
    releases.find((r) => r.at - FAST_CHECKS.beforeMs <= nowMs && nowMs < r.at + FAST_CHECKS.afterMs) ?? null;
  const next = releases.find((r) => r.at - FAST_CHECKS.beforeMs > nowMs) ?? null;
  return { active, next };
}

// Random delay from the interval bounds; inside a fast window 15–20 s, and a normal delay
// that would run past the start of the next fast window is cut to that start. A check that would
// start in the quiet window of an opening (QUIET_AT_RELEASE) waits for its end
export function planNextCheck(input: {
  nowMs: number;
  bounds: { min: number; max: number };
  fastChecks: boolean;
  releases: readonly Release[];
  random: () => number;
}): { delayMs: number; kind: 'scheduled' | 'fast' } {
  const { nowMs, bounds, fastChecks, releases, random } = input;
  let delayMs = Math.round(bounds.min + random() * (bounds.max - bounds.min)) * 1000;
  let kind: 'scheduled' | 'fast' = 'scheduled';
  if (fastChecks) {
    const { active, next } = fastWindow(releases, nowMs);
    if (active) {
      delayMs = Math.round(FAST_CHECKS.minSeconds + random() * (FAST_CHECKS.maxSeconds - FAST_CHECKS.minSeconds)) * 1000;
      kind = 'fast';
    } else if (next && nowMs + delayMs > next.at - FAST_CHECKS.beforeMs) {
      delayMs = Math.max(1000, next.at - FAST_CHECKS.beforeMs - nowMs);
      kind = 'fast';
    }
  }
  const startsAt = nowMs + delayMs;
  const quiet = releases.find(
    (r) => r.at - QUIET_AT_RELEASE.beforeMs <= startsAt && startsAt < r.at + QUIET_AT_RELEASE.afterMs,
  );
  if (quiet) {
    delayMs = quiet.at + QUIET_AT_RELEASE.afterMs - nowMs;
    kind = 'fast';
  }
  return { delayMs, kind };
}
