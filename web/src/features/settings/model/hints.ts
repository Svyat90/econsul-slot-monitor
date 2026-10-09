// Texts of the settings page (slots.html renderDateRangeHint(), renderDraftHint(),
// renderNotificationHint(), formatTokenUntil()). Pure: the moment comes in as an argument.
import type { DateRange, SlotKey } from '@/domain/monitoring/slots-diff.ts';
import { inDateRange } from '@/domain/monitoring/slots-diff.ts';
import { DRAFT_URL_RE } from '@/domain/booking/booking-url.ts';
import type { Draft, NotificationPermissionState } from '@/application/ports.ts';

export type Hint = { text: string; tone: 'normal' | 'error' };

const DRAFT_TTL_MS = 24 * 3600_000;
const showDate = (dateKey: string) => dateKey.split('-').reverse().join('.');

export function dateRangeHint(range: DateRange, freeKeys: readonly SlotKey[]): Hint {
    const { from, to } = range;
    if (from && to && from > to) {
        return { tone: 'error', text: '«Не раніше» пізніше за «не пізніше»: жоден слот не пройде фільтр.' };
    }
    if (!from && !to) return { tone: 'normal', text: 'Без обмежень за датами: сповіщення про всі нові слоти.' };
    const span = from && to ? `з ${showDate(from)} по ${showDate(to)}` : from ? `з ${showDate(from)}` : `по ${showDate(to!)}`;
    const dropped = freeKeys.filter((key) => !inDateRange(key, range)).length;
    return {
        tone: 'normal',
        text: `Сповіщення лише про слоти ${span}.` + (freeKeys.length ? ` Фільтр відкидає ${dropped} з ${freeKeys.length} вільних слотів.` : ''),
    };
}

export function draftHint(url: string, draft: Draft | null, nowMs: number): Hint {
    const typed = url.trim();
    const at = (ms: number) => new Date(ms).toLocaleString('uk-UA');
    if (!typed) return { tone: 'normal', text: 'Без чернетки «Забронювати на e-consul» відкриває нову заявку.' };
    if (!DRAFT_URL_RE.test(typed)) {
        return {
            tone: 'error',
            text: 'Це не посилання на чернетку. Скопіюйте адресу сторінки заявки, напр. https://e-consul.gov.ua/tasks/<id>/consularServiceInfo. Замість неї відкриється нова заявка.',
        };
    }
    const same = draft && draft.url === typed ? draft : null;
    if (same?.expiresAt) {
        if (nowMs >= same.expiresAt) {
            return { tone: 'error', text: `Сайт видалив цю чернетку о ${at(same.expiresAt)}. Створіть нову: «Створити нову» в розширенні.` };
        }
        return {
            tone: 'normal',
            text: `Підхоплено розширенням · створено ${at(same.savedAt)} · видалиться ${at(same.expiresAt)}. Порожнє поле — нова заявка.`,
        };
    }
    if (same && nowMs - same.savedAt > DRAFT_TTL_MS) {
        return { tone: 'error', text: 'Збережено понад 24 год тому: сайт, імовірно, вже видалив цю чернетку. Створіть нову й вставте її посилання.' };
    }
    return {
        tone: 'normal',
        text: 'Чернетку буде відкрито кнопкою «Забронювати на e-consul»' + (same ? ` (збережено ${at(same.savedAt)}; чернетки живуть ~24 год)` : '') + '.',
    };
}

// The notification line: a green dot when allowed, otherwise what to do
export function notificationStatus(permission: NotificationPermissionState): { ok: boolean; text: string } {
    switch (permission) {
        case 'granted':
            return { ok: true, text: 'Сповіщення браузера дозволено' };
        case 'denied':
            return { ok: false, text: 'Сповіщення заблоковано для цієї сторінки: дозвольте їх у налаштуваннях сайту в браузері. Лунатиме лише звук.' };
        case 'default':
            return { ok: false, text: 'Сповіщення ще не дозволено: браузер запитає при запуску моніторингу.' };
        case 'unsupported':
            return { ok: false, text: 'Цей браузер не підтримує сповіщення: лунатиме лише звук.' };
    }
}

// "21 год 14 хв" left of the token; null when it is over
export function tokenLeft(expMs: number, nowMs: number): string | null {
    const minutes = Math.floor((expMs - nowMs) / 60000);
    if (minutes <= 0) return null;
    return `${Math.floor(minutes / 60)} год ${minutes % 60} хв`;
}
