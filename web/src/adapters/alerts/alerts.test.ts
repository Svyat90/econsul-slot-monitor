import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAlerts } from './alerts.ts';

type FakeNode = { connect: (n: unknown) => unknown; [key: string]: unknown };

const makeNode = (): FakeNode => {
  const node: FakeNode = {
    connect: (next) => next,
    start: vi.fn(),
    stop: vi.fn(),
    frequency: { value: 0 },
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
  };
  return node;
};

const oscillators: FakeNode[] = [];

class FakeAudioContext {
  static created = 0;
  state = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = {};
  resume = vi.fn(() => {
    this.state = 'running';
  });
  constructor() {
    FakeAudioContext.created += 1;
  }
  createOscillator() {
    const node = makeNode();
    oscillators.push(node);
    return node;
  }
  createGain = () => makeNode();
  createBiquadFilter = () => makeNode();
  createBufferSource = () => makeNode();
  createBuffer = (_channels: number, length: number) => ({
    getChannelData: () => new Float32Array(length),
  });
}

type FakeNotificationInstance = {
  title: string;
  options: Record<string, unknown>;
  onclick: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
};

const notifications: FakeNotificationInstance[] = [];

const makeNotification = (permission: string) =>
  class FakeNotification {
    static permission = permission;
    static requestPermission = vi.fn(async () => {
      FakeNotification.permission = 'granted';
      return 'granted';
    });
    onclick: (() => void) | null = null;
    close = vi.fn();
    title: string;
    options: Record<string, unknown>;
    constructor(title: string, options: Record<string, unknown>) {
      this.title = title;
      this.options = options;
      notifications.push(this);
    }
  };

const makeWindow = (permission: string | null) => {
  const win = {
    AudioContext: FakeAudioContext,
    open: vi.fn(),
    focus: vi.fn(),
    document: { title: '' },
  } as Record<string, unknown>;
  if (permission !== null) win.Notification = makeNotification(permission);
  return win as unknown as Window;
};

beforeEach(() => {
  oscillators.length = 0;
  notifications.length = 0;
  FakeAudioContext.created = 0;
});

describe('notification permission', () => {
  it('reports unsupported when the browser has no Notification', () => {
    expect(createAlerts(makeWindow(null)).notificationPermission()).toBe('unsupported');
  });

  it('reports denied and granted', () => {
    expect(createAlerts(makeWindow('denied')).notificationPermission()).toBe('denied');
    expect(createAlerts(makeWindow('granted')).notificationPermission()).toBe('granted');
  });

  it('requests permission and returns the new state', async () => {
    const alerts = createAlerts(makeWindow('default'));
    expect(await alerts.requestNotificationPermission()).toBe('granted');
    expect(await createAlerts(makeWindow(null)).requestNotificationPermission()).toBe('unsupported');
  });
});

describe('newSlots', () => {
  it('shows a persistent notification and plays the chime', () => {
    const win = makeWindow('granted');
    const onClick = vi.fn();
    const alerts = createAlerts(win);
    alerts.unlockAudio();
    alerts.newSlots({ title: 'T', body: 'B', onClick });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.options).toEqual({
      body: 'B',
      tag: 'slots-found',
      renotify: true,
      requireInteraction: true,
    });
    expect(oscillators.length).toBe(9);
    notifications[0]?.onclick?.();
    expect(onClick).toHaveBeenCalledOnce();
    expect(notifications[0]?.close).toHaveBeenCalled();
  });

  it.each(['denied', 'default'])('plays the sound without a notification when permission is %s', (permission) => {
    const alerts = createAlerts(makeWindow(permission));
    alerts.newSlots({ title: 'T', body: 'B', onClick: vi.fn() });
    expect(notifications).toHaveLength(0);
    expect(oscillators.length).toBeGreaterThan(0);
  });

  it('does not throw when Notification is unsupported', () => {
    const alerts = createAlerts(makeWindow(null));
    expect(() => alerts.newSlots({ title: 'T', body: 'B', onClick: vi.fn() })).not.toThrow();
    expect(oscillators.length).toBeGreaterThan(0);
  });
});

describe('sessionExpired', () => {
  it('notifies with the session-expired tag and plays the glass', () => {
    createAlerts(makeWindow('granted')).sessionExpired({ title: 'T', body: 'B', notify: true });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.options.tag).toBe('session-expired');
    expect(oscillators.length).toBeGreaterThan(0);
  });

  it('skips the notification when notify is false but still plays', () => {
    createAlerts(makeWindow('granted')).sessionExpired({ title: 'T', body: 'B', notify: false });
    expect(notifications).toHaveLength(0);
    expect(oscillators.length).toBeGreaterThan(0);
  });

  it('focuses the window on click', () => {
    const win = makeWindow('granted');
    createAlerts(win).sessionExpired({ title: 'T', body: 'B', notify: true });
    notifications[0]?.onclick?.();
    expect(win.focus).toHaveBeenCalled();
  });
});

describe('audio', () => {
  it('is not ready until unlocked, then ready', () => {
    const alerts = createAlerts(makeWindow(null));
    expect(alerts.audioReady()).toBe(false);
    alerts.unlockAudio();
    expect(alerts.audioReady()).toBe(true);
    alerts.unlockAudio();
    expect(FakeAudioContext.created).toBe(1);
  });

  it('playSessionSound plays', () => {
    createAlerts(makeWindow(null)).playSessionSound();
    expect(oscillators.length).toBeGreaterThan(0);
  });
});

describe('misc', () => {
  it('sets the tab title', () => {
    const win = makeWindow(null);
    createAlerts(win).setTabTitle('X');
    expect(win.document.title).toBe('X');
  });

  it('opens a url in a new tab with noopener', () => {
    const win = makeWindow(null);
    createAlerts(win).openUrl('https://example.com');
    expect(win.open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener');
  });
});
