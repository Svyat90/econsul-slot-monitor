// Option lists and the parameter line of the "Що шукаємо" section (slots.html fillCountries(),
// fillInstitutions(), fillServices(), renderLocationParams()). Pure: the locations come in.
import type { Institution, Locations } from '@/domain/contracts/locations.ts';

export type Option = { value: string; label: string };

const DEFAULT_SLOT_MINUTES = 10;
const DEFAULT_NUMBER_WEEKS = 25;

const byName = (a: string, b: string) => a.localeCompare(b, 'uk');

export function countryOptions(locations: Locations): Option[] {
    const countries = [...new Map(locations.institutions.map((i) => [i.countryCode, i.country])).entries()];
    return countries.sort((a, b) => byName(a[1], b[1])).map(([value, label]) => ({ value, label }));
}

export function institutionOptions(locations: Locations, countryCode: string): Option[] {
    return locations.institutions
        .filter((i) => i.countryCode === countryCode)
        .sort((a, b) => byName(a.name, b.name))
        .map((i) => ({ value: i.code, label: i.name }));
}

export function serviceOptions(locations: Locations, institution: Institution | undefined): Option[] {
    if (!institution) return [];
    return Object.keys(institution.serviceMinutes)
        .sort((a, b) => Number(a) - Number(b))
        .map((code) => ({ value: code, label: `${locations.services[code] || code} (${institution.serviceMinutes[code]} хв)` }));
}

// '2026-11-21..2026-11-27' -> '21.11–27.11', '2026-12-25' -> '25.12'
function holidayLabel(spec: string): string {
    const short = (date = '') => date.slice(5).split('-').reverse().join('.');
    const [from, to] = spec.split('..');
    return to ? `${short(from)}–${short(to)}` : short(from);
}

export function locationParams(locations: Locations, institution: Institution, serviceCode: string): string {
    const holidays = [...locations.holidays.all, ...(locations.holidays.byService[serviceCode] || [])];
    const minutes = institution.serviceMinutes[serviceCode] || DEFAULT_SLOT_MINUTES;
    const weeks = institution.numberWeeks || DEFAULT_NUMBER_WEEKS;
    return (
        `код ${institution.code} · ${institution.timeZone} · слот ${minutes} хв · горизонт ${weeks} тижнів` +
        (holidays.length ? ` · свята: ${holidays.map(holidayLabel).join(', ')}` : '')
    );
}
