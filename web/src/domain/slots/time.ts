// Dates are 'YYYY-MM-DD' strings; times come from ISO strings WITHOUT timezone conversion.

export type DateKey = string;

// Map Ukrainian day names to JS day numbers (0=Sunday, 1=Monday, etc.)
export const ukrainianDayMap: Readonly<Record<string, number>> = {
  понеділок: 1, // Monday
  вівторок: 2, // Tuesday
  середа: 3, // Wednesday
  четвер: 4, // Thursday
  "п'ятниця": 5, // Friday
  субота: 6, // Saturday
  неділя: 0, // Sunday
};

export function addDays(dateKey: DateKey, days: number): DateKey {
  const d = new Date(dateKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(dateKey: DateKey): number {
  return new Date(dateKey + 'T12:00:00Z').getUTCDay();
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Parse time from ISO string WITHOUT timezone conversion
// This extracts hours:minutes directly from the string to avoid DST issues
export function parseTimeFromISO(isoString: string): {
  hours: number;
  minutes: number;
  totalMinutes: number;
} {
  // Format: "2026-03-10T10:20:00.00-06:00"
  // Extract the time part directly (characters 11-16 are HH:MM)
  const timePart = isoString.substring(11, 16);
  const [hours = 0, minutes = 0] = timePart.split(':').map(Number);
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

// Parse date from ISO string (YYYY-MM-DD)
export function parseDateFromISO(isoString: string): DateKey {
  return isoString.substring(0, 10);
}

// Date key of a moment at a fixed UTC offset; stands in for the browser's local date
// (getDateKey(new Date(ms)) in slots.html) in tests and the fake clock
export function utcOffsetDateKey(offsetMinutes: number): (ms: number) => DateKey {
  return (ms) => new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 10);
}

// UTC offset of the consulate ("-05:00"): the institution's timeZone (as the site uses it),
// otherwise the offset written in the ISO strings the API returns
export function consulateOffset(
  timeZone: string | undefined,
  sampleIsos: readonly string[],
  browserOffsetMinutes: number,
): string {
  if (timeZone && /^GMT[+-]\d\d:\d\d$/.test(timeZone)) return timeZone.slice(3);
  const iso = sampleIsos.find(Boolean);
  const match = iso && iso.match(/([+-]\d\d:\d\d)$/);
  if (match?.[1]) return match[1];
  return (browserOffsetMinutes < 0 ? '-' : '+') + minutesToTime(Math.abs(browserOffsetMinutes));
}
