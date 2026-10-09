// Fake app services for component tests: a monitor and an extension link whose state the test
// sets, with spies for the actions. Never the real adapters (they would touch the network).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { vi } from 'vitest';
import type { ExtensionState } from '@/application/extension-link.ts';
import type { Monitor, MonitorState } from '@/application/monitor.ts';
import type { Summary } from '@contracts/summary.ts';
import type { Clock, LogHistory, NotificationPermissionState, Scheduler } from '@/application/ports.ts';
import { AppServicesContext, type AppServices } from '@/hooks/use-app-services.ts';

export const baseMonitorState: MonitorState = {
    locations: null,
    selection: null,
    hasToken: false,
    running: false,
    checking: false,
    checks: 0,
    nextAt: 0,
    nextKind: 'scheduled',
    lastResult: '',
    stoppedBy: null,
    interval: { min: 60, max: 180 },
    fastChecks: true,
    dateRange: { from: null, to: null },
    schedule: null,
    reserved: null,
    free: null,
    releases: [],
    outOfRange: null,
    lastFresh: [],
    log: [],
    tabTitleMarks: true,
};

export const baseExtensionState: ExtensionState = { connected: false, version: null, auth: null, autoBook: false, draft: null };

export function createFakeServices(options: { monitor?: Partial<MonitorState>; extension?: Partial<ExtensionState>; now?: number } = {}) {
    let monitorState: MonitorState = { ...baseMonitorState, ...options.monitor };
    let extensionState: ExtensionState = { ...baseExtensionState, ...options.extension };
    const monitorListeners = new Set<() => void>();
    const extensionListeners = new Set<() => void>();
    const subscribeTo = (set: Set<() => void>) => (listener: () => void) => {
        set.add(listener);
        return () => { set.delete(listener); };
    };
    const monitor = {
        getState: () => monitorState,
        subscribe: subscribeTo(monitorListeners),
        on: () => () => {},
        init: vi.fn(async () => {}),
        start: vi.fn(async () => {}),
        stop: vi.fn(),
        checkNow: vi.fn(async () => {}),
        setToken: vi.fn(),
        sessionLost: vi.fn(),
        setSelection: vi.fn(),
        setInterval: vi.fn(),
        setFastChecks: vi.fn(),
        setDateRange: vi.fn(),
        setTabTitleMarks: vi.fn(),
        notificationPermission: vi.fn((): NotificationPermissionState => 'default'),
        requestNotifications: vi.fn(async (): Promise<NotificationPermissionState> => 'default'),
        audioReady: vi.fn(() => false),
        testAlert: vi.fn(async () => {}),
        log: vi.fn(),
        dispose: vi.fn(),
    } satisfies Monitor;
    const extensionLink = {
        getState: () => extensionState,
        subscribe: subscribeTo(extensionListeners),
        start: vi.fn(),
        dispose: vi.fn(),
        login: vi.fn(),
        setAutoBook: vi.fn(),
        setDraftUrl: vi.fn(),
        testSound: vi.fn(),
        userGesture: vi.fn(),
    };
    const clock: Clock = { now: () => options.now ?? Date.UTC(2026, 9, 9, 12), localDateKey: () => '2026-10-09', browserOffsetMinutes: () => -300 };
    const scheduler: Scheduler = { setTimeout: () => ({ id: 0 }), setInterval: () => ({ id: 0 }), clear: () => {} };
    const emptyPage = { entries: [], nextCursor: null };
    const emptySummary: Summary = { checks: { total: 0, fast: 0, failed: 0 }, newFree: { total: 0, lastAt: null }, reservations: { reserved: 0, released: 0 } };
    const history = {
        summary: vi.fn<LogHistory['summary']>(async () => emptySummary),
        checks: vi.fn<LogHistory['checks']>(async () => emptyPage),
        reservations: vi.fn<LogHistory['reservations']>(async () => emptyPage),
        scheduleChanges: vi.fn<LogHistory['scheduleChanges']>(async () => emptyPage),
        scheduleLogDownloadUrl: () => '/api/schedule-log.jsonl',
    } satisfies LogHistory;
    const openBooking = vi.fn();
    const services = { monitor, extensionLink, clock, scheduler, history, openBooking } as unknown as AppServices;
    return {
        services,
        monitor,
        extensionLink,
        history,
        openBooking,
        setMonitorState(patch: Partial<MonitorState>) {
            monitorState = { ...monitorState, ...patch };
            monitorListeners.forEach((l) => l());
        },
        setExtensionState(patch: Partial<ExtensionState>) {
            extensionState = { ...extensionState, ...patch };
            extensionListeners.forEach((l) => l());
        },
        // A fresh query client per test, without retries, so errors show at once
        wrapper: function FakeServicesWrapper({ children }: { children: ReactNode }) {
            const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
            return (
                <QueryClientProvider client={client}>
                    <AppServicesContext value={services}>{children}</AppServicesContext>
                </QueryClientProvider>
            );
        },
    };
}
