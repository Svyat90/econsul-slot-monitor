import { Section } from './Section.tsx';
import styles from './SettingsView.module.css';
import { dateRangeHint } from './model/hints.ts';
import { countryOptions, institutionOptions, locationParams, serviceOptions } from './model/location-options.ts';
import { useMonitor, useMonitorState } from '@/hooks/use-app-services.ts';

function Select({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
    return (
        <label className={styles.field}>
            <span className={styles.label}>{label}</span>
            <select className={styles.control} value={value} onChange={(event) => onChange(event.target.value)}>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
        </label>
    );
}

export function SearchSection() {
    const monitor = useMonitor();
    const { locations, selection, dateRange, free } = useMonitorState();
    if (!locations) return <Section title="Що шукаємо">Завантаження довідника…</Section>;

    const institution = selection?.institution;
    const serviceCode = selection?.serviceCode ?? '';
    const hint = dateRangeHint(dateRange, free?.keys ?? []);

    // A new service of the new institution: keep the current one when it exists there
    const select = (code: string) => {
        const next = locations.institutions.find((i) => i.code === code);
        if (!next) return;
        const codes = serviceOptions(locations, next);
        const keep = codes.some((option) => option.value === serviceCode);
        const service = keep ? serviceCode : codes[0]?.value;
        if (service) monitor.setSelection(next.code, service);
    };
    const changeCountry = (countryCode: string) => {
        const first = institutionOptions(locations, countryCode)[0];
        if (first) select(first.value);
    };

    return (
        <Section title="Що шукаємо">
            <Select label="Країна" value={institution?.countryCode ?? ''} options={countryOptions(locations)} onChange={changeCountry} />
            <Select
                label="Консульська установа"
                value={institution?.code ?? ''}
                options={institution ? institutionOptions(locations, institution.countryCode) : []}
                onChange={select}
            />
            <Select
                label="Послуга"
                value={serviceCode}
                options={serviceOptions(locations, institution)}
                onChange={(service) => institution && monitor.setSelection(institution.code, service)}
            />
            {institution && <div className={styles.params}>{locationParams(locations, institution, serviceCode)}</div>}
            <div className={styles.dates}>
                <label className={styles.field}>
                    <span className={styles.label}>Не раніше</span>
                    <input
                        type="date"
                        className={styles.control}
                        value={dateRange.from ?? ''}
                        onChange={(event) => monitor.setDateRange({ ...dateRange, from: event.target.value || null })}
                    />
                </label>
                <label className={styles.field}>
                    <span className={styles.label}>Не пізніше</span>
                    <input
                        type="date"
                        className={styles.control}
                        value={dateRange.to ?? ''}
                        onChange={(event) => monitor.setDateRange({ ...dateRange, to: event.target.value || null })}
                    />
                </label>
                <button type="button" className={styles.button} onClick={() => monitor.setDateRange({ from: null, to: null })}>
                    Очистити
                </button>
            </div>
            <div className={hint.tone === 'error' ? styles.hintError : styles.hint}>{hint.text}</div>
            <div className={styles.hint}>Діапазон фільтрує сповіщення, «нові» в журналі й слоти для розширення. Календар показує всі.</div>
        </Section>
    );
}
