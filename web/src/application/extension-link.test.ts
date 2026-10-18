import { describe, expect, it, vi } from 'vitest';
import type { ExtMessage } from '@/domain/contracts/extension-messages.ts';
import { createExtensionLink } from './extension-link.ts';
import type { Monitor, MonitorEvents, MonitorState } from './monitor.ts';
import type { AppMessageBody, Clock, Draft, Scheduler, SettingsStore, TimerHandle, Alerts, ExtensionBridge } from './ports.ts';

const NOW = 1_800_000_000_000;

function setup(overrides: Partial<MonitorState> = {}, initialDraft: Draft | null = null) {
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
    let draft: Draft | null = initialDraft;
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
        tabTitleMarks: true,
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
        start: vi.fn(async () => undefined),
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
    it('setDraftUrl saves a new link with savedAt = now, keeps the time of the same link, clears on empty', () => {
        const t = setup();
        expect(t.link.getState().draft).toBeNull();
        t.link.setDraftUrl('  https://e-consul.gov.ua/tasks/1 ');
        expect(t.link.getState().draft).toEqual({ url: 'https://e-consul.gov.ua/tasks/1', savedAt: NOW });
        expect(t.settings.saveDraft).toHaveBeenLastCalledWith({ url: 'https://e-consul.gov.ua/tasks/1', savedAt: NOW });
        t.advance(60_000);
        t.link.setDraftUrl('https://e-consul.gov.ua/tasks/1');
        expect(t.link.getState().draft?.savedAt).toBe(NOW);
        t.link.setDraftUrl('https://e-consul.gov.ua/tasks/2');
        expect(t.link.getState().draft?.savedAt).toBe(NOW + 60_000);
        t.link.setDraftUrl('  ');
        expect(t.link.getState().draft).toBeNull();
        expect(t.settings.saveDraft).toHaveBeenLastCalledWith(null);
    });

    it('the draft at start comes from the settings store', () => {
        const t = setup({}, { url: 'https://e-consul.gov.ua/tasks/9', savedAt: 5 });
        expect(t.link.getState().draft).toEqual({ url: 'https://e-consul.gov.ua/tasks/9', savedAt: 5 });
    });

    it('no session title when tab title marks are off', () => {
        const t = setup({ tabTitleMarks: false });
        t.link.start();
        t.receive({ type: 'ext:auth', loggedIn: false, alert: true });
        expect(t.alerts.setTabTitle).not.toHaveBeenCalled();
        expect(t.alerts.playSessionSound).toHaveBeenCalled();
    });

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

    it('a draft from the extension gets every free slot in range once; a next draft gets them again', () => {
        const free = { keys: ['2026-10-30 09:00', '2026-11-02 10:00', '2026-11-01 09:00'], slotConsuls: {} } as never;
        const t = setup({ running: true, free });
        t.link.start();
        t.receive({ type: 'ext:hello' });
        t.sent.length = 0;
        const slotsSent = () => t.sent.filter((m) => m.type === 'app:slots');

        t.receive({ type: 'ext:draft', draft: { url: 'https://e-consul.gov.ua/tasks/a1/consularServiceInfo', createdAt: 7 } });
        expect(slotsSent()).toEqual([{
            type: 'app:slots',
            slots: [{ date: '2026-11-01', time: '09:00' }, { date: '2026-11-02', time: '10:00' }],
            range: { from: '2026-11-01' },
            test: false,
            all: true,
        }]);
        // the same draft on another step: nothing again
        t.receive({ type: 'ext:draft', draft: { url: 'https://e-consul.gov.ua/tasks/a1/dateAndTimeVisitInfo', createdAt: 7 } });
        expect(slotsSent()).toHaveLength(1);
        // the draft is gone, a new one comes (also after the extension reloads)
        t.receive({ type: 'ext:draft', draft: null });
        t.receive({ type: 'ext:draft', draft: { url: 'https://e-consul.gov.ua/tasks/b2/applicantInfo', createdAt: 8 } });
        expect(slotsSent()).toHaveLength(2);
    });

    it('no free slots are offered while the monitor is stopped or has none in range', () => {
        const t = setup({ running: false, free: { keys: ['2026-11-01 09:00'], slotConsuls: {} } as never });
        t.link.start();
        t.receive({ type: 'ext:hello' });
        t.receive({ type: 'ext:draft', draft: { url: 'https://e-consul.gov.ua/tasks/a1/x', createdAt: 7 } });
        t.setMonitorState({ running: true, free: { keys: ['2026-10-01 09:00'], slotConsuls: {} } as never });
        t.receive({ type: 'ext:draft', draft: { url: 'https://e-consul.gov.ua/tasks/a2/x', createdAt: 8 } });
        expect(t.types()).not.toContain('app:slots');
    });

    it('a draft that vanished in the extension is dropped when the extension gave it, kept when pasted by hand', () => {
        const fromExtension = setup({}, { url: 'https://x/y', savedAt: 1, fromExtension: true });
        fromExtension.link.start();
        fromExtension.receive({ type: 'ext:draft', draft: null });
        expect(fromExtension.settings.saveDraft).toHaveBeenCalledWith(null);
        expect(fromExtension.link.getState().draft).toBeNull();

        const pasted = setup({}, { url: 'https://x/y', savedAt: 1 });
        pasted.link.start();
        pasted.receive({ type: 'ext:draft', draft: null });
        expect(pasted.link.getState().draft?.url).toBe('https://x/y');
    });

    it('ext:draft-job: shows the running creation, the failure reason (also in the log) and clears when done', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:draft-job', status: 'running' });
        expect(t.link.getState().draftJob).toEqual({ status: 'running', text: null });
        t.receive({ type: 'ext:draft-job', status: 'failed', error: 'unavailable', text: 'Сайт пише, що запис зараз недоступний.' });
        expect(t.link.getState().draftJob).toEqual({ status: 'failed', text: 'Сайт пише, що запис зараз недоступний.' });
        expect(t.monitor.log).toHaveBeenCalledWith('Чернетку не створено: Сайт пише, що запис зараз недоступний.', 'warn');
        t.receive({ type: 'ext:draft-job', status: null });
        expect(t.link.getState().draftJob).toBeNull();
    });

    it('createDraft asks the extension, and does nothing without it', () => {
        const t = setup();
        t.link.createDraft();
        expect(t.types()).not.toContain('app:create-draft');
        t.link.start();
        t.receive({ type: 'ext:hello' });
        t.link.createDraft();
        expect(t.types()).toContain('app:create-draft');
    });

    it('ext:settings carries auto draft and the alarm; setDraftSettings updates the state and tells the extension', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:hello' });
        expect(t.link.getState()).toMatchObject({ autoDraft: true, alarmEnabled: true, alarmLeadMin: 5 });
        t.receive({ type: 'ext:settings', autoBook: false, paused: false, autoDraft: false, alarmEnabled: false, alarmLeadMin: 12 });
        expect(t.link.getState()).toMatchObject({ autoDraft: false, alarmEnabled: false, alarmLeadMin: 12 });
        t.receive({ type: 'ext:settings', autoBook: true, paused: false }); // an old extension: the rest stays
        expect(t.link.getState()).toMatchObject({ autoBook: true, aggressiveBook: false, autoDraft: false, alarmLeadMin: 12 });
        t.receive({ type: 'ext:settings', autoBook: true, aggressiveBook: true, paused: false });
        expect(t.link.getState().aggressiveBook).toBe(true);
        // the session ended: the extension turns aggressive booking off
        t.receive({ type: 'ext:settings', autoBook: true, aggressiveBook: false, paused: false });
        expect(t.link.getState().aggressiveBook).toBe(false);
        t.sent.length = 0;
        t.link.setDraftSettings({ alarmLeadMin: 8 });
        expect(t.link.getState().alarmLeadMin).toBe(8);
        expect(t.sent[0]).toEqual({ type: 'app:settings', patch: { alarmLeadMin: 8 } });
        t.link.setDraftSettings({ aggressiveBook: true });
        expect(t.sent[1]).toEqual({ type: 'app:settings', patch: { aggressiveBook: true } });
    });

    it('starts the monitor after a login when «start monitoring after login» is on, and only then', () => {
        const login = (t: ReturnType<typeof setup>) => {
            t.receive({ type: 'ext:auth', loggedIn: false, exp: null });
            t.receive({ type: 'ext:auth', loggedIn: true, exp: NOW + 3600_000 });
            t.receive({ type: 'ext:token', token: 'new', exp: NOW + 3600_000 });
        };
        const on = setup();
        on.link.start();
        on.receive({ type: 'ext:settings', autoBook: false, paused: false, autoMonitor: true });
        login(on);
        expect(on.monitor.setToken).toHaveBeenCalledWith('new', 'extension');
        expect(on.monitor.start).toHaveBeenCalledOnce();
        expect(on.monitor.log).toHaveBeenCalledWith(expect.stringContaining('запускаю моніторинг'));

        const off = setup();
        off.link.start();
        login(off);
        expect(off.monitor.start).not.toHaveBeenCalled(); // off by default

        const running = setup({ running: true });
        running.link.start();
        running.receive({ type: 'ext:settings', autoBook: false, paused: false, autoMonitor: true });
        login(running);
        expect(running.monitor.start).not.toHaveBeenCalled(); // already running (or resumed by itself)
    });

    it('the first auth after the page opened is not a login: no start', () => {
        const t = setup();
        t.link.start();
        t.receive({ type: 'ext:settings', autoBook: false, paused: false, autoMonitor: true });
        t.receive({ type: 'ext:auth', loggedIn: true, exp: NOW + 3600_000 });
        t.receive({ type: 'ext:token', token: 'old', exp: NOW + 3600_000 });
        expect(t.monitor.start).not.toHaveBeenCalled();
    });

    it('ext:alarm is kept for the banner and logged', () => {
        const t = setup();
        t.link.start();
        expect(t.link.getState().alarm).toBeNull();
        t.receive({ type: 'ext:alarm', at: NOW + 5 * 60_000, opening: '09:00' });
        expect(t.link.getState().alarm).toEqual({ at: NOW + 5 * 60_000 });
        expect(t.monitor.log).toHaveBeenCalledWith(expect.stringContaining('Скоро відкриття'));
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
