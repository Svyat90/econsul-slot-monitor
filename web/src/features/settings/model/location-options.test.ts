import type { Locations } from '@/domain/contracts/locations.ts';
import { countryOptions, institutionOptions, locationParams, serviceOptions } from './location-options.ts';

const inst = (code: string, name: string, countryCode: string, country: string, serviceMinutes: Record<string, number> = {}) => ({
    code, name, countryCode, country, timeZone: 'GMT-06:00', numberWeeks: 25, serviceMinutes,
});
const chicago = inst('b', 'Чикаго', 'us', 'США', { '2': 15, '1': 10 });
const locations: Locations = {
    holidays: { all: ['2026-12-25'], byService: { '1': ['2026-11-21..2026-11-27'] } },
    services: { '1': 'Оформлення закордонного паспорта', '2': 'Нотаріальні дії' },
    institutions: [
        chicago,
        inst('a', 'Г\'юстон', 'us', 'США'),
        inst('c', 'Варшава', 'pl', 'Польща'),
    ],
};

describe('location options', () => {
    it('sorts countries and institutions in Ukrainian order', () => {
        expect(countryOptions(locations).map((o) => o.label)).toEqual(['Польща', 'США']);
        expect(institutionOptions(locations, 'us').map((o) => o.value)).toEqual(['a', 'b']);
    });

    it('lists the services of an institution by code with minutes', () => {
        expect(serviceOptions(locations, chicago).map((o) => o.label)).toEqual([
            'Оформлення закордонного паспорта (10 хв)',
            'Нотаріальні дії (15 хв)',
        ]);
        expect(serviceOptions(locations, undefined)).toEqual([]);
    });

    it('builds the parameter line with the holidays of the service', () => {
        expect(locationParams(locations, chicago, '1')).toBe(
            'код b · GMT-06:00 · слот 10 хв · горизонт 25 тижнів · свята: 25.12, 21.11–27.11',
        );
        expect(locationParams(locations, chicago, '2')).toContain('слот 15 хв');
    });
});
