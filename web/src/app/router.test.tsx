import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from './router.tsx';

function renderAt(path: string) {
    const router = createMemoryRouter(routes, { initialEntries: [path] });
    render(<RouterProvider router={router} />);
}

describe('routes', () => {
    it('opens the slots page on /', () => {
        renderAt('/');
        expect(screen.getByRole('heading', { level: 1, name: 'Слоти' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Слоти' })).toHaveAttribute('aria-current', 'page');
    });

    it('navigates to monitoring and marks the menu item active', async () => {
        renderAt('/');
        await userEvent.click(screen.getByRole('link', { name: 'Моніторинг' }));
        expect(screen.getByRole('heading', { level: 1, name: 'Моніторинг' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Моніторинг' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Слоти' })).not.toHaveAttribute('aria-current');
    });

    it('opens settings on /settings', () => {
        renderAt('/settings');
        expect(screen.getByRole('heading', { level: 1, name: 'Налаштування' })).toBeInTheDocument();
    });

    it('falls back to slots on an unknown path', () => {
        renderAt('/nope/at/all');
        expect(screen.getByRole('heading', { level: 1, name: 'Слоти' })).toBeInTheDocument();
    });

    it('shows the static monitoring status block', () => {
        renderAt('/');
        expect(screen.getByText('Моніторинг зупинено')).toBeInTheDocument();
    });
});
