import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { ExtensionState } from '@/application/extension-link.ts';
import type { Monitor, MonitorState } from '@/application/monitor.ts';
import type { Clock, Scheduler } from '@/application/ports.ts';
import { StatusBlock } from './StatusBlock.tsx';
import { AppServicesContext, type ExtensionLink } from '@/hooks/use-app-services.ts';

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);

const baseState: MonitorState = {
    locations: null,
    selection: { institution: { code: '1' } as never, serviceCode: '1' },
    hasToken: true,
    running: false,
    checking: false,
    checks: 0,
    nextAt: 0,
    nextKind: 'scheduled',
    lastResult: '',
    stoppedBy: null,
    interval: { min: 60, max: 120 },
    fastChecks: true,
    dateRange: { from: null, to: null },
    schedule: null,
    reserved: null,
    free: null,
    releases: [],
    outOfRange: null,
    lastFresh: [],
    log: [],
};

function setup(state: Partial<MonitorState> = {}, ext: Partial<ExtensionState> = {}) {
    let monitorState: MonitorState = { ...baseState, ...state };
    const extState: ExtensionState = { connected: true, version: '1', auth: null, autoBook: false, draft: null, ...ext };
    const listeners = new Set<() => void>();
    let tick: (() => void) | null = null;
    let now = NOW;
    const monitor = {
        getState: () => monitorState,
        subscribe: (l: () => void) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        start: vi.fn(async () => {}),
        stop: vi.fn(),
        checkNow: vi.fn(async () => {}),
    } as unknown as Monitor;
    const extensionLink = { getState: () => extState, subscribe: () => () => {} } as unknown as ExtensionLink;
    const clock = { now: () => now } as Clock;
    const scheduler = {
        setInterval: (cb: () => void) => {
            tick = cb;
            return { id: 1 };
        },
        clear: () => {},
    } as unknown as Scheduler;
    const wrapper = ({ children }: { children: ReactNode }) => (
        <AppServicesContext value={{ monitor, extensionLink, clock, scheduler }}>{children}</AppServicesContext>
    );
    render(<StatusBlock />, { wrapper });
    return {
        monitor,
        advance(ms: number, next?: Partial<MonitorState>) {
            act(() => {
                now += ms;
                if (next) monitorState = { ...monitorState, ...next };
                listeners.forEach((l) => l());
                tick?.();
            });
        },
    };
}

describe('StatusBlock', () => {
    it('offers to start when stopped', async () => {
        const { monitor } = setup();
        expect(screen.getByText('Моніторинг зупинено')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Перевірити' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Запустити' }));
        expect(monitor.start).toHaveBeenCalled();
    });

    it('shows the countdown and stop/check buttons while running', async () => {
        const { monitor, advance } = setup({ running: true, nextAt: NOW + 42_000 });
        expect(screen.getByText('Моніторинг працює')).toBeInTheDocument();
        expect(screen.getByText('0:42')).toBeInTheDocument();
        advance(2000);
        expect(screen.getByText('0:40')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Перевірити' }));
        expect(monitor.checkNow).toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Зупинити' }));
        expect(monitor.stop).toHaveBeenCalledWith(expect.any(String), 'user');
    });

    it('disables the check button while a check is running', () => {
        setup({ running: true, checking: true, nextAt: NOW + 42_000 });
        expect(screen.getByRole('button', { name: 'Перевірити' })).toBeDisabled();
    });

    it('shows the extension state', () => {
        setup({}, { connected: true });
        expect(screen.getByText('Розширення підключено')).toBeInTheDocument();
    });

    it('shows when the extension is missing', () => {
        setup({}, { connected: false });
        expect(screen.getByText('Розширення не підключено')).toBeInTheDocument();
    });

    it('shows the session end from the token expiry', () => {
        setup({ running: true, nextAt: NOW + 5000 }, { auth: { loggedIn: true, exp: NOW + 3 * 3600_000, reason: null } });
        expect(screen.getByText(/^Сесія до /)).toBeInTheDocument();
    });

    it('reports a lost session', () => {
        setup({ stoppedBy: 'session' }, { auth: { loggedIn: false, exp: null, reason: null } });
        expect(screen.getByText('Зупинено: сесія скінчилась')).toBeInTheDocument();
        expect(screen.getByText('Сесія скінчилась')).toBeInTheDocument();
    });

    it('asks to pick an institution when none is selected', () => {
        setup({ selection: null });
        expect(screen.getByText('Виберіть установу в налаштуваннях')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Запустити' })).toBeDisabled();
    });
});
