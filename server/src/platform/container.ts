import { sql } from 'drizzle-orm';
import { createDb } from '../db/client.ts';
import { createChecksRepository, type ChecksRepository } from '../modules/checks/repository.ts';
import { createExtensionEventsRepository, type ExtensionEventsRepository } from '../modules/extension-events/repository.ts';
import { createRequestLogRepository, type RequestLogRepository } from '../modules/request-log/repository.ts';
import { createReservationLogRepository, type ReservationLogRepository } from '../modules/reservation-log/repository.ts';
import { createScheduleLogRepository, type ScheduleLogRepository } from '../modules/schedule-log/repository.ts';
import { createSummaryRepository, type SummaryRepository } from '../modules/summary/repository.ts';
import type { Config } from './config.ts';

export interface Container {
    scheduleLog: ScheduleLogRepository;
    requestLog: RequestLogRepository;
    checks: ChecksRepository;
    extensionEvents: ExtensionEventsRepository;
    reservationLog: ReservationLogRepository;
    summary: SummaryRepository;
    pingDb: () => Promise<void>;
    close: () => Promise<void>;
}

// Composition root: the only place that creates the database pool.
export function createContainer(config: Config): Container {
    const { db, close } = createDb(config.databaseUrl);
    return {
        scheduleLog: createScheduleLogRepository(db),
        requestLog: createRequestLogRepository(db),
        checks: createChecksRepository(db),
        extensionEvents: createExtensionEventsRepository(db),
        reservationLog: createReservationLogRepository(db),
        summary: createSummaryRepository(db),
        pingDb: async () => {
            await db.execute(sql`select 1`);
        },
        close,
    };
}
