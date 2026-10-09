import { describe, expect, it, vi } from 'vitest';
import { createEconsulApi } from './econsul-api.ts';
import { EconsulSchemaError, EconsulUnavailableError, SessionExpiredError } from '@/domain/contracts/errors.ts';

const TOKEN = 'secret-token-value';

const scheduleBody = { data: [{ data: { consulIpnHash: 'h1' } }] };
const reservedBody = { data: { reservedSlots: [] } };

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fakeFetch(response: Response | Error) {
    return vi.fn<typeof fetch>(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
}

async function caught(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

describe('econsul-api', () => {
    it('sends the schedule request like callExternalReader()', async () => {
        const fetchFn = fakeFetch(jsonResponse(scheduleBody));
        const result = await createEconsulApi(fetchFn).getSchedule('1000000522', TOKEN);

        expect(result.data[0]?.data?.consulIpnHash).toBe('h1');
        const [url, init] = fetchFn.mock.calls[0]!;
        expect(url).toBe('https://my.e-consul.gov.ua/external_reader');
        expect(init?.method).toBe('POST');
        expect(init?.headers).toEqual({ accept: '*/*', 'content-type': 'application/json', token: TOKEN });
        expect(JSON.parse(init?.body as string)).toEqual({
            service: 'e-queue-register',
            method: 'public-calendar-get-actual-consuls-schedule',
            filters: { institutionCode: '1000000522' },
        });
    });

    it('sends the reserved-slots request with status filter and consul hashes', async () => {
        const fetchFn = fakeFetch(jsonResponse(reservedBody));
        await createEconsulApi(fetchFn).getReservedSlots({ institutionCode: '1', consulIpnHash: ['a', 'b'] }, TOKEN);

        const init = fetchFn.mock.calls[0]![1];
        expect(JSON.parse(init?.body as string)).toEqual({
            service: 'e-queue-register',
            method: 'public-get-consuls-reserved-slots',
            filters: { institutionCode: '1', status: [1, 2, 4, 5], consulIpnHash: ['a', 'b'] },
        });
    });

    it.each([401, 403])('maps HTTP %i to SessionExpiredError', async (status) => {
        const error = await caught(createEconsulApi(fakeFetch(jsonResponse({}, status))).getSchedule('1', TOKEN));
        expect(error).toBeInstanceOf(SessionExpiredError);
        expect((error as SessionExpiredError).status).toBe(status);
        expect(error.message).not.toContain(TOKEN);
    });

    it('maps HTTP 500 to EconsulUnavailableError with the status', async () => {
        const error = await caught(createEconsulApi(fakeFetch(jsonResponse({}, 500))).getSchedule('1', TOKEN));
        expect(error).toBeInstanceOf(EconsulUnavailableError);
        expect((error as EconsulUnavailableError).status).toBe(500);
        expect(error.message).not.toContain(TOKEN);
    });

    it('maps a network failure to EconsulUnavailableError(null) without leaking the token', async () => {
        const error = await caught(createEconsulApi(fakeFetch(new TypeError(`Failed ${TOKEN}`))).getSchedule('1', TOKEN));
        expect(error).toBeInstanceOf(EconsulUnavailableError);
        expect((error as EconsulUnavailableError).status).toBeNull();
        expect(error.message).not.toContain(TOKEN);
    });

    it('maps broken JSON to EconsulSchemaError', async () => {
        const broken = new Response('<html>', { status: 200 });
        const error = await caught(createEconsulApi(fakeFetch(broken)).getSchedule('1', TOKEN));
        expect(error).toBeInstanceOf(EconsulSchemaError);
        expect(error.message).not.toContain(TOKEN);
    });

    it('maps a body that does not match the contract to EconsulSchemaError', async () => {
        const error = await caught(createEconsulApi(fakeFetch(jsonResponse({ data: 'nope' }))).getReservedSlots({ institutionCode: '1', consulIpnHash: [] }, TOKEN));
        expect(error).toBeInstanceOf(EconsulSchemaError);
        expect(error.message).not.toContain(TOKEN);
    });
});
