import { formatFreshSlots, freshBadge, sessionBanner } from './banners.ts';

const NOW = Date.UTC(2026, 9, 9, 12);
const connected = (auth: { loggedIn: boolean | null; exp: number | null }) => ({
    connected: true,
    auth: { ...auth, reason: null },
});

describe('sessionBanner', () => {
    it('is hidden without the extension or with an unknown session', () => {
        expect(sessionBanner({ connected: false, auth: null }, null, NOW)).toBeNull();
        expect(sessionBanner(connected({ loggedIn: null, exp: null }), null, NOW)).toBeNull();
    });
    it('asks to log in, and says the monitor resumes when the session stopped it', () => {
        expect(sessionBanner(connected({ loggedIn: false, exp: null }), null, NOW)).toEqual({ kind: 'login', resumes: false });
        expect(sessionBanner(connected({ loggedIn: false, exp: null }), 'session', NOW)).toEqual({ kind: 'login', resumes: true });
        expect(sessionBanner(connected({ loggedIn: true, exp: NOW - 1 }), null, NOW)).toEqual({ kind: 'login', resumes: false });
    });
    it('warns below 30 minutes, not at exactly 30', () => {
        expect(sessionBanner(connected({ loggedIn: true, exp: NOW + 29 * 60_000 }), null, NOW)).toEqual({ kind: 'expiring', exp: NOW + 29 * 60_000 });
        expect(sessionBanner(connected({ loggedIn: true, exp: NOW + 30 * 60_000 }), null, NOW)).toBeNull();
    });
});

describe('formatFreshSlots', () => {
    it('groups times by day with the weekday', () => {
        expect(formatFreshSlots(['2027-03-31 11:40', '2027-03-31 09:50', '2027-04-01 10:00'])).toBe('ср 31.03 09:50, 11:40 · чт 01.04 10:00');
    });
});

describe('freshBadge', () => {
    it('declines the word', () => {
        expect([1, 2, 5, 11, 22].map(freshBadge)).toEqual(['1 новий', '2 нові', '5 нових', '11 нових', '22 нові']);
    });
});
