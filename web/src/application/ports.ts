// Ports of the web app (plan §4 «Порти»). Use cases depend on these; adapters implement them;
// src/app/providers.tsx wires them together.
import type { CheckEntry, CheckQuery, StoredCheckEntry } from '@contracts/checks.ts';
import type { RequestLogEntry } from '@contracts/request-log.ts';
import type { ReservationEvent, ReservationQuery, StoredReservationEvent } from '@contracts/reservation-log.ts';
import type { ScheduleLogEntry, StoredScheduleLogEntry } from '@contracts/schedule-log.ts';
import type { Summary } from '@contracts/summary.ts';
import type { HistoryQuery } from '@contracts/common.ts';
import type { ReservedResponse, ScheduleResponse } from '@/domain/contracts/econsul.ts';
import type { AppMessage, ExtMessage } from '@/domain/contracts/extension-messages.ts';
import type { Locations } from '@/domain/contracts/locations.ts';
import type { DateRange } from '@/domain/monitoring/slots-diff.ts';
import type { SnapshotRow } from '@/domain/monitoring/schedule-changes.ts';
import type { DateKey } from '@/domain/slots/time.ts';

// ---- e-Consul (adapters/econsul-api) ----

// Which check a request belongs to; the request log (adapters/request-log) records it.
export type RequestMeta = { checkKind: 'scheduled' | 'fast' | 'manual' | null; checkSeq: number | null };

// Read-only requests the monitor makes, from the browser with the user's token.
// Throws SessionExpiredError (401/403), EconsulUnavailableError (other HTTP errors, network) or
// EconsulSchemaError (the answer does not match domain/contracts/econsul.ts).
export interface EconsulApi {
    getSchedule(institutionCode: string, token: string, meta?: RequestMeta): Promise<ScheduleResponse>;
    getReservedSlots(request: { institutionCode: string; consulIpnHash: readonly string[] }, token: string, meta?: RequestMeta): Promise<ReservedResponse>;
}

// ---- Our server (adapters/server-api, adapters/locations-source) ----

// Fire-and-forget writes to the server's logs: never throw, never slow monitoring. The adapter
// batches them and keeps unsent entries in memory (bounded) while the server or the database is
// down, retrying later.
export interface ServerApi {
    recordScheduleChange(entry: ScheduleLogEntry): void;
    recordRequest(entry: RequestLogEntry): void;
    recordCheck(entry: CheckEntry): void;
    recordReservations(events: readonly ReservationEvent[]): void;
}

export type Page<T> = { entries: T[]; nextCursor: number | null };

// History for the Monitoring page (GET /api/*). These may throw; the page shows the error.
export interface LogHistory {
    summary(range: { from: string; to: string; institutionCode?: string }): Promise<Summary>;
    checks(query: Partial<CheckQuery>): Promise<Page<StoredCheckEntry>>;
    reservations(query: Partial<ReservationQuery>): Promise<Page<StoredReservationEvent>>;
    scheduleChanges(query: Partial<HistoryQuery>): Promise<Page<StoredScheduleLogEntry>>;
    scheduleLogDownloadUrl(): string; // GET /api/schedule-log.jsonl
}

export interface LocationsSource {
    load(): Promise<Locations>;
}

// ---- Extension (adapters/extension-bridge) ----

// The message body without `source`; the adapter adds `source: 'econsul-app'`.
export type AppMessageBody = AppMessage extends infer M ? M extends unknown ? Omit<M, 'source'> : never : never;

export interface ExtensionBridge {
    send(message: AppMessageBody): void;
    // Only messages from this window, this origin, with source 'econsul-ext' that parse with the
    // protocol contract reach the listener.
    subscribe(listener: (message: ExtMessage) => void): () => void;
}

// ---- Alerts (adapters/alerts) ----

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

export interface Alerts {
    notificationPermission(): NotificationPermissionState;
    requestNotificationPermission(): Promise<NotificationPermissionState>;
    // Audio must be unlocked inside a user gesture (a click) before sounds can play later.
    unlockAudio(): void;
    audioReady(): boolean;
    // Chime ×3 and a notification that stays until closed; onClick replaces "focus this tab".
    newSlots(alert: { title: string; body: string; onClick: () => void }): void;
    // Broken glass ×2; the notification is shown only when `notify` (no extension to show its own).
    sessionExpired(alert: { title: string; body: string; notify: boolean }): void;
    playSessionSound(): void;
    setTabTitle(title: string): void;
    openUrl(url: string): void;
}

// ---- Settings (adapters/settings-store): the same localStorage keys as slots.html ----

export type Selection = { institution: string; service: string };
export type IntervalBounds = { min: number; max: number };
// savedAt approximates the draft's creation time; expiresAt is exact when the extension found it
export type Draft = { url: string; savedAt: number; expiresAt?: number | null; fromExtension?: boolean };
export type ScheduleSnapshot = { checkedAt: string; rows: SnapshotRow[] };

export interface SettingsStore {
    loadSelection(): Partial<Selection>; // 'slots.selection'
    saveSelection(selection: Selection): void;
    loadInterval(): IntervalBounds | null; // 'slots.interval'
    saveInterval(bounds: IntervalBounds): void;
    loadDateRange(): DateRange; // 'slots.dateRange'
    saveDateRange(range: DateRange): void;
    loadDraft(): Draft | null; // 'slots.draft'
    saveDraft(draft: Draft | null): void;
    loadScheduleSnapshot(institutionCode: string): ScheduleSnapshot | null; // 'slots.schedule.<code>'
    saveScheduleSnapshot(institutionCode: string, snapshot: ScheduleSnapshot): void;
}

// ---- Time, randomness, timers (adapters/browser-runtime; fakes in tests) ----

export interface Clock {
    now(): number;
    localDateKey(ms: number): DateKey; // the browser's calendar date of a moment
    browserOffsetMinutes(ms: number): number; // -new Date(ms).getTimezoneOffset()
}

export interface Random {
    next(): number; // [0, 1)
}

export interface Ids {
    uuid(): string; // client_id of a log entry, tab session id
}

// One app tab = one session in the logs (tab_session_id); the version of the app that wrote it.
export type AppSession = { tabSessionId: string; appVersion: string };

export type TimerHandle = { readonly id: unknown };

export interface Scheduler {
    setTimeout(callback: () => void, delayMs: number): TimerHandle;
    setInterval(callback: () => void, everyMs: number): TimerHandle;
    clear(handle: TimerHandle | null): void;
}
