import { describe, expect, it } from 'vitest';
import { parseScheduleLogJsonl } from './schedule-log-jsonl.ts';

const valid = {
    time: '2026-10-09T10:00:00.000Z',
    institutionCode: 'NYC',
    institution: 'New York',
    type: 'baseline',
    changes: ['first snapshot'],
};

describe('parseScheduleLogJsonl', () => {
    it('returns valid lines as entries and skips blank lines', () => {
        const text = `${JSON.stringify(valid)}\n\n   \n${JSON.stringify({ ...valid, type: 'changed' })}\n`;
        const result = parseScheduleLogJsonl(text);
        expect(result.errors).toEqual([]);
        expect(result.entries.map((e) => e.type)).toEqual(['baseline', 'changed']);
    });

    it('reports invalid JSON and extra keys with their line numbers', () => {
        const text = [JSON.stringify(valid), '{not json', JSON.stringify({ ...valid, token: 'x' })].join('\n');
        const result = parseScheduleLogJsonl(text);
        expect(result.entries).toHaveLength(1);
        expect(result.errors.map((e) => e.line)).toEqual([2, 3]);
        expect(result.errors.every((e) => e.message.length > 0)).toBe(true);
        expect(JSON.stringify(result.errors)).not.toContain('"x"');
    });
});
