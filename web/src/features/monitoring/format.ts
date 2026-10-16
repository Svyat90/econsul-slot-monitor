// Display helpers of the Monitoring page: Ukrainian wording as in the design.
export function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatClock(iso: string): string {
    return new Date(iso).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
}

// "dd.mm" of a slot date (YYYY-MM-DD)
export function formatSlotDate(date: string): string {
    const [year, month, day] = date.split('-');
    return `${day}.${month}.${year}`;
}

export function formatDateTime(iso: string): string {
    const date = new Date(iso);
    return `${date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit' })} ${formatClock(iso)}`;
}

// "07.04 09:00" of a stored slot instant (the server returns UTC) shown as the consulate's wall
// time, the way the site shows it; offset is "+03:00" / "-05:00"
export function slotLabelAt(slotFrom: string, offset: string): string {
    const sign = offset.startsWith('-') ? -1 : 1;
    const [hours = 0, minutes = 0] = offset.slice(1).split(':').map(Number);
    const shifted = new Date(new Date(slotFrom).getTime() + sign * (hours * 60 + minutes) * 60_000);
    return slotLabel(shifted.toISOString());
}

// The offset-carrying slot time as e-Consul wrote it: "2027-03-31T09:30:00+03:00" → date and time
export function slotLabel(slotFrom: string): string {
    const [date = '', rest = ''] = slotFrom.split('T');
    const [, month = '', day = ''] = date.split('-');
    return `${day}.${month} ${rest.slice(0, 5)}`;
}

export function plural(count: number, one: string, few: string, many: string): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

// "ср, 31.03.2027 о 09:50" of an offset-carrying slot time, read as written (no time zone shift)
export function slotWhen(slotFrom: string): string {
    const [date = '', rest = ''] = slotFrom.split('T');
    const weekday = new Date(`${date}T12:00:00Z`).toLocaleDateString('uk-UA', { weekday: 'short', timeZone: 'UTC' });
    return `${weekday}, ${formatSlotDate(date)} о ${rest.slice(0, 5)}`;
}

// "31.03 09:50" of a new slot (date YYYY-MM-DD, time HH:MM)
export function shortSlot(date: string, time: string): string {
    const [, month = '', day = ''] = date.split('-');
    return `${day}.${month} ${time}`;
}

// "1,9 с" of a duration in milliseconds
export function formatDuration(ms: number): string {
    return `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
}

// Day heading of the journal: "Сьогодні · 14.10.2026", "Вчора · 13.10.2026", otherwise the date
export function dayHeading(iso: string, nowMs: number): string {
    const date = new Date(iso);
    const key = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((key(new Date(nowMs)) - key(date)) / 86_400_000);
    const text = date.toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return days === 0 ? `Сьогодні · ${text}` : days === 1 ? `Вчора · ${text}` : text;
}

// Which local day an instant belongs to, for grouping
export function dayKey(iso: string): string {
    const date = new Date(iso);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
