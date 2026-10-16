// SettingsStore over localStorage: the same keys and JSON formats as slots.html. Storage that is
// missing, full or throwing never breaks the app: reads fall back to defaults, writes are skipped.
import type { Draft, IntervalBounds, ScheduleSnapshot, Selection, SettingsStore } from '@/application/ports.ts';
import type { DateRange } from '@/domain/monitoring/slots-diff.ts';

const SELECTION_KEY = 'slots.selection';
const INTERVAL_KEY = 'slots.interval';
const DATE_RANGE_KEY = 'slots.dateRange';
const DRAFT_KEY = 'slots.draft';
const TAB_TITLE_MARKS_KEY = 'slots.tabTitleMarks';
const MONITORING_KEY = 'slots.monitoring';
const KNOWN_FREE_KEY = 'slots.knownFree';
const SCHEDULE_KEY_PREFIX = 'slots.schedule.';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createSettingsStore(storage?: Storage, sessionStore?: Storage): SettingsStore {
    function readJson(key: string): unknown {
        try {
            const raw = (storage ?? localStorage).getItem(key);
            return raw === null ? null : JSON.parse(raw);
        } catch {
            return null;
        }
    }

    function writeJson(key: string, value: unknown): void {
        try {
            (storage ?? localStorage).setItem(key, JSON.stringify(value));
        } catch {
            /* storage unavailable */
        }
    }

    function remove(key: string): void {
        try {
            (storage ?? localStorage).removeItem(key);
        } catch {
            /* storage unavailable */
        }
    }

    return {
        loadSelection(): Partial<Selection> {
            const saved = readJson(SELECTION_KEY);
            if (!isRecord(saved)) return {};
            const result: Partial<Selection> = {};
            if (typeof saved.institution === 'string') result.institution = saved.institution;
            if (typeof saved.service === 'string') result.service = saved.service;
            return result;
        },
        saveSelection(selection) {
            writeJson(SELECTION_KEY, selection);
        },
        loadInterval(): IntervalBounds | null {
            const saved = readJson(INTERVAL_KEY);
            if (!isRecord(saved)) return null;
            const min = Number(saved.min);
            const max = Number(saved.max);
            return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
        },
        saveInterval(bounds) {
            writeJson(INTERVAL_KEY, bounds);
        },
        loadDateRange(): DateRange {
            const saved = readJson(DATE_RANGE_KEY);
            if (!isRecord(saved)) return { from: null, to: null };
            return {
                from: typeof saved.from === 'string' && saved.from ? saved.from : null,
                to: typeof saved.to === 'string' && saved.to ? saved.to : null,
            };
        },
        saveDateRange(range) {
            writeJson(DATE_RANGE_KEY, range);
        },
        loadDraft(): Draft | null {
            const saved = readJson(DRAFT_KEY);
            if (!isRecord(saved) || typeof saved.url !== 'string' || typeof saved.savedAt !== 'number') return null;
            const draft: Draft = { url: saved.url, savedAt: saved.savedAt };
            if (typeof saved.expiresAt === 'number' || saved.expiresAt === null) draft.expiresAt = saved.expiresAt;
            if (saved.fromExtension === true) draft.fromExtension = true;
            return draft;
        },
        saveDraft(draft) {
            if (draft === null) remove(DRAFT_KEY);
            else writeJson(DRAFT_KEY, draft);
        },
        loadScheduleSnapshot(institutionCode): ScheduleSnapshot | null {
            const saved = readJson(SCHEDULE_KEY_PREFIX + institutionCode);
            if (!isRecord(saved) || typeof saved.checkedAt !== 'string' || !Array.isArray(saved.rows)) return null;
            return { checkedAt: saved.checkedAt, rows: saved.rows as ScheduleSnapshot['rows'] };
        },
        saveScheduleSnapshot(institutionCode, snapshot) {
            writeJson(SCHEDULE_KEY_PREFIX + institutionCode, snapshot);
        },
        loadTabTitleMarks() {
            return readJson(TAB_TITLE_MARKS_KEY) !== false;
        },
        saveTabTitleMarks(on) {
            writeJson(TAB_TITLE_MARKS_KEY, on);
        },
        loadMonitoring() {
            try {
                return (sessionStore ?? storage ?? sessionStorage).getItem(MONITORING_KEY) === '1';
            } catch {
                return false;
            }
        },
        saveMonitoring(on) {
            try {
                const target = sessionStore ?? storage ?? sessionStorage;
                if (on) target.setItem(MONITORING_KEY, '1');
                else target.removeItem(MONITORING_KEY);
            } catch {
                /* storage unavailable */
            }
        },
        loadKnownFree(scope) {
            try {
                const raw = (sessionStore ?? storage ?? sessionStorage).getItem(KNOWN_FREE_KEY);
                const saved: unknown = raw ? JSON.parse(raw) : null;
                if (!isRecord(saved) || saved.scope !== scope || !Array.isArray(saved.keys)) return null;
                return saved.keys.filter((key): key is string => typeof key === 'string');
            } catch {
                return null;
            }
        },
        saveKnownFree(scope, keys) {
            try {
                const target = sessionStore ?? storage ?? sessionStorage;
                if (keys) target.setItem(KNOWN_FREE_KEY, JSON.stringify({ scope, keys }));
                else target.removeItem(KNOWN_FREE_KEY);
            } catch {
                /* storage unavailable */
            }
        },
    };
}
