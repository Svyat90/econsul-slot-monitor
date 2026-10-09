import { scheduleLogEntrySchema, type ScheduleLogEntry } from '../src/contracts/schedule-log.ts';

export interface ScheduleLogParseResult {
    entries: ScheduleLogEntry[];
    errors: { line: number; message: string }[];
}

// Pure: turns the text of logs/schedule-changes.jsonl into valid entries and per-line errors.
// Error messages name the problem, never echo the line's values.
export function parseScheduleLogJsonl(text: string): ScheduleLogParseResult {
    const entries: ScheduleLogEntry[] = [];
    const errors: ScheduleLogParseResult['errors'] = [];
    text.split('\n').forEach((raw, index) => {
        const line = index + 1;
        if (raw.trim() === '') return;
        let json: unknown;
        try {
            json = JSON.parse(raw);
        } catch {
            errors.push({ line, message: 'invalid JSON' });
            return;
        }
        const parsed = scheduleLogEntrySchema.safeParse(json);
        if (parsed.success) {
            entries.push(parsed.data);
            return;
        }
        const message = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ');
        errors.push({ line, message });
    });
    return { entries, errors };
}
