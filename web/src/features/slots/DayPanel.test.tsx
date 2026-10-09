import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DayPanel } from './DayPanel.tsx';
import type { DayModel } from './model/day-tiles.ts';

const day: DayModel = {
    dateKey: '2027-03-31',
    hours: '09:00–12:00',
    tiles: [
        { time: '09:00', status: 'reserved' },
        { time: '09:50', status: 'free' },
        { time: '11:30', status: 'nonworking' },
    ],
    free: 1,
    reserved: 1,
    nonWorking: 1,
    nonWorkingRanges: ['11:30–12:00'],
};

describe('DayPanel', () => {
    it('shows the date, the summary, the tiles, the non-working time and recent changes', () => {
        render(<DayPanel day={day} recent={[{ time: '09:30', text: 'зарезервовано сьогодні між 10:41 і 10:43' }]} draftHint="Чернетка: створено о 08:45" onOpenBooking={() => {}} />);
        expect(screen.getByText('середа, 31 березня 2027')).toBeInTheDocument();
        expect(screen.getByText('Прийом 09:00–12:00 · 1 вільних · 1 зайнятих · 1 неробочих')).toBeInTheDocument();
        expect(screen.getByText('09:50')).toHaveAttribute('title', 'вільний');
        expect(screen.getByText('09:00')).toHaveAttribute('title', 'зайнятий');
        expect(screen.getByText('11:30–12:00')).toBeInTheDocument();
        expect(screen.getByText('зарезервовано сьогодні між 10:41 і 10:43')).toBeInTheDocument();
        expect(screen.getByText('Чернетка: створено о 08:45')).toBeInTheDocument();
    });

    it('says nothing changed and opens the draft on click', async () => {
        const onOpenBooking = vi.fn();
        render(<DayPanel day={{ ...day, nonWorkingRanges: [] }} recent={[]} draftHint="" onOpenBooking={onOpenBooking} />);
        expect(screen.getByText('За час моніторингу змін не було.')).toBeInTheDocument();
        expect(screen.queryByText('Неробочий час:')).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Відкрити чернетку' }));
        expect(onOpenBooking).toHaveBeenCalledTimes(1);
    });
});
