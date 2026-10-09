import { describe, expect, it } from 'vitest';
import { createSettingsStore } from './settings-store.ts';

function memoryStorage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial));
    return {
        get length() { return data.size; },
        clear: () => data.clear(),
        getItem: (k) => data.get(k) ?? null,
        key: (i) => [...data.keys()][i] ?? null,
        removeItem: (k) => { data.delete(k); },
        setItem: (k, v) => { data.set(k, String(v)); },
    };
}

const throwing: Storage = {
    length: 0,
    clear() { throw new Error('x'); },
    getItem() { throw new Error('x'); },
    key() { throw new Error('x'); },
    removeItem() { throw new Error('x'); },
    setItem() { throw new Error('x'); },
};

describe('settings store', () => {
    it('reads values written in the slots.html format', () => {
        const store = createSettingsStore(memoryStorage({
            'slots.selection': '{"institution":"I1","service":"S1"}',
            'slots.interval': '{"min":30,"max":60}',
            'slots.dateRange': '{"from":"2026-01-01","to":""}',
            'slots.draft': '{"url":"https://e-consul.gov.ua/tasks/1","savedAt":5,"expiresAt":null,"fromExtension":true}',
            'slots.schedule.X': '{"checkedAt":"2026-01-01T00:00:00.000Z","rows":[]}',
        }));
        expect(store.loadSelection()).toEqual({ institution: 'I1', service: 'S1' });
        expect(store.loadInterval()).toEqual({ min: 30, max: 60 });
        expect(store.loadDateRange()).toEqual({ from: '2026-01-01', to: null });
        expect(store.loadDraft()).toEqual({ url: 'https://e-consul.gov.ua/tasks/1', savedAt: 5, expiresAt: null, fromExtension: true });
        expect(store.loadScheduleSnapshot('X')).toEqual({ checkedAt: '2026-01-01T00:00:00.000Z', rows: [] });
    });

    it('round-trips writes and removes the draft on null', () => {
        const storage = memoryStorage();
        const store = createSettingsStore(storage);
        store.saveSelection({ institution: 'A', service: 'B' });
        expect(JSON.parse(storage.getItem('slots.selection')!)).toEqual({ institution: 'A', service: 'B' });
        store.saveDraft({ url: 'u', savedAt: 1 });
        expect(store.loadDraft()).toEqual({ url: 'u', savedAt: 1 });
        store.saveDraft(null);
        expect(storage.getItem('slots.draft')).toBeNull();
    });

    it('falls back to defaults on broken JSON', () => {
        const store = createSettingsStore(memoryStorage({
            'slots.selection': '{oops', 'slots.interval': 'nope', 'slots.dateRange': '[', 'slots.draft': '{', 'slots.schedule.X': '1',
        }));
        expect(store.loadSelection()).toEqual({});
        expect(store.loadInterval()).toBeNull();
        expect(store.loadDateRange()).toEqual({ from: null, to: null });
        expect(store.loadDraft()).toBeNull();
        expect(store.loadScheduleSnapshot('X')).toBeNull();
    });

    it('does not break when storage throws', () => {
        const store = createSettingsStore(throwing);
        expect(store.loadSelection()).toEqual({});
        expect(store.loadDraft()).toBeNull();
        expect(() => {
            store.saveSelection({ institution: 'A', service: 'B' });
            store.saveInterval({ min: 1, max: 2 });
            store.saveDateRange({ from: null, to: null });
            store.saveDraft(null);
            store.saveDraft({ url: 'u', savedAt: 1 });
            store.saveScheduleSnapshot('X', { checkedAt: 't', rows: [] });
        }).not.toThrow();
    });
});
