import type { Alerts, NotificationPermissionState } from '@/application/ports.ts';
import { createSounds } from './sounds.ts';

type NotificationWindow = Window & { Notification?: typeof Notification };

export const createAlerts = (win: Window = window): Alerts => {
  const sounds = createSounds(win);

  const NotificationApi = (win as NotificationWindow).Notification;

  const permission = (): NotificationPermissionState =>
    NotificationApi ? NotificationApi.permission : 'unsupported';

  // requireInteraction keeps the notification on screen until the user closes it.
  // onClick replaces the default "focus this tab" action.
  const notify = (title: string, body: string, tag: string, onClick?: () => void): void => {
    if (!NotificationApi || NotificationApi.permission !== 'granted') return;
    // `renotify` is missing from the DOM lib typings
    const options: NotificationOptions & { renotify: boolean } = {
      body,
      tag,
      renotify: true,
      requireInteraction: true,
    };
    const notification = new NotificationApi(title, options);
    notification.onclick = () => {
      if (onClick) onClick();
      else win.focus();
      notification.close();
    };
  };

  return {
    notificationPermission: permission,
    requestNotificationPermission: async () => {
      if (!NotificationApi) return 'unsupported';
      return await NotificationApi.requestPermission();
    },
    unlockAudio: sounds.unlock,
    audioReady: sounds.ready,
    newSlots: ({ title, body, onClick }) => {
      sounds.playSlotSound();
      notify(title, body, 'slots-found', onClick);
    },
    sessionExpired: ({ title, body, notify: showNotification }) => {
      sounds.playSessionSound();
      if (showNotification) notify(title, body, 'session-expired');
    },
    playSessionSound: sounds.playSessionSound,
    setTabTitle: (title) => {
      win.document.title = title;
    },
    openUrl: (url) => {
      win.open(url, '_blank', 'noopener');
    },
  };
};
