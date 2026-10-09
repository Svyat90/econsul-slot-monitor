import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { MonitorState } from '@/application/monitor.ts';
import type { FreeSlots } from '@/domain/slots/free-slots.ts';
import { AppServicesContext } from '@/hooks/use-app-services.ts';
import { NearestFree } from './NearestFree.tsx';
import { createFakeServices } from '@/test/fake-services.tsx';

const free = (keys: string[]): FreeSlots => ({ byDate: {}, slotConsuls: {}, keys });

function setup(monitor: Partial<MonitorState>) {
    const openBooking = vi.fn();
    const fake = createFakeServices({ monitor });
    const Wrapper = fake.wrapper;
    // openBooking is added to AppServices by the page task; the override keeps this test independent
    const services = { ...fake.services, openBooking };
    render(
        <AppServicesContext value={services}>
            <NearestFree />
        </AppServicesContext>,
        { wrapper: Wrapper },
    );
    return { openBooking };
}

describe('NearestFree', () => {
    it('lists up to four days inside the date range and opens the draft', async () => {
        const { openBooking } = setup({
            free: free(['2027-03-10 09:00', '2027-03-17 09:50', '2027-03-17 10:20', '2027-03-30 09:50', '2027-03-31 09:50', '2027-04-01 09:10', '2027-04-02 09:00']),
            dateRange: { from: '2027-03-15', to: '2027-04-01' },
        });
        expect(screen.getByText('у діапазоні 15.03–01.04')).toBeInTheDocument();
        expect(screen.getAllByRole('listitem')).toHaveLength(4);
        expect(screen.getByText('ср, 17.03')).toBeInTheDocument();
        expect(screen.getByText('09:50 10:20')).toBeInTheDocument();
        expect(screen.queryByText('пт, 02.04')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Відкрити чернетку' }));
        expect(openBooking).toHaveBeenCalledTimes(1);
    });

    it('shows an empty state when nothing is free in range', () => {
        setup({ free: free(['2027-03-10 09:00']), dateRange: { from: '2027-03-15', to: null } });
        expect(screen.getByText('У вибраному діапазоні вільних слотів немає.')).toBeInTheDocument();
    });

    it('shows a not-checked state before the first check', () => {
        setup({ free: null });
        expect(screen.getByText('Вільні слоти ще не перевірені.')).toBeInTheDocument();
    });
});
