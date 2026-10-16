import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { vi } from 'vitest';
import type { MonitorState } from '@/application/monitor.ts';
import { Banners } from './Banners.tsx';
import { MonitoringBadge } from './MonitoringBadge.tsx';
import { NoSelection } from './NoSelection.tsx';
import { AppServicesContext, type AppServices } from '@/hooks/use-app-services.ts';
import { createFakeServices } from '@/test/fake-services.tsx';

const NOW = Date.UTC(2026, 9, 9, 12);
const selection = { institution: { code: 'CHI' }, serviceCode: 'PASSPORT' } as unknown as MonitorState['selection'];

function setup(options: Parameters<typeof createFakeServices>[0] = {}) {
    const fake = createFakeServices({ now: NOW, ...options, monitor: { selection, ...options.monitor } });
    const openBooking = vi.fn();
    // openBooking comes from the composition root; overridden here so the test does not depend on the fake
    const services = { ...fake.services, openBooking } as AppServices;
    const Query = fake.wrapper;
    render(
        <Query>
            <AppServicesContext value={services}>
                <MemoryRouter>
                    <Banners />
                    <MonitoringBadge />
                    <NoSelection />
                </MemoryRouter>
            </AppServicesContext>
        </Query>,
    );
    return { ...fake, openBooking };
}

describe('Banners', () => {
    it('shows nothing in the usual case', () => {
        setup({ extension: { connected: true, auth: { loggedIn: true, exp: NOW + 5 * 3600_000, reason: null } } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText(/\d+ нов/)).not.toBeInTheDocument();
    });

    it('session ended: asks to log in, says the monitor resumes, and the button logs in', async () => {
        const { extensionLink } = setup({
            monitor: { stoppedBy: 'session' },
            extension: { connected: true, auth: { loggedIn: false, exp: null, reason: null } },
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть на e-consul. Моніторинг продовжиться сам.');
        await userEvent.click(screen.getByRole('button', { name: 'Увійти' }));
        expect(extensionLink.login).toHaveBeenCalledOnce();
    });

    it('logged out without a stopped monitor: the token will arrive by itself', () => {
        setup({ extension: { connected: true, auth: { loggedIn: false, exp: null, reason: null } } });
        expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть на e-consul. Токен прийде сюди сам.');
    });

    it('warns when the session ends in under 30 minutes', () => {
        setup({ extension: { connected: true, auth: { loggedIn: true, exp: NOW + 10 * 60_000, reason: null } } });
        expect(screen.getByRole('alert')).toHaveTextContent(/Сесія скінчиться о \d{2}:\d{2}\./);
        expect(screen.queryByRole('button', { name: 'Увійти' })).not.toBeInTheDocument();
    });

    it('without the extension there is no session banner even with a stopped monitor', () => {
        setup({ monitor: { stoppedBy: 'session' } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('new slots: lists them, opens the draft, can be closed, and the menu badge counts them', async () => {
        const { openBooking, setMonitorState } = setup({ monitor: { lastFresh: ['2027-03-31 09:50', '2027-03-31 11:40'] } });
        expect(screen.getByRole('status')).toHaveTextContent('Нові вільні слоти: ср 31.03 09:50, 11:40');
        expect(screen.getByLabelText('2 нові')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Відкрити чернетку' }));
        expect(openBooking).toHaveBeenCalledOnce();
        await userEvent.click(screen.getByRole('button', { name: 'Закрити' }));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByLabelText('2 нові')).toBeInTheDocument(); // the badge stays

        setMonitorState({ lastFresh: ['2027-04-01 10:00'] });
        expect(await screen.findByRole('status')).toHaveTextContent('чт 01.04 10:00');
    });

    it('monitoring without a draft: warns and the button asks the extension to create one', async () => {
        const { extensionLink } = setup({
            monitor: { running: true },
            extension: { connected: true, auth: { loggedIn: true, exp: NOW + 5 * 3600_000, reason: null }, draft: null },
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Немає чернетки.');
        await userEvent.click(screen.getByRole('button', { name: 'Створити чернетку' }));
        expect(extensionLink.createDraft).toHaveBeenCalledOnce();
    });

    it('while the extension makes the draft: says so and has no button; a failure shows the reason', () => {
        setup({
            monitor: { running: true },
            extension: { connected: true, auth: { loggedIn: true, exp: NOW + 5 * 3600_000, reason: null }, draftJob: { status: 'running', text: null } },
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Створюю чернетку…');
        expect(screen.queryByRole('button', { name: 'Створити чернетку' })).not.toBeInTheDocument();
    });

    it('a failed creation shows the reason from the extension', () => {
        setup({
            extension: { connected: true, auth: { loggedIn: true, exp: NOW + 5 * 3600_000, reason: null }, draftJob: { status: 'failed', text: 'Послугу не знайдено.' } },
        });
        expect(screen.getByRole('alert')).toHaveTextContent('Чернетку не створено. Послугу не знайдено.');
    });

    it('the reminder before the opening: the monitor is not running → asks to start it, and the button starts it', async () => {
        const { monitor } = setup({
            extension: { connected: true, auth: { loggedIn: true, exp: NOW + 5 * 3600_000, reason: null }, alarm: { at: NOW + 5 * 60_000 }, draft: { url: 'u', savedAt: NOW, expiresAt: NOW + 3600_000 } },
        });
        expect(screen.getByRole('alert')).toHaveTextContent(/Скоро відкриття о \d{2}:\d{2}\. Моніторинг не запущено\./);
        await userEvent.click(screen.getByRole('button', { name: 'Запустити' }));
        expect(monitor.start).toHaveBeenCalledOnce();
    });

    it('the reminder with a running monitor shows nothing', () => {
        setup({
            monitor: { running: true },
            extension: { connected: true, auth: { loggedIn: true, exp: NOW + 5 * 3600_000, reason: null }, alarm: { at: NOW + 5 * 60_000 }, draft: { url: 'u', savedAt: NOW, expiresAt: NOW + 3600_000 } },
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('not logged in at the reminder: one banner, with the opening time', () => {
        setup({ extension: { connected: true, auth: { loggedIn: false, exp: null, reason: null }, alarm: { at: NOW + 5 * 60_000 } } });
        expect(screen.getAllByRole('alert')).toHaveLength(1);
        expect(screen.getByRole('alert')).toHaveTextContent(/Увійдіть на e-consul\..*Нові дні відкриваються о \d{2}:\d{2}\./);
    });

    it('no institution: the empty state links to settings', () => {
        setup({ monitor: { selection: null } });
        expect(screen.getByText('Що шукаємо?')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Налаштувати пошук' })).toHaveAttribute('href', '/settings');
    });
});
