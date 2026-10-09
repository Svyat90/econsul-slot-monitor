import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { createAlerts } from '@/adapters/alerts/alerts.ts';
import { browserClock, browserIds, browserRandom, browserScheduler } from '@/adapters/browser-runtime/browser-runtime.ts';
import { createEconsulApi } from '@/adapters/econsul-api/econsul-api.ts';
import { createExtensionBridge } from '@/adapters/extension-bridge/extension-bridge.ts';
import { createLocationsSource } from '@/adapters/locations-source/locations-source.ts';
import { createLogHistory } from '@/adapters/log-history/log-history.ts';
import { withRequestLog } from '@/adapters/request-log/request-log.ts';
import { createServerApi } from '@/adapters/server-api/server-api.ts';
import { createSettingsStore } from '@/adapters/settings-store/settings-store.ts';
import { createExtensionLink } from '@/application/extension-link.ts';
import { createMonitor } from '@/application/monitor.ts';
import { bookingUrl } from '@/domain/booking/booking-url.ts';
import { AppServicesContext, type AppServices } from '@/hooks/use-app-services.ts';

// Written into every log entry; vite.config.ts takes it from package.json `version`
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';

// Composition root: the only place that picks adapters for ports and builds the use cases.
type Services = { app: AppServices; flush: () => Promise<void> };

function createServices(): Services {
    const alerts = createAlerts();
    const settings = createSettingsStore();
    const bridge = createExtensionBridge();
    const clock = browserClock;
    const scheduler = browserScheduler;
    const links: { current: ReturnType<typeof createExtensionLink> | null } = { current: null };
    const serverApi = createServerApi({ scheduler });
    const session = { tabSessionId: browserIds.uuid(), appVersion: APP_VERSION };
    const monitor = createMonitor({
        econsul: withRequestLog(createEconsulApi(), { server: serverApi, clock, ids: browserIds, session }),
        server: serverApi,
        locations: createLocationsSource(),
        settings,
        alerts,
        clock,
        ids: browserIds,
        session,
        random: browserRandom,
        scheduler,
        extensionConnected: () => links.current?.getState().connected ?? false,
        openBooking: () => alerts.openUrl(bookingUrl(settings.loadDraft()?.url ?? null)),
    });
    const extensionLink = createExtensionLink({ bridge, monitor, settings, alerts, clock, scheduler });
    links.current = extensionLink;
    return { app: { monitor, extensionLink, clock, scheduler, history: createLogHistory() }, flush: serverApi.flush };
}

// One set of services and one start for the page's lifetime, also under StrictMode's double effects
let services: Services | null = null;
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
let started = false;

function getServices(): Services {
    services ??= createServices();
    return services;
}

export function AppProviders({ children }: { children: ReactNode }) {
    const { app: value, flush } = getServices();
    useEffect(() => {
        if (started) return;
        started = true;
        void value.monitor.init();
        value.extensionLink.start();
        // A click anywhere unlocks this page's audio, so it can play the session sound itself
        document.addEventListener('click', () => value.extensionLink.userGesture(), { capture: true });
        // Send the batched log entries before the tab goes away
        window.addEventListener('pagehide', () => void flush());
    }, [value, flush]);
    return (
        <QueryClientProvider client={queryClient}>
            <AppServicesContext value={value}>{children}</AppServicesContext>
        </QueryClientProvider>
    );
}
