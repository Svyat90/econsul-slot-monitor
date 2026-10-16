import { alarmActive, draftBanner, formatFreshSlots, freshBadge, sessionBanner } from './banners.ts';

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
    it('shows at most four days and counts the rest', () => {
        const keys = ['2027-03-29 09:00', '2027-03-30 09:00', '2027-03-31 09:00', '2027-04-01 09:00', '2027-04-02 09:00', '2027-04-05 09:00'];
        expect(formatFreshSlots(keys)).toBe('пн 29.03 09:00 · вт 30.03 09:00 · ср 31.03 09:00 · чт 01.04 09:00 · …і ще 2 дн.');
    });

    it('groups times by day with the weekday', () => {
        expect(formatFreshSlots(['2027-03-31 11:40', '2027-03-31 09:50', '2027-04-01 10:00'])).toBe('ср 31.03 09:50, 11:40 · чт 01.04 10:00');
    });
});

describe('freshBadge', () => {
    it('declines the word', () => {
        expect([1, 2, 5, 11, 22].map(freshBadge)).toEqual(['1 новий', '2 нові', '5 нових', '11 нових', '22 нові']);
    });
});

describe('draftBanner', () => {
    const ext = (patch: Partial<Parameters<typeof draftBanner>[0]> = {}): Parameters<typeof draftBanner>[0] => ({
        connected: true,
        auth: { loggedIn: true, exp: NOW + 5 * 3600_000, reason: null },
        draft: { url: 'u', savedAt: NOW - 3600_000, expiresAt: NOW + 3600_000 },
        draftJob: null,
        ...patch,
    });
    it('is hidden without the extension, while logged out (the session banner speaks) and with a good draft', () => {
        expect(draftBanner(ext({ connected: false }), true, NOW)).toBeNull();
        expect(draftBanner(ext({ auth: { loggedIn: false, exp: null, reason: null }, draft: null }), true, NOW)).toBeNull();
        expect(draftBanner(ext(), true, NOW)).toBeNull();
    });
    it('warns about a missing draft only while monitoring runs', () => {
        expect(draftBanner(ext({ draft: null }), true, NOW)).toEqual({ kind: 'missing' });
        expect(draftBanner(ext({ draft: null }), false, NOW)).toBeNull();
    });
    it('warns about an expired draft: by expiresAt, or 24 h after saving when the extension gave none', () => {
        expect(draftBanner(ext({ draft: { url: 'u', savedAt: NOW - 1, expiresAt: NOW } }), true, NOW)).toEqual({ kind: 'expired', at: NOW });
        const pasted = { url: 'u', savedAt: NOW - 24 * 3600_000 };
        expect(draftBanner(ext({ draft: pasted }), true, NOW)).toEqual({ kind: 'expired', at: NOW });
        expect(draftBanner(ext({ draft: { url: 'u', savedAt: NOW - 24 * 3600_000 + 1 } }), true, NOW)).toBeNull();
    });
    it('shows the creation and its failure even when monitoring is stopped', () => {
        expect(draftBanner(ext({ draft: null, draftJob: { status: 'running', text: null } }), false, NOW)).toEqual({ kind: 'creating' });
        expect(draftBanner(ext({ draft: null, draftJob: { status: 'failed', text: 'причина' } }), false, NOW)).toEqual({ kind: 'failed', text: 'причина' });
    });
});

describe('alarmActive', () => {
    it('is on from the reminder until 3 minutes after the opening', () => {
        expect(alarmActive(null, NOW)).toBe(false);
        expect(alarmActive({ at: NOW + 5 * 60_000 }, NOW)).toBe(true);
        expect(alarmActive({ at: NOW - 2 * 60_000 }, NOW)).toBe(true);
        expect(alarmActive({ at: NOW - 3 * 60_000 }, NOW)).toBe(false);
    });
});
