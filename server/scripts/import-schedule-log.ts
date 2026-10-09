import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createDb } from '../src/db/client.ts';
import { createScheduleLogRepository } from '../src/modules/schedule-log/repository.ts';
import { loadConfig } from '../src/platform/config.ts';
import { parseScheduleLogJsonl } from './schedule-log-jsonl.ts';

// Usage: node scripts/import-schedule-log.ts [path]  (default: <repoRoot>/logs/schedule-changes.jsonl)
const config = loadConfig();
const path = process.argv[2] ?? join(config.repoRoot, 'logs', 'schedule-changes.jsonl');

const { entries, errors } = parseScheduleLogJsonl(await readFile(path, 'utf8'));
const { db, close } = createDb(config.databaseUrl);
try {
    const inserted = await createScheduleLogRepository(db).insertMany(entries);
    console.log(`прочитано: ${entries.length + errors.length}`);
    console.log(`вставлено: ${inserted}`);
    console.log(`вже було: ${entries.length - inserted}`);
    console.log(`помилки: ${errors.length}`);
    for (const error of errors) console.log(`  рядок ${error.line}: ${error.message}`);
} finally {
    await close();
}
if (errors.length > 0) process.exitCode = 1;
