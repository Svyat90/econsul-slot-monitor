import type { RequestLogEntry } from '@contracts/request-log.ts';
import type { AppSession, Clock, EconsulApi, Ids, RequestMeta, ServerApi } from '@/application/ports.ts';
import { EconsulSchemaError, EconsulUnavailableError, SessionExpiredError } from '@/domain/contracts/errors.ts';

const SERVICE = 'e-queue-register';
const RESERVED_STATUSES = [1, 2, 4, 5];
const MAX_MESSAGE = 500;

type Deps = { server: ServerApi; clock: Clock; ids: Ids; session: AppSession };
type Outcome = Pick<RequestLogEntry, 'httpStatus' | 'outcome' | 'itemsCount' | 'errorMessage'>;

function describeError(error: unknown, token: string): Outcome {
    const raw = error instanceof Error ? error.message : String(error);
    const message = (token ? raw.split(token).join('[token]') : raw).slice(0, MAX_MESSAGE);
    const base = { itemsCount: null, errorMessage: message };
    if (error instanceof SessionExpiredError) return { ...base, httpStatus: error.status, outcome: 'session_expired' };
    if (error instanceof EconsulSchemaError) return { ...base, httpStatus: 200, outcome: 'schema_error' };
    if (error instanceof EconsulUnavailableError && error.status !== null) return { ...base, httpStatus: error.status, outcome: 'unavailable' };
    return { ...base, httpStatus: null, outcome: 'network_error' };
}

// Records every EconsulApi call in the server's request log. Result and error pass through unchanged.
export function withRequestLog(api: EconsulApi, deps: Deps): EconsulApi {
    const { server, clock, ids, session } = deps;

    async function record<T>(
        method: string,
        institutionCode: string,
        filters: RequestLogEntry['filters'],
        token: string,
        meta: RequestMeta | undefined,
        call: () => Promise<T>,
        countItems: (result: T) => number,
    ): Promise<T> {
        const startedMs = clock.now();
        const finish = (outcome: Outcome) => {
            try {
                server.recordRequest({
                    clientId: ids.uuid(),
                    startedAt: new Date(startedMs).toISOString(),
                    durationMs: Math.max(0, Math.round(clock.now() - startedMs)),
                    service: SERVICE,
                    method,
                    institutionCode,
                    filters,
                    ...outcome,
                    responseBytes: null,
                    checkKind: meta?.checkKind ?? null,
                    checkSeq: meta?.checkSeq ?? null,
                    source: 'app',
                    tabSessionId: session.tabSessionId,
                    appVersion: session.appVersion,
                });
            } catch {
                // logging never breaks monitoring
            }
        };
        try {
            const result = await call();
            finish({ httpStatus: 200, outcome: 'ok', itemsCount: countItems(result), errorMessage: null });
            return result;
        } catch (error) {
            finish(describeError(error, token));
            throw error;
        }
    }

    return {
        getSchedule(institutionCode, token, meta) {
            return record(
                'public-calendar-get-actual-consuls-schedule',
                institutionCode,
                { institutionCode },
                token,
                meta,
                () => api.getSchedule(institutionCode, token, meta),
                (r) => r.data.filter((row) => row.data !== null).length,
            );
        },
        getReservedSlots(request, token, meta) {
            return record(
                'public-get-consuls-reserved-slots',
                request.institutionCode,
                { institutionCode: request.institutionCode, status: RESERVED_STATUSES, consulIpnHash: [...request.consulIpnHash] },
                token,
                meta,
                () => api.getReservedSlots(request, token, meta),
                (r) => r.data.reservedSlots.length,
            );
        },
    };
}
