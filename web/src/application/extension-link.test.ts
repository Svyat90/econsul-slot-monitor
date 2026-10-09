import { describe, expect, it, vi } from 'vitest';
import type { ExtMessage } from '@/domain/contracts/extension-messages.ts';
import { createExtensionLink } from './extension-link.ts';
import type { Monitor, MonitorEvents, MonitorState } from './monitor.ts';
import type { AppMessageBody, Clock, Draft, Scheduler, SettingsStore, TimerHandle, Alerts, ExtensionBridge } from './ports.ts';

const NOW = 1_800_000_000_000;

function setup(overrides: Partial<MonitorState> = {}) {
    let nowMs = NOW;
    const sent: AppMessageBody[] = [];
    let listener: ((message: ExtMessage) => void) | null = null;
    const bridge: ExtensionBridge = {
        send: (message) => void sent.push(message),
        subscribe(l) {
            listener = l;
            return () => {
                listener = null;
            };
        },
    };
    const timers: { id: number; at: number; callback: () => void; every: number | null }[] = [];
    let nextId = 1;
    const scheduler: Scheduler = {
        setTimeout(callback, delayMs) {
            const id = nextId++;
            timers.push({ id, at: nowMs + delayMs, callback, every: null });
            return { id };
        },
        setInterval(callback, everyMs) {
            const id = nextId++;
            timers.push({ id, at: nowMs + everyMs, callback, every: everyMs });
            return { id };
        },
        clear(handle: TimerHandle | null) {
            const index = timers.findIndex((t) => t.id === handle?.id);
            if (index >= 0) timers.splice(index, 1);
        },
    };
    const advance = (ms: number) => {
        const end = nowMs + ms;
        for (;;) {
            const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
            if (!due) break;
            nowMs = due.at;
            if (due.every) due.at += due.every;
            else timers.splice(timers.indexOf(due), 1);
            due.callback();
        }
        nowMs = end;
    };
    const clock: Clock = { now: () => nowMs, localDateKey: () => '2026-10-09', browserOffsetMinutes: () => 0 };
    let draft: Draft | null = null;
    const settings = {
        loadDraft: () => draft,
        saveDraft: vi.fn((d: Draft | null) => {
            draft = d;
        }),
    } as unknown as SettingsStore;
    const alerts = {
        audioReady: () => true,
        unlockAudio: vi.fn(),
        playSessionSound: vi.fn(),
        setTabTitle: vi.fn(),
        openUrl: vi.fn(),
    } as unknown as Alerts;

    let state: MonitorState = {
        locations: { institutions: [], services: { '1': 'Паспорт' } } as unknown as MonitorState['locations'],
        selection: {
            institution: { code: '10', name: 'Х', country: 'США' } as never,
            serviceCode: '1',
        },
        running: false,
        stoppedBy: null,
        nextAt: 0,
        nextKind: 'scheduled',
        checking: false,
        lastResult: '',
        dateRange: { from: '2026-11-01', to: null },
        releases: [],
        free: null,
        ...overrides,
    } as MonitorState;
    const handlers: { [K in keyof MonitorEvents]: MonitorEvents[K][] } = { newSlots: [], authFailed: [], changed: [] };
    const monitor = {
        getState: () => state,
        subscribe: () => () => undefined,
        on: (event: keyof MonitorEvents, l: never) => {
            (handlers[event] as unknown[]).push(l);
            return () => undefined;
        },
        setToken: vi.fn(),
        sessionLost: vi.fn(),
        log: vi.fn(),
    } as unknown as Monitor;

    const link = createExtensionLink({ bridge, monitor, settings, alerts, clock, scheduler });
    return {
        link, sent, monitor, alerts, settings, advance, handlers,
        receive: (message: Record<string, unknown>) => listener?.({ source: 'econsul-ext', ...message } as ExtMessage),
        setMonitorState: (patch: Partial<MonitorState>) => {
            state = { ...state, ...patch };
        },
        types: () => sent.map((m) => m.type),
    };
}

