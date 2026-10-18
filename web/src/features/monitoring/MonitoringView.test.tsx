import type { MonitorState } from '@/application/monitor.ts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MonitoringView } from './MonitoringView.tsx';
import { createFakeServices } from '@/test/fake-services.tsx';

function setup(
    configure: (history: ReturnType<typeof createFakeServices>['history']) => void = () => {},
    monitor: Parameters<typeof createFakeServices>[0] = {},
) {
    const fake = createFakeServices(monitor);
    configure(fake.history);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
            <fake.wrapper>{children}</fake.wrapper>
        </QueryClientProvider>
    );
    return { fake, ...render(<MonitoringView />, { wrapper }) };
}

const checkEntry = {
    id: 5, receivedAt: '2026-10-09T10:41:52Z', clientId: 'c', startedAt: '2026-10-09T10:41:52Z', durationMs: 100, kind: 'fast' as const,
    checkSeq: 128, institutionCode: '1', serviceCode: '2', outcome: 'ok' as const, freeCount: 18, newCount: 2, outOfRangeCount: 0,
    newSlots: [{ date: '2027-03-31', time: '09:50', consulIpnHash: null }], tabSessionId: 't', appVersion: '1', errorMessage: null,
};

const extEvent = {
    id: 9, receivedAt: '2026-10-09T10:41:40Z', clientId: '11111111-1111-4111-8111-111111111111', occurredAt: '2026-10-09T10:41:40Z',
    type: 'selection.selected' as const, jobId: 'j1', payload: { date: '2027-03-31', time: '09:50', taskId: 't1', autoBook: false }, extensionVersion: '0.4.0', test: false,
};

