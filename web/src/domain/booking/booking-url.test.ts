import { BOOKING_URL, bookingUrl } from './booking-url.ts';

describe('bookingUrl', () => {
    it('opens a valid draft', () => {
        const draft = 'https://e-consul.gov.ua/tasks/68f0c3a1/consularServiceInfo';
        expect(bookingUrl(draft)).toBe(draft);
    });

    it.each([null, '', 'https://e-consul.gov.ua/tasks/create/161374/161374001', 'https://e-consul.gov.ua/tasks/my-tasks', 'https://evil.example/tasks/1'])(
        'opens a new application for %s',
        (url) => expect(bookingUrl(url)).toBe(BOOKING_URL),
    );
});
