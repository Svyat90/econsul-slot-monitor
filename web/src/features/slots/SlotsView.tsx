import { useMemo, useState } from 'react';
import { Calendar } from './Calendar.tsx';
import { DayPanel } from './DayPanel.tsx';
import { NearestFree } from './NearestFree.tsx';
import { NextOpening } from './NextOpening.tsx';
import { buildDayModels, draftHint, recentForDay } from './model/day-tiles.ts';
import { buildMonthGrid, defaultDay, shiftMonth, summaryText } from './model/month-grid.ts';
import styles from './SlotsView.module.css';
import { useAppServices, useExtensionState, useMonitorState } from '@/hooks/use-app-services.ts';
import { useReservations } from '@/hooks/use-reservations.ts';

export function SlotsView() {
    const { clock, openBooking } = useAppServices();
    const state = useMonitorState();
    const { draft } = useExtensionState();
    const { data: reservations } = useReservations();
    const { selection, schedule, locations, reserved, dateRange } = state;
    const nowMs = clock.now();
    const nowMinute = Math.floor(nowMs / 60_000);

    const models = useMemo(() => {
        if (!selection || !schedule || !locations) return null;
        return buildDayModels({
            rows: schedule.rows,
            reserved: reserved ?? [],
            serviceCode: selection.serviceCode,
            institution: selection.institution,
            holidays: locations.holidays,
            nowMs: nowMinute * 60_000,
            localDateKey: (ms) => clock.localDateKey(ms),
            browserOffsetMinutes: clock.browserOffsetMinutes(nowMinute * 60_000),
        });
    }, [selection, schedule, locations, reserved, nowMinute, clock]);

    const [picked, setPicked] = useState<string | null>(null);
    const [shown, setShown] = useState<{ year: number; month: number } | null>(null);
    const fallbackDay = models ? defaultDay(models, dateRange) : null;
    const selectedDay = picked && models?.byDate[picked] ? picked : fallbackDay;
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
                <NearestFree />
            </div>
            {models ? (
                <div className={styles.main}>
                    <Calendar
                        grid={buildMonthGrid({ ...month, models, today, range: dateRange })}
                        selected={selectedDay}
                        summary={summaryText({ models, range: dateRange, reservedCount: reserved?.length ?? 0 })}
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
                <p className={styles.empty}>Розклад ще не завантажено.</p>
            )}
        </div>
    );
}
