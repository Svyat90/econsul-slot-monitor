import { describe, expect, it } from 'vitest';
import {
  FAST_CHECKS,
  clampIntervalBounds,
  fastWindow,
  planNextCheck,
  type Release,
} from './schedule.ts';

const NOW = 1_800_000_000_000;
const release = (at: number): Release => ({
  at,
  opening: '09:00',
  days: [{ dateKey: '2026-01-01', display: '01.01.2026' }],
});
const bounds = { min: 60, max: 180 };

describe('clampIntervalBounds', () => {
  it('defaults to 60-180', () => {
    expect(clampIntervalBounds(undefined, undefined)).toEqual({ min: 60, max: 180 });
  });
  it('raises min to the floor and max to min', () => {
    expect(clampIntervalBounds(3, 5)).toEqual({ min: 10, max: 10 });
  });
});

describe('fastWindow', () => {
  const releases = [release(NOW + 10 * 60_000), release(NOW + 60 * 60_000)];
  it('finds next before the window', () => {
    expect(fastWindow(releases, NOW)).toEqual({ active: null, next: releases[0] });
  });
  it('finds active inside the window, boundary included at start', () => {
    const now = releases[0]!.at - FAST_CHECKS.beforeMs;
    expect(fastWindow(releases, now).active).toBe(releases[0]);
    expect(fastWindow(releases, now).next).toBe(releases[1]);
  });
  it('window end is exclusive', () => {
    const now = releases[0]!.at + FAST_CHECKS.afterMs;
    expect(fastWindow(releases, now).active).toBeNull();
  });
});

describe('planNextCheck', () => {
  it('uses a random delay within bounds', () => {
    const r = planNextCheck({ nowMs: NOW, bounds, fastChecks: true, releases: [], random: () => 0.5 });
    expect(r).toEqual({ delayMs: 120_000, kind: 'scheduled' });
  });
  it('uses 15-20 s inside a fast window', () => {
    const releases = [release(NOW + 60_000)];
    const r = planNextCheck({ nowMs: NOW, bounds, fastChecks: true, releases, random: () => 1 });
    expect(r).toEqual({ delayMs: 20_000, kind: 'fast' });
  });
  it('cuts a delay that would pass the next window start', () => {
    const releases = [release(NOW + 4 * 60_000)];
    const r = planNextCheck({ nowMs: NOW, bounds, fastChecks: true, releases, random: () => 1 });
    expect(r).toEqual({ delayMs: 2 * 60_000, kind: 'fast' });
  });
  it('cut delay is at least 1 s', () => {
    const releases = [release(NOW + 2 * 60_000 + 1_000_000)];
    const r = planNextCheck({
      nowMs: NOW + 1_000_000 - 1,
      bounds,
      fastChecks: true,
      releases,
      random: () => 1,
    });
    expect(r.delayMs).toBe(1000);
  });
  it('ignores windows when fastChecks is off', () => {
    const releases = [release(NOW + 60_000)];
    const r = planNextCheck({ nowMs: NOW, bounds, fastChecks: false, releases, random: () => 0 });
    expect(r).toEqual({ delayMs: 60_000, kind: 'scheduled' });
  });
});
