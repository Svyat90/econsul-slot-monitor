import { useMemo, useState } from 'react';
import { Calendar } from './Calendar.tsx';
import { DayPanel } from './DayPanel.tsx';
import { NearestFree } from './NearestFree.tsx';
import { NextOpening } from './NextOpening.tsx';
import { buildDayModels, draftHint, recentForDay } from './model/day-tiles.ts';
import { buildMonthGrid, defaultDay, lastOpenDay, shiftMonth, summaryText } from './model/month-grid.ts';
import styles from './SlotsView.module.css';
import { useAppServices, useExtensionState, useMonitorState } from '@/hooks/use-app-services.ts';
import { useStoredCalendar } from '@/hooks/use-calendar.ts';
import { useReservations } from '@/hooks/use-reservations.ts';

// '09:40', or '15.10 09:40' when it was not today
function formatChecked(ms: number, otherDay: number | null): string {
    const date = new Date(ms);
    const time = date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    if (otherDay === null) return time;
    return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')} ${time}`;
}

export function SlotsView() {
    const { clock, openBooking } = useAppServices();
    const state = useMonitorState();
    const { draft } = useExtensionState();
    const { data: reservations } = useReservations();
    const { data: stored } = useStoredCalendar();
    const { selection, schedule, locations, reserved, dateRange } = state;
    const nowMs = clock.now();
    const nowMinute = Math.floor(nowMs / 60_000);

    // The monitor's own data once it has checked (schedule and reserved slots); before that the
    // calendar the server saved. The schedule alone is not enough: without the reserved slots
    // every slot would look free
    const fromStore = !(schedule && reserved !== null) && stored != null;
    const calendar = useMemo(() => {
        if (schedule && reserved !== null) return { rows: schedule.rows, reserved };
        return stored ? { rows: stored.rows, reserved: stored.reserved } : null;
    }, [schedule, reserved, stored]);

    const models = useMemo(() => {
        if (!selection || !calendar || !locations) return null;
        return buildDayModels({
            rows: calendar.rows,
            reserved: calendar.reserved,
            serviceCode: selection.serviceCode,
            institution: selection.institution,
            holidays: locations.holidays,
            nowMs: nowMinute * 60_000,
            localDateKey: (ms) => clock.localDateKey(ms),
            browserOffsetMinutes: clock.browserOffsetMinutes(nowMinute * 60_000),
        });
    }, [selection, calendar, locations, nowMinute, clock]);

    const [picked, setPicked] = useState<string | null>(null);
    const [shown, setShown] = useState<{ year: number; month: number } | null>(null);
    // Opens on the newest open day: that is where new days appear, not the current month
    const newest = models ? lastOpenDay(models) : null;
    const fallbackDay = models ? defaultDay(models, dateRange) : null;
    const selectedDay = picked && models?.byDate[picked] ? picked : (newest ?? fallbackDay);
    const today = clock.localDateKey(nowMs);
    const month = shown ?? { year: Number((selectedDay ?? today).slice(0, 4)), month: Number((selectedDay ?? today).slice(5, 7)) };
    const subtitle = selection ? `${selection.institution.name} · ${locations?.services[selection.serviceCode] ?? selection.serviceCode}` : '';

    return (
        <div className={styles.page}>
            <h1 className={styles.heading}>
                Слоти {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
            </h1>
            <div className={styles.top}>
                <NextOpening />
                <NearestFree storedFreeKeys={fromStore && models ? models.freeKeys : undefined} />
            </div>
            {fromStore && stored && models && (
                <p className={styles.stored} role="status">
                    Показано останній збережений стан: перевірка о {formatChecked(stored.checkedAt, clock.localDateKey(stored.checkedAt) === today ? null : stored.checkedAt)}. Запустіть
                    моніторинг, щоб оновити.
                </p>
            )}
            {models ? (
                <div className={styles.main}>
                    <Calendar
                        grid={buildMonthGrid({ ...month, models, today, range: dateRange })}
                        selected={selectedDay}
                        summary={summaryText({ models, range: dateRange, reservedCount: calendar?.reserved.length ?? 0 })}
                        onSelect={(dateKey) => setPicked(dateKey)}
                        onPrevious={() => setShown(shiftMonth(month.year, month.month, -1))}
                        onNext={() => setShown(shiftMonth(month.year, month.month, 1))}
                    />
                    <DayPanel
                        day={selectedDay ? (models.byDate[selectedDay] ?? null) : null}
                        recent={selectedDay ? recentForDay(reservations ?? [], selectedDay, nowMs) : []}
                        draftHint={draftHint(draft, nowMs)}
                        onOpenBooking={openBooking}
                    />
                </div>
            ) : (
                <p className={styles.empty}>
                    {schedule ? 'Зайняті слоти ще не перевірені: запустіть моніторинг.' : 'Розклад ще не завантажено.'}
                </p>
            )}
        </div>
    );
}
