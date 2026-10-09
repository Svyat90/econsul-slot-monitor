import { describe, expect, it } from 'vitest';
import { requestLogEntrySchema, type RequestLogEntry } from '@contracts/request-log.ts';
import type { EconsulApi, Clock, Ids, ServerApi } from '@/application/ports.ts';
import { EconsulSchemaError, EconsulUnavailableError, SessionExpiredError } from '@/domain/contracts/errors.ts';
import type { ReservedResponse, ScheduleResponse } from '@/domain/contracts/econsul.ts';
import { withRequestLog } from './request-log.ts';

const TOKEN = 'secret-token-value';
const SESSION = { tabSessionId: '3f0c1c1e-8f6e-4a39-9c53-0d6f4b0f3a11', appVersion: '1.0.0' };

function setup(inner: Partial<EconsulApi>) {
    const entries: RequestLogEntry[] = [];
    const server = { recordRequest: (e: RequestLogEntry) => entries.push(e) } as unknown as ServerApi;
    let now = Date.UTC(2026, 0, 1, 10, 0, 0);
    const clock = { now: () => { const v = now; now += 250; return v; } } as unknown as Clock;
    let n = 0;
    const ids: Ids = { uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` };
    const api = withRequestLog(inner as EconsulApi, { server, clock, ids, session: SESSION });
    return { api, entries };
}

const schedule = { data: [{ data: { consulIpnHash: 'h' } }, { data: null }] } as unknown as ScheduleResponse;
const reserved = { data: { reservedSlots: [{}, {}, {}] } } as unknown as ReservedResponse;
const meta = { checkKind: 'fast', checkSeq: 7 } as const;

describe('withRequestLog', () => {
    it('records a successful schedule call and passes the result through', async () => {
        const { api, entries } = setup({ getSchedule: async () => schedule });
        await expect(api.getSchedule('INST', TOKEN, meta)).resolves.toBe(schedule);
        expect(entries).toHaveLength(1);
        expect(requestLogEntrySchema.parse(entries[0])).toMatchObject({
            service: 'e-queue-register',
            method: 'public-calendar-get-actual-consuls-schedule',
            institutionCode: 'INST',
            filters: { institutionCode: 'INST' },
            startedAt: '2026-01-01T10:00:00.000Z',
            durationMs: 250,
            httpStatus: 200,
            outcome: 'ok',
            itemsCount: 1,
            responseBytes: null,
            checkKind: 'fast',
            checkSeq: 7,
            source: 'app',
            tabSessionId: SESSION.tabSessionId,
            appVersion: '1.0.0',
            errorMessage: null,
        });
    });

    it('records reserved slots with filters and the slot count; meta is optional', async () => {
        const { api, entries } = setup({ getReservedSlots: async () => reserved });
        await api.getReservedSlots({ institutionCode: 'INST', consulIpnHash: ['a', 'b'] }, TOKEN);
        expect(requestLogEntrySchema.parse(entries[0])).toMatchObject({
            method: 'public-get-consuls-reserved-slots',
            filters: { institutionCode: 'INST', status: [1, 2, 4, 5], consulIpnHash: ['a', 'b'] },
            itemsCount: 3,
            checkKind: null,
            checkSeq: null,
        });
    });

    it('401 -> session_expired with its status; the error is rethrown unchanged', async () => {
        const error = new SessionExpiredError(401);
        const { api, entries } = setup({ getSchedule: async () => { throw error; } });
        await expect(api.getSchedule('INST', TOKEN, meta)).rejects.toBe(error);
        expect(requestLogEntrySchema.parse(entries[0])).toMatchObject({ outcome: 'session_expired', httpStatus: 401, itemsCount: null });
    });

    it('500 -> unavailable', async () => {
        const { api, entries } = setup({ getSchedule: async () => { throw new EconsulUnavailableError(500, 'HTTP 500'); } });
        await expect(api.getSchedule('INST', TOKEN)).rejects.toBeInstanceOf(EconsulUnavailableError);
        expect(requestLogEntrySchema.parse(entries[0])).toMatchObject({ outcome: 'unavailable', httpStatus: 500, errorMessage: 'HTTP 500' });
    });

    it('network failure -> network_error with null status', async () => {
        const { api, entries } = setup({ getSchedule: async () => { throw new EconsulUnavailableError(null, 'network'); } });
        await expect(api.getSchedule('INST', TOKEN)).rejects.toBeInstanceOf(EconsulUnavailableError);
        expect(requestLogEntrySchema.parse(entries[0])).toMatchObject({ outcome: 'network_error', httpStatus: null });
    });

    it('schema mismatch -> schema_error (answer was 200)', async () => {
        const { api, entries } = setup({ getSchedule: async () => { throw new EconsulSchemaError('bad'); } });
        await expect(api.getSchedule('INST', TOKEN)).rejects.toBeInstanceOf(EconsulSchemaError);
        expect(requestLogEntrySchema.parse(entries[0])).toMatchObject({ outcome: 'schema_error', httpStatus: 200 });
    });

    it('truncates long messages and keeps the token out of the entry', async () => {
        const { api, entries } = setup({ getSchedule: async () => { throw new EconsulUnavailableError(502, `${TOKEN} ${'x'.repeat(600)}`); } });
        await expect(api.getSchedule('INST', TOKEN)).rejects.toThrow();
        expect(entries[0]!.errorMessage!.length).toBeLessThanOrEqual(500);
        expect(JSON.stringify(entries)).not.toContain(TOKEN);
    });

    it('an unexpected error still records and rethrows', async () => {
        const { api, entries } = setup({ getSchedule: async () => { throw new TypeError('boom'); } });
        await expect(api.getSchedule('INST', TOKEN)).rejects.toThrow('boom');
        expect(requestLogEntrySchema.parse(entries[0])).toMatchObject({ outcome: 'network_error', httpStatus: null });
    });
});
