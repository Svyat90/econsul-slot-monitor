import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { MonitorState } from '@/application/monitor.ts';
import { createFakeServices } from '@/test/fake-services.tsx';
import { routes } from './router.tsx';

// A selected institution, so the pages show instead of the empty state
const selection = { institution: { code: 'CHI' }, serviceCode: 'PASSPORT' } as unknown as MonitorState['selection'];

function renderAt(path: string, monitor: Partial<MonitorState> = { selection }) {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    const { wrapper } = createFakeServices({ monitor });
    render(<RouterProvider router={router} />, { wrapper });
}

describe('routes', () => {
    it('opens the slots page on /', () => {
        renderAt('/');
        expect(screen.getByRole('link', { name: 'Слоти' })).toHaveAttribute('aria-current', 'page');
    });

    it('navigates to monitoring and marks the menu item active', async () => {
        renderAt('/');
        await userEvent.click(screen.getByRole('link', { name: 'Моніторинг' }));
        expect(screen.getByRole('link', { name: 'Моніторинг' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Слоти' })).not.toHaveAttribute('aria-current');
    });

    it('opens settings on /settings', () => {
        renderAt('/settings');
        expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('aria-current', 'page');
    });

    it('falls back to slots on an unknown path', () => {
        renderAt('/nope/at/all');
        expect(screen.getByRole('link', { name: 'Слоти' })).toHaveAttribute('aria-current', 'page');
    });

    it('shows the monitoring status block in the menu', () => {
        renderAt('/');
        expect(screen.getByRole('button', { name: 'Запустити' })).toBeInTheDocument();
    });

    it('shows the empty state instead of Slots and Monitoring when no institution is selected', async () => {
        renderAt('/slots', { selection: null });
        expect(screen.getByText('Що шукаємо?')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('link', { name: 'Моніторинг' }));
        expect(screen.getByText('Що шукаємо?')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('link', { name: 'Налаштувати пошук' }));
        expect(screen.getByRole('link', { name: 'Налаштування' })).toHaveAttribute('aria-current', 'page');
        expect(screen.queryByText('Що шукаємо?')).not.toBeInTheDocument();
    });

    it('shows the fresh-slot count next to Моніторинг in the menu', () => {
        renderAt('/slots', { selection, lastFresh: ['2027-03-31 09:50', '2027-03-31 11:40'] });
        expect(screen.getByRole('link', { name: 'Моніторинг 2 нові' })).toBeInTheDocument();
    });
});
