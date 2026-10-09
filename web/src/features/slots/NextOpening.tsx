import styles from './NextOpening.module.css';
import { buildReleasesView } from './model/releases-view.ts';
import { consulateOffset } from '@/domain/slots/time.ts';
import { useAppServices, useMonitorState, useNowSeconds } from '@/hooks/use-app-services.ts';

const DEFAULT_SLOT_MINUTES = 10;

export function NextOpening() {
    const { clock } = useAppServices();
    const state = useMonitorState();
    const nowMs = useNowSeconds() * 1000;
    const institution = state.selection?.institution;
    const serviceCode = state.selection?.serviceCode ?? '';
    const browserOffsetMinutes = clock.browserOffsetMinutes(nowMs);
    const view = buildReleasesView({
        releases: state.releases,
        nowMs,
        browserOffsetMinutes,
        consulateOffset: consulateOffset(institution?.timeZone, [], browserOffsetMinutes),
        slotMinutes: institution?.serviceMinutes[serviceCode] || DEFAULT_SLOT_MINUTES,
    });

    return (
        <section className={styles.card} aria-labelledby="next-opening-title">
            <h2 id="next-opening-title" className={styles.title}>
                Наступне відкриття
            </h2>
            {view ? (
                <>
                    <div className={styles.head}>
                        <span className={styles.moment}>{view.moment}</span>
                        <span className={styles.consulate}>{view.consulate}</span>
                    </div>
                    <p className={styles.line}>
                        Відкриється <b>{view.opens}</b> · {view.slotsText}
                    </p>
                    <div className={styles.chips}>
                        <span className={styles.countdown}>{view.countdown}</span>
                        <span className={view.active ? `${styles.fast} ${styles.fastActive}` : styles.fast}>{view.fastWindow}</span>
                    </div>
                    {view.later.length > 0 && <p className={styles.later}>Далі: {view.later.join(' · ')}</p>}
                </>
            ) : (
                <p className={styles.empty}>
                    {state.schedule === null
                        ? 'Розклад ще не завантажено: запустіть моніторинг або перевірку, щоб порахувати відкриття нових днів.'
                        : 'Найближчі 8 днів нові дні не відкриваються.'}
                </p>
            )}
        </section>
    );
}
