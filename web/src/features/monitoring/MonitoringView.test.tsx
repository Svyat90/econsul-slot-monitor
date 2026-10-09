import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MonitoringView } from './MonitoringView.tsx';
import { createFakeServices } from '@/test/fake-services.tsx';

function setup(configure: (history: ReturnType<typeof createFakeServices>['history']) => void = () => {}) {
    const fake = createFakeServices();
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
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null });
        });
        expect(await screen.findByText(/Перевірка #128/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Нові слоти' }));
        await screen.findByText(/Перевірка #128/);
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
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null });
            history.extensionEvents.mockResolvedValue({ entries: [{ ...extEvent, occurredAt: '2026-10-09T10:41:59Z' }], nextCursor: null });
        });
        const check = await screen.findByText(/Перевірка #128/);
        const event = await screen.findByText('Розширення вибрало слот');
        expect(screen.getByText(/31\.03\.2027 о 09:50 у чернетці — натисніть «Підтвердити»/)).toBeInTheDocument();
        // the event is newer, so it comes first
        expect(event.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hides extension events under the filters other than "Усі" and marks test events', async () => {
        const user = userEvent.setup();
        setup((history) => {
            history.checks.mockResolvedValue({ entries: [checkEntry], nextCursor: null });
            history.extensionEvents.mockResolvedValue({ entries: [{ ...extEvent, test: true }], nextCursor: null });
        });
        expect(await screen.findByText('Розширення вибрало слот')).toBeInTheDocument();
        expect(screen.getByText('тест')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Нові слоти' }));
        await screen.findByText(/Перевірка #128/);
        expect(screen.queryByText('Розширення вибрало слот')).not.toBeInTheDocument();
    });
});