describe('MonitoringView', () => {
    it('shows the summary cards', async () => {
        setup((history) => {
            history.summary.mockResolvedValue({
                checks: { total: 128, fast: 14, failed: 1 },
                newFree: { total: 6, lastAt: '2026-10-09T10:41:00Z' },
                reservations: { reserved: 23, released: 2 },
            });
        });
        expect(await screen.findByText('128')).toBeInTheDocument();
        expect(screen.getByText('23')).toBeInTheDocument();
        expect(screen.getByText(/14 частих · 1 помилка/)).toBeInTheDocument();
    });

    it('lists checks and asks for onlyNew when the filter is chosen', async () => {
        const user = userEvent.setup();
        const { fake } = setup((history) => {
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null, total: 1 });
        });
        expect(await screen.findByText('2 нові слоти')).toBeInTheDocument();
        expect(screen.getByText('31.03 09:50')).toBeInTheDocument();
        expect(screen.queryByText(/Перевірка #/)).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Нові слоти/ }));
        await screen.findByText('2 нові слоти');
        expect(fake.history.checks).toHaveBeenLastCalledWith(expect.objectContaining({ onlyNew: true }));
    });

    it('shows a message in the card when the server fails and keeps the page', async () => {
        setup((history) => {
            history.checks.mockRejectedValue(new Error('HTTP 503'));
        });
        expect(await screen.findByText('Не вдалося завантажити журнал перевірок')).toBeInTheDocument();
        expect(screen.getByText('Журнал резервувань')).toBeInTheDocument();
    });

    it('links the JSONL download', () => {
        setup();
        expect(screen.getByRole('link', { name: 'Завантажити JSONL' })).toHaveAttribute('href', '/api/schedule-log.jsonl');
    });

    it('merges extension events into the check log by time', async () => {
        setup((history) => {
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null, total: 1 });
            history.extensionEvents.mockResolvedValue({ entries: [{ ...extEvent, occurredAt: '2026-10-09T10:41:59Z' }], nextCursor: null });
        });
        const check = await screen.findByText('2 нові слоти');
        const event = await screen.findByText('Розширення вибрало слот');
        expect(screen.getByText(/31\.03\.2027 о 09:50 у чернетці — натисніть «Підтвердити»/)).toBeInTheDocument();
        // the event is newer, so it comes first
        expect(event.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('auto-booking: the selected slot does not ask to press, a failed booking shows the reason', async () => {
        setup((history) => {
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null, total: 1 });
            history.extensionEvents.mockResolvedValue({
                entries: [
                    { ...extEvent, id: 2, payload: { ...extEvent.payload, autoBook: true } },
                    {
                        ...extEvent,
                        id: 3,
                        clientId: '00000000-0000-4000-8000-000000000003',
                        type: 'booking.failed',
                        payload: { date: '2027-03-31', time: '09:50', error: 'unavailable', aggressive: true },
                    },
                ],
                nextCursor: null,
            });
        });
        expect(await screen.findByText(/31\.03\.2027 о 09:50 — бронює автоматично/)).toBeInTheDocument();
        expect(screen.queryByText(/натисніть «Підтвердити»/)).not.toBeInTheDocument();
        expect(screen.getByText('Не забронювалось')).toBeInTheDocument();
        expect(screen.getByText(/31\.03\.2027 о 09:50 — сайт: «Сервіс недоступний»/)).toBeInTheDocument();
        expect(screen.getByText('агресивно')).toBeInTheDocument();
    });

    it('hides extension events under the filters other than "Усі" and marks test events', async () => {
        const user = userEvent.setup();
        setup((history) => {
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null, total: 1 });
            history.extensionEvents.mockResolvedValue({ entries: [{ ...extEvent, test: true }], nextCursor: null });
        });
        expect(await screen.findByText('Розширення вибрало слот')).toBeInTheDocument();
        expect(screen.getByText('тест')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /Нові слоти/ }));
        await screen.findByText('2 нові слоти');
        expect(screen.queryByText('Розширення вибрало слот')).not.toBeInTheDocument();
    });

    it('asks the server for failed checks under "Помилки"', async () => {
        const user = userEvent.setup();
        const { fake } = setup((history) => {
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null, total: 1 });
        });
        await screen.findByText('2 нові слоти');
        await user.click(screen.getByRole('button', { name: /Помилки/ }));
        await screen.findByText('2 нові слоти');
        expect(fake.history.checks).toHaveBeenCalledWith(expect.objectContaining({ failed: true, offset: 0 }));
    });

    it('shows a failed check with its message and a compact duration', async () => {
        setup((history) => {
            history.checks.mockResolvedValue({
                entries: [{ ...checkEntry, outcome: 'session_expired', durationMs: 2000, freeCount: null, newCount: null, errorMessage: 'HTTP 401' }],
                nextCursor: null,
                total: 1,
            });
        });
        expect(await screen.findByText('Не вдалося перевірити')).toBeInTheDocument();
        expect(screen.getByText('HTTP 401')).toBeInTheDocument();
        expect(screen.getByText('2,0 с')).toBeInTheDocument();
    });

    it('pages the log: range, numbered pages and the next page request', async () => {
        const user = userEvent.setup();
        const { fake } = setup((history) => {
            history.checks.mockImplementation(async (query) => ({
                entries: Array.from({ length: query.limit ?? 0 }, (_, i) => ({ ...checkEntry, id: 1000 - i, newCount: 0, newSlots: [] })),
                nextCursor: null,
                total: 60,
            }));
        });
        expect(await screen.findByText('1–25 з 60')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Сторінка 2' }));
        await screen.findByText('26–50 з 60');
        // one overlapping entry is fetched to know where the page before ends
        expect(fake.history.checks).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 24, limit: 26 }));
    });

    it('changes the page size and goes back to the first page', async () => {
        const user = userEvent.setup();
        const { fake } = setup((history) => {
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null, total: 1 });
        });
        await screen.findByText('2 нові слоти');
        await user.selectOptions(within(screen.getByRole('region', { name: 'Журнал перевірок' })).getByLabelText('Рядків на сторінці'), '50');
        await screen.findByText('2 нові слоти');
        expect(fake.history.checks).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 50, offset: 0 }));
    });

    it('shows reservations as compact rows and pages them with offset', async () => {
        const user = userEvent.setup();
        const event = {
            id: 1, receivedAt: '2026-10-09T10:43:00Z', clientId: '11111111-1111-4111-8111-111111111112', kind: 'released' as const,
            institutionCode: '1', consulIpnHash: '556940f3aaaa', slotFrom: '2027-03-31T16:40:00.000Z', slotTo: '2027-03-31T16:50:00.000Z',
            previousCheckAt: '2026-10-09T10:41:00Z', detectedAt: '2026-10-09T10:43:00Z', tabSessionId: 't',
        };
        const { fake } = setup((history) => {
            history.reservations.mockResolvedValue({ entries: [event], nextCursor: null, total: 40 });
        }, {
            monitor: {
                locations: { institutions: [{ code: '1', timeZone: 'GMT-05:00' }] } as unknown as MonitorState['locations'],
            },
        });
        expect(await screen.findByText('Звільнено')).toBeInTheDocument();
        expect(screen.getByText('31.03 11:40')).toBeInTheDocument();
        expect(screen.getByText(/консул 556940f3/)).toBeInTheDocument();
        expect(screen.getByText('1–1 з 40')).toBeInTheDocument();
        const card = within(screen.getByRole('region', { name: 'Журнал резервувань' }));
        await user.click(card.getByRole('button', { name: 'Сторінка 2' }));
        await screen.findByText('Звільнено');
        expect(fake.history.reservations).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 15, offset: 15 }));
    });

    it('lists schedule changes with each change on its own line', async () => {
        setup((history) => {
            history.scheduleChanges.mockResolvedValue({
                entries: [
                    { id: 2, receivedAt: '2026-10-09T10:00:00Z', time: '2026-10-09T10:00:00Z', institutionCode: '1', institution: 'Chicago', type: 'changed', changes: ['консул 76e01698: +1 неробочий проміжок', 'додано 16.10.2026'] },
                    { id: 1, receivedAt: '2026-10-08T10:00:00Z', time: '2026-10-08T10:00:00Z', institutionCode: '1', institution: 'Chicago', type: 'baseline', changes: [] },
                ],
                nextCursor: null,
                total: 2,
            });
        });
        expect(await screen.findByText('Розклад змінився')).toBeInTheDocument();
        expect(screen.getByText('консул 76e01698: +1 неробочий проміжок')).toBeInTheDocument();
        expect(screen.getByText('додано 16.10.2026')).toBeInTheDocument();
        expect(screen.getByText('Базовий знімок розкладу')).toBeInTheDocument();
    });

    it('shows no paging footer under the side tables while they hold 15 entries or fewer', async () => {
        setup((history) => {
            history.reservations.mockResolvedValue({ entries: [], nextCursor: null, total: 15 });
            history.scheduleChanges.mockResolvedValue({ entries: [], nextCursor: null, total: 3 });
        });
        await screen.findAllByText('Записів немає');
        const reservations = within(screen.getByRole('region', { name: 'Журнал резервувань' }));
        const schedule = within(screen.getByRole('region', { name: 'Зміни розкладу' }));
        expect(reservations.queryByLabelText('Рядків на сторінці')).not.toBeInTheDocument();
        expect(schedule.queryByLabelText('Рядків на сторінці')).not.toBeInTheDocument();
        // the check log keeps its footer
        expect(within(screen.getByRole('region', { name: 'Журнал перевірок' })).getByLabelText('Рядків на сторінці')).toBeInTheDocument();
    });
});
