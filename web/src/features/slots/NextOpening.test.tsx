import { render, screen } from '@testing-library/react';
import type { MonitorState } from '@/application/monitor.ts';
import type { Release } from '@/domain/monitoring/schedule.ts';
import { NextOpening } from './NextOpening.tsx';
import { createFakeServices } from '@/test/fake-services.tsx';

// The fake clock is at UTC-5 (-300 min); the consulate is at GMT-06:00
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const institution = { code: '1', timeZone: 'GMT-06:00', serviceMinutes: { '7': 10 } } as never;
const release = (at: number, dateKey: string): Release => ({ at, opening: '09:00', days: [{ dateKey, display: '09:00-12:00' }] });

function setup(monitor: Partial<MonitorState>) {
    const fake = createFakeServices({ now: NOW, monitor: { selection: { institution, serviceCode: '7' }, ...monitor } });
    render(<NextOpening />, { wrapper: fake.wrapper });
    return fake;
}

describe('NextOpening', () => {
    it('shows the next opening with browser and consulate time', () => {
        // 2026-10-10 15:00 UTC = 10:00 browser (UTC-5)
        const at = Date.UTC(2026, 9, 10, 15, 0, 0);
        setup({
            schedule: { rows: [], fetchedAt: NOW },
            releases: [release(at, '2027-04-02'), release(at + 3 * 86400000, '2027-04-05')],
        });
        expect(screen.getByText('сб, 10.10 о 10:00')).toBeInTheDocument();
        expect(screen.getByText('09:00 за часом консульства (GMT−06:00)')).toBeInTheDocument();
        expect(screen.getByText('пт, 02.04.2027')).toBeInTheDocument();
        expect(screen.getByText(/18 слотів по 10 хв/)).toBeInTheDocument();
        expect(screen.getByText('через 1 д 3 год')).toBeInTheDocument();
        expect(screen.getByText('Часті перевірки 09:58–10:03')).toBeInTheDocument();
        expect(screen.getByText('Далі: вт, 13.10 → пн, 05.04')).toBeInTheDocument();
    });

    it('asks to load the schedule when there is none', () => {
        setup({ schedule: null, releases: [] });
        expect(screen.getByText(/Розклад ще не завантажено/)).toBeInTheDocument();
    });

    it('says so when no days open soon', () => {
        setup({ schedule: { rows: [], fetchedAt: NOW }, releases: [] });
        expect(screen.getByText('Найближчі 8 днів нові дні не відкриваються.')).toBeInTheDocument();
    });
});
