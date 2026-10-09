import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Calendar } from './Calendar.tsx';
import type { MonthGrid } from './model/month-grid.ts';

const grid: MonthGrid = {
    title: 'Березень 2027',
    cells: [
        { kind: 'blank' },
        { kind: 'open', dateKey: '2027-03-30', day: 30, free: 3, reservedPercent: 60, nonWorkingPercent: 10, outOfRange: false },
        { kind: 'open', dateKey: '2027-03-31', day: 31, free: 0, reservedPercent: 90, nonWorkingPercent: 10, outOfRange: true },
        { kind: 'future', dateKey: '2027-04-01', day: 1 },
        { kind: 'closed', dateKey: '2027-04-03', day: 3 },
    ],
};

function setup() {
    const handlers = { onSelect: vi.fn(), onPrevious: vi.fn(), onNext: vi.fn() };
    render(<Calendar grid={grid} selected="2027-03-30" summary="Вільних у діапазоні: 3" {...handlers} />);
    return handlers;
}

describe('Calendar', () => {
    it('shows the free count, "немає", the future day and the summary', () => {
        setup();
        expect(screen.getByRole('button', { name: '30: вільних 3' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: '31: немає вільних' })).toBeInTheDocument();
        expect(screen.getByText('ще не відкрито')).toBeInTheDocument();
        expect(screen.getByText('Вільних у діапазоні: 3')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Березень 2027' })).toBeInTheDocument();
    });

    it('selects a day and moves between months', async () => {
        const user = userEvent.setup();
        const handlers = setup();
        await user.click(screen.getByRole('button', { name: '31: немає вільних' }));
        await user.click(screen.getByRole('button', { name: 'Наступний місяць' }));
        await user.click(screen.getByRole('button', { name: 'Попередній місяць' }));
        expect(handlers.onSelect).toHaveBeenCalledWith('2027-03-31');
        expect(handlers.onNext).toHaveBeenCalledTimes(1);
        expect(handlers.onPrevious).toHaveBeenCalledTimes(1);
    });
});
