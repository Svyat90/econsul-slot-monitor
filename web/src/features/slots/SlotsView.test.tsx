import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { CalendarLatest } from '@contracts/calendar-snapshots.ts';
import locationsJson from '../../../../server/data/locations.json';
import houston from '../../domain/__fixtures__/econsul/houston-2026-10-09.json';
import { SlotsView } from './SlotsView.tsx';
import type { MonitorState } from '@/application/monitor.ts';
import { reservedResponseSchema, scheduleResponseSchema } from '@/domain/contracts/econsul.ts';
import { locationsSchema } from '@/domain/contracts/locations.ts';
import { compactReserved } from '@/domain/slots/calendar-snapshot.ts';
import { createFakeServices } from '@/test/fake-services.tsx';

const locations = locationsSchema.parse(locationsJson);
const institution = locations.institutions.find((i) => i.code === houston.institutionCode)!;
const rows = scheduleResponseSchema.parse(houston.schedule).data.flatMap((entry) => (entry.data ? [entry.data] : []));
const reserved = reservedResponseSchema.parse(houston.reserved).data.reservedSlots;
const NOW = houston.recordedAtMs;

const selection = { institution, serviceCode: houston.serviceCode } as MonitorState['selection'];

// The calendar as the server hands it back
const latest: CalendarLatest = {
    snapshot: {
        id: 1,
        receivedAt: new Date(NOW).toISOString(),
        clientId: '00000000-0000-4000-8000-000000000001',
        observedAt: new Date(NOW - 3600_000).toISOString(),
        institutionCode: institution.code,
        serviceCode: houston.serviceCode,
        scheduleHash: 's',
        reservedHash: 'r',
        schedule: rows as unknown as Record<string, unknown>[],
        reserved: compactReserved(reserved),
        appVersion: '1.0.0',
    },
    lastCheckAt: new Date(NOW - 600_000).toISOString(),
};

function setup(options: { monitor?: Partial<MonitorState>; saved?: CalendarLatest }) {
    const fake = createFakeServices({ now: NOW, monitor: { selection, locations, ...options.monitor } });
    if (options.saved) fake.history.calendar.mockResolvedValue(options.saved);
    render(
        <MemoryRouter>
            <SlotsView />
        </MemoryRouter>,
        { wrapper: fake.wrapper },
    );
    return fake;
}

describe('SlotsView', () => {
    it('shows the calendar the server saved when the monitor has not looked yet, and says so', async () => {
        const { history } = setup({ saved: latest });
        expect(await screen.findByRole('status')).toHaveTextContent(/Показано останній збережений стан: перевірка о \d{2}:\d{2}\./);
        expect(history.calendar).toHaveBeenCalledWith({ institutionCode: institution.code, serviceCode: houston.serviceCode });
        // the fixture has no free slots, but "not checked yet" is gone: the saved calendar answers
        expect(screen.getByText('У вибраному діапазоні вільних слотів немає.')).toBeInTheDocument();
        expect(screen.queryByText('Вільні слоти ще не перевірені.')).not.toBeInTheDocument();
    });

    it('opens the month of the newest open day, not the current one', async () => {
        setup({ saved: latest });
        // the fixture was recorded on 2026-10-09; the horizon of Houston is April 2027
        expect(await screen.findByText('Квітень 2027')).toBeInTheDocument();
        expect(screen.queryByText('Жовтень 2026')).not.toBeInTheDocument();
    });

    it('a schedule without reserved slots (nothing checked) does not draw every slot as free', async () => {
        setup({ monitor: { schedule: { rows, fetchedAt: NOW }, reserved: null } });
        expect(await screen.findByText('Зайняті слоти ще не перевірені: запустіть моніторинг.')).toBeInTheDocument();
        expect(screen.queryByText(/Квітень 2027|Жовтень 2026/)).not.toBeInTheDocument();
    });

    it('without anything: asks to wait for the schedule', async () => {
        setup({});
        expect(await screen.findByText('Розклад ще не завантажено.')).toBeInTheDocument();
    });

    it('live data of the monitor wins over the saved calendar and shows no note', async () => {
        const { history } = setup({ monitor: { schedule: { rows, fetchedAt: NOW }, reserved }, saved: latest });
        expect(await screen.findByText('Квітень 2027')).toBeInTheDocument();
        await Promise.resolve();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(history.calendar).toHaveBeenCalled(); // asked anyway: the hook does not know yet
    });
});
