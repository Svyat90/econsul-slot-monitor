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
