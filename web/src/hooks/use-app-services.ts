import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { ExtensionState, createExtensionLink } from '@/application/extension-link.ts';
import type { Monitor, MonitorState } from '@/application/monitor.ts';
import type { Clock, Scheduler } from '@/application/ports.ts';

export type ExtensionLink = ReturnType<typeof createExtensionLink>;

// What the UI gets from the composition root (src/app/providers.tsx). Shared by every feature:
// features read the monitor and the extension link here, never from each other.
export type AppServices = {
    monitor: Monitor;
    extensionLink: ExtensionLink;
    clock: Clock;
    scheduler: Scheduler;
};

export const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
    const services = useContext(AppServicesContext);
    if (!services) throw new Error('AppServicesContext is missing: wrap the tree in <AppProviders>');
    return services;
}

export function useMonitor(): Monitor {
    return useAppServices().monitor;
}

export function useMonitorState(): MonitorState {
    const monitor = useMonitor();
    return useSyncExternalStore(monitor.subscribe, monitor.getState);
}

export function useExtensionState(): ExtensionState {
    const { extensionLink } = useAppServices();
    return useSyncExternalStore(extensionLink.subscribe, extensionLink.getState);
}

// The clock in whole seconds, ticking once a second while something is subscribed
export function useNowSeconds(): number {
    const { clock, scheduler } = useAppServices();
    const subscribe = useCallback(
        (onTick: () => void) => {
            const handle = scheduler.setInterval(onTick, 1000);
            return () => scheduler.clear(handle);
        },
        [scheduler],
    );
    return useSyncExternalStore(subscribe, () => Math.floor(clock.now() / 1000));
}
