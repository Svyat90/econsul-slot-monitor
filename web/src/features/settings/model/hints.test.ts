import { dateRangeHint, draftHint, notificationStatus, tokenLeft } from './hints.ts';

const URL = 'https://e-consul.gov.ua/tasks/abc/consularServiceInfo';
const NOW = Date.UTC(2026, 9, 9, 12);

describe('dateRangeHint', () => {
    it('says there is no limit', () => {
        expect(dateRangeHint({ from: null, to: null }, []).text).toMatch(/Без обмежень/);
    });
    it('flags an inverted range', () => {
        expect(dateRangeHint({ from: '2027-04-01', to: '2027-03-15' }, [])).toMatchObject({ tone: 'error' });
    });
    it('counts the slots the filter drops', () => {
        const hint = dateRangeHint({ from: '2027-03-15', to: null }, ['2027-03-14 09:00', '2027-03-16 09:00', '2027-03-17 09:00']);
        expect(hint.text).toBe('Сповіщення лише про слоти з 15.03.2027. Фільтр відкидає 1 з 3 вільних слотів.');
    });
});

describe('draftHint', () => {
    it('explains the empty field', () => {
        expect(draftHint(' ', null, NOW).text).toMatch(/нову заявку/);
    });
    it('rejects a link that is not a draft', () => {
        expect(draftHint('https://e-consul.gov.ua/tasks/create/1/2', null, NOW).tone).toBe('error');
    });
    it('reports a draft the extension found as deleted after its expiry', () => {
        const draft = { url: URL, savedAt: NOW - 1000, expiresAt: NOW - 1 };
        expect(draftHint(URL, draft, NOW)).toMatchObject({ tone: 'error', text: expect.stringContaining('видалив') });
    });
    it('warns about a draft saved over 24 h ago', () => {
        expect(draftHint(URL, { url: URL, savedAt: NOW - 25 * 3600_000 }, NOW).tone).toBe('error');
    });
    it('accepts a fresh draft', () => {
        expect(draftHint(URL, { url: URL, savedAt: NOW - 1000 }, NOW).tone).toBe('normal');
    });
});

describe('notificationStatus and tokenLeft', () => {
    it('marks only granted as ok', () => {
        expect(notificationStatus('granted').ok).toBe(true);
        expect(notificationStatus('denied').ok).toBe(false);
    });
    it('formats the time left', () => {
        expect(tokenLeft(NOW + (21 * 60 + 14) * 60000, NOW)).toBe('21 год 14 хв');
        expect(tokenLeft(NOW - 1, NOW)).toBeNull();
    });
});
