import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RequestLogEntry } from '../../contracts/request-log.ts';
import { econsulRequests } from '../../db/schema/index.ts';
import { createTestDb } from '../../test/db.ts';
import { createRequestLogRepository } from './repository.ts';

const { db, close, truncate } = createTestDb();
const repository = createRequestLogRepository(db);

function entry(n: number, patch: Partial<RequestLogEntry> = {}): RequestLogEntry {
    return {
        clientId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        startedAt: `2026-10-09T10:0${n}:00.000Z`,
        durationMs: 120,
        service: 'e-queue-register',
        method: 'public-get-consuls-reserved-slots',
        institutionCode: 'NYC',
        filters: { institutionCode: 'NYC', status: [1] },
        httpStatus: 200,
        outcome: 'ok',
        itemsCount: 3,
        responseBytes: 1024,
        checkKind: 'scheduled',
        checkSeq: n,
        source: 'app',
        tabSessionId: '11111111-1111-4111-8111-111111111111',
        appVersion: '1.0.0',
        errorMessage: null,
        ...patch,
    };
}

beforeEach(() => truncate('econsul_requests'));
afterAll(() => close());

describe('RequestLogRepository.insertMany', () => {
    it('inserts a batch and ignores a repeat', async () => {
        const batch = [entry(1), entry(2)];
        expect(await repository.insertMany(batch)).toBe(2);
        expect(await repository.insertMany(batch)).toBe(0);
        expect(await db.select().from(econsulRequests)).toHaveLength(2);
    });

    it('stores a network_error with a null httpStatus', async () => {
        const failed = entry(1, { outcome: 'network_error', httpStatus: null, errorMessage: 'offline' });
        expect(await repository.insertMany([failed])).toBe(1);
        const page = await repository.list({ limit: 10 });
        expect(page.entries[0]).toMatchObject({ outcome: 'network_error', httpStatus: null, errorMessage: 'offline' });
    });

    it('returns 0 for an empty batch', async () => {
        expect(await repository.insertMany([])).toBe(0);
    });
});

describe('RequestLogRepository.list', () => {
    it('returns newest first with ISO dates and contract fields', async () => {
        await repository.insertMany([entry(1), entry(2)]);
        const page = await repository.list({ limit: 10 });
        expect(page.entries.map((e) => e.checkSeq)).toEqual([2, 1]);
        expect(page.entries[0]?.startedAt).toBe('2026-10-09T10:02:00.000Z');
        expect(typeof page.entries[0]?.receivedAt).toBe('string');
        expect(page.nextCursor).toBeNull();
    });

    it('filters by method, outcome, source and institutionCode', async () => {
        await repository.insertMany([
            entry(1),
            entry(2, { method: 'other' }),
            entry(3, { outcome: 'unavailable', httpStatus: 503 }),
            entry(4, { source: 'extension' }),
            entry(5, { institutionCode: 'LAX' }),
        ]);
        const seqs = async (q: object) => (await repository.list({ limit: 10, ...q })).entries.map((e) => e.checkSeq);
        expect(await seqs({ method: 'other' })).toEqual([2]);
        expect(await seqs({ outcome: 'unavailable' })).toEqual([3]);
        expect(await seqs({ source: 'extension' })).toEqual([4]);
        expect(await seqs({ institutionCode: 'LAX' })).toEqual([5]);
    });

    it('filters by from and to on startedAt', async () => {
        await repository.insertMany([entry(1), entry(2), entry(3)]);
        const page = await repository.list({ limit: 10, from: '2026-10-09T10:02:00.000Z', to: '2026-10-09T10:02:30.000Z' });
        expect(page.entries.map((e) => e.checkSeq)).toEqual([2]);
    });

    it('pages with the cursor', async () => {
        await repository.insertMany([entry(1), entry(2), entry(3)]);
        const first = await repository.list({ limit: 2 });
        expect(first.entries.map((e) => e.checkSeq)).toEqual([3, 2]);
        expect(first.nextCursor).toBe(first.entries[1]?.id);
        const second = await repository.list({ limit: 2, before: first.nextCursor ?? undefined });
        expect(second.entries.map((e) => e.checkSeq)).toEqual([1]);
        expect(second.nextCursor).toBeNull();
    });
});
