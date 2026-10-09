import { useEffect, type ReactNode } from 'react';
import { createAlerts } from '@/adapters/alerts/alerts.ts';
import { browserClock, browserRandom, browserScheduler } from '@/adapters/browser-runtime/browser-runtime.ts';
import { createEconsulApi } from '@/adapters/econsul-api/econsul-api.ts';
import { createExtensionBridge } from '@/adapters/extension-bridge/extension-bridge.ts';
import { createLocationsSource } from '@/adapters/locations-source/locations-source.ts';
import { createServerApi } from '@/adapters/server-api/server-api.ts';
import { createSettingsStore } from '@/adapters/settings-store/settings-store.ts';
import { createExtensionLink } from '@/application/extension-link.ts';
import { createMonitor } from '@/application/monitor.ts';
import { bookingUrl } from '@/domain/booking/booking-url.ts';
import { AppServicesContext, type AppServices } from '@/hooks/use-app-services.ts';

// Composition root: the only place that picks adapters for ports and builds the use cases.
function createServices(): AppServices {
    const alerts = createAlerts();
    const settings = createSettingsStore();
    const bridge = createExtensionBridge();
    const clock = browserClock;
    const scheduler = browserScheduler;
    const links: { current: ReturnType<typeof createExtensionLink> | null } = { current: null };
    const monitor = createMonitor({
        econsul: createEconsulApi(),
        server: createServerApi(),
        locations: createLocationsSource(),
        settings,
        alerts,
        clock,
        random: browserRandom,
        scheduler,
        extensionConnected: () => links.current?.getState().connected ?? false,
        openBooking: () => alerts.openUrl(bookingUrl(settings.loadDraft()?.url ?? null)),
    });
    const extensionLink = createExtensionLink({ bridge, monitor, settings, alerts, clock, scheduler });
    links.current = extensionLink;
    return { monitor, extensionLink, clock, scheduler };
}

// One set of services and one start for the page's lifetime, also under StrictMode's double effects
let services: AppServices | null = null;
let started = false;

function getServices(): AppServices {
    services ??= createServices();
    return services;
}

export function AppProviders({ children }: { children: ReactNode }) {
    const value = getServices();
    useEffect(() => {
        if (started) return;
        started = true;
        void value.monitor.init();
        value.extensionLink.start();
        // A click anywhere unlocks this page's audio, so it can play the session sound itself
        document.addEventListener('click', () => value.extensionLink.userGesture(), { capture: true });
    }, [value]);
    return <AppServicesContext value={value}>{children}</AppServicesContext>;
}