describe('extension link', () => {
    it('first ext:hello connects and sends hello, selection and monitor', () => {
        const t = setup();
        t.link.start();
        t.sent.length = 0;
        t.receive({ type: 'ext:hello', version: '1.2.3' });
        expect(t.link.getState()).toMatchObject({ connected: true, version: '1.2.3' });
        expect(t.types()).toEqual(['app:hello', 'app:selection', 'app:monitor']);
        expect(t.sent[1]).toMatchObject({ selection: { institutionCode: '10', serviceName: 'Паспорт', countryName: 'США' } });
    });

    it('no answer within 3 s marks the extension disconnected', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:hello' });
        t.advance(15_000); // heartbeat: app:hello again
        expect(t.types().filter((x) => x === 'app:hello').length).toBeGreaterThanOrEqual(2);
        t.advance(3_000);
        expect(t.link.getState().connected).toBe(false);
    });

    it('ext:token resumes the monitor and acknowledges', () => {
        const t = setup({ stoppedBy: 'session' });
        t.link.start();
        t.receive({ type: 'ext:token', token: 'tok', exp: 5 });
        expect(t.monitor.setToken).toHaveBeenCalledWith('tok', 'extension');
        expect(t.sent.at(-1)).toEqual({ type: 'app:received', exp: 5 });
    });

    it('ext:auth loggedIn false calls sessionLost; alert plays the sound', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:auth', loggedIn: false, reason: 'out', alert: true });
        expect(t.monitor.sessionLost).toHaveBeenCalledWith('out');
        expect(t.alerts.playSessionSound).toHaveBeenCalled();
        expect(t.link.getState().auth).toEqual({ loggedIn: false, exp: null, reason: 'out' });
    });

    it('new slots go to the extension with the range, sorted, hash only when known', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:hello' });
        t.sent.length = 0;
        const free = { slotConsuls: { '2026-11-02 10:00': ['h1'] } } as never;
        t.handlers.newSlots[0]!(['2026-11-02 10:00', '2026-11-01 09:00'], free);
        expect(t.sent[0]).toEqual({
            type: 'app:slots',
            slots: [{ date: '2026-11-01', time: '09:00' }, { date: '2026-11-02', time: '10:00', consulIpnHash: 'h1' }],
            range: { from: '2026-11-01' },
            test: false,
        });
        expect(t.monitor.log).toHaveBeenCalled();
    });

    it('auth failure is forwarded with the token and soundPlayed', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:hello' });
        t.sent.length = 0;
        t.handlers.authFailed[0]!(401, 'old');
        expect(t.sent[0]).toEqual({ type: 'app:auth-failed', status: 401, soundPlayed: true, token: 'old' });
    });

    it('ext:draft is saved and acknowledged; null draft is ignored', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:draft', draft: null });
        expect(t.settings.saveDraft).not.toHaveBeenCalled();
        t.receive({ type: 'ext:draft', draft: { url: 'https://x/y', createdAt: 7, expiresAt: 9 } });
        expect(t.settings.saveDraft).toHaveBeenCalledWith({ url: 'https://x/y', savedAt: 7, expiresAt: 9, fromExtension: true });
        expect(t.sent.at(-1)).toEqual({ type: 'app:received', draftUrl: 'https://x/y' });
        expect(t.link.getState().draft?.url).toBe('https://x/y');
    });

    it('settings, login and test buttons', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:settings', autoBook: true, paused: false });
        expect(t.link.getState().autoBook).toBe(true);
        t.link.login(); // not connected: opens the site
        expect(t.alerts.openUrl).toHaveBeenCalledWith('https://e-consul.gov.ua/');
        t.receive({ type: 'ext:hello' });
        t.sent.length = 0;
        t.link.login();
        t.link.setAutoBook(false);
        t.link.testSound('mute');
        t.link.testSound('slots');
        expect(t.types()).toEqual(['app:login', 'app:settings', 'app:mute', 'app:slots']);
        expect(t.sent[3]).toMatchObject({ test: true });
    });

    it('dispose stops reacting', () => {
        const t = setup();
        t.link.start();
        t.link.dispose();
        t.receive({ type: 'ext:hello' });
        expect(t.link.getState().connected).toBe(false);
    });
});
