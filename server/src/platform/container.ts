import { sql } from 'drizzle-orm';
import { createDb } from '../db/client.ts';
import { createScheduleLogRepository, type ScheduleLogRepository } from '../modules/schedule-log/repository.ts';
import type { Config } from './config.ts';

export interface Container {
    scheduleLog: ScheduleLogRepository;
    pingDb: () => Promise<void>;
    close: () => Promise<void>;
}

// Composition root: the only place that creates the database pool.
export function createContainer(config: Config): Container {
    const { db, close } = createDb(config.databaseUrl);
    return {
        scheduleLog: createScheduleLogRepository(db),
        pingDb: async () => {
            await db.execute(sql`select 1`);
        },
        close,
    };
}
