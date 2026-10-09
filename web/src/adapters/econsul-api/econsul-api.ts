import type { ZodType } from 'zod';
import type { EconsulApi } from '@/application/ports.ts';
import { reservedResponseSchema, scheduleResponseSchema } from '@/domain/contracts/econsul.ts';
import { EconsulSchemaError, EconsulUnavailableError, SessionExpiredError } from '@/domain/contracts/errors.ts';

const EXTERNAL_READER_URL = 'https://my.e-consul.gov.ua/external_reader';

// Reserved-slot statuses the site asks for (slots.html runCheck()).
const RESERVED_STATUSES = [1, 2, 4, 5];

// The only place that puts the session token into a header. No error message below contains it.
export function createEconsulApi(fetchFn: typeof fetch = (input, init) => fetch(input, init)): EconsulApi {
    // POST to e-consul's external_reader, like callExternalReader() in slots.html.
    async function callExternalReader<T>(method: string, filters: object, token: string, schema: ZodType<T>): Promise<T> {
        let response: Response;
        try {
            response = await fetchFn(EXTERNAL_READER_URL, {
                method: 'POST',
                headers: {
                    accept: '*/*',
                    'content-type': 'application/json',
                    token,
                },
                body: JSON.stringify({ service: 'e-queue-register', method, filters }),
            });
        } catch {
            throw new EconsulUnavailableError(null, 'Network error');
        }
        if (response.status === 401 || response.status === 403) {
            throw new SessionExpiredError(response.status);
        }
        if (!response.ok) {
            throw new EconsulUnavailableError(response.status, `HTTP ${response.status}: ${response.statusText}`);
        }
        let json: unknown;
        try {
            json = await response.json();
        } catch {
            throw new EconsulSchemaError(`${method}: the response is not valid JSON`);
        }
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
            throw new EconsulSchemaError(`${method}: unexpected response format`);
        }
        return parsed.data;
    }

    return {
        getSchedule(institutionCode, token) {
            return callExternalReader('public-calendar-get-actual-consuls-schedule', { institutionCode }, token, scheduleResponseSchema);
        },
        getReservedSlots({ institutionCode, consulIpnHash }, token) {
            return callExternalReader(
                'public-get-consuls-reserved-slots',
                { institutionCode, status: RESERVED_STATUSES, consulIpnHash },
                token,
                reservedResponseSchema,
            );
        },
    };
}
