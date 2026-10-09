import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import type { Locations } from '@/domain/contracts/locations.ts';
import { SettingsView } from './SettingsView.tsx';
import { createFakeServices } from '@/test/fake-services.tsx';

const NOW = Date.UTC(2026, 9, 9, 12);
const DRAFT = 'https://e-consul.gov.ua/tasks/abc/consularServiceInfo';
const SECRET = 'eyJ-secret-token';

const chicago = { code: 'chi', name: 'Чикаго', countryCode: 'us', country: 'США', timeZone: 'GMT-06:00', numberWeeks: 25, serviceMinutes: { '1': 10, '2': 15 } };
const houston = { code: 'hou', name: 'Г\'юстон', countryCode: 'us', country: 'США', timeZone: 'GMT-06:00', numberWeeks: 25, serviceMinutes: { '2': 15 } };
const warsaw = { code: 'war', name: 'Варшава', countryCode: 'pl', country: 'Польща', timeZone: 'GMT+01:00', numberWeeks: 20, serviceMinutes: { '1': 10 } };
const locations: Locations = {
    holidays: { all: ['2026-12-25'], byService: {} },
    services: { '1': 'Закордонний паспорт', '2': 'Нотаріальні дії' },
    institutions: [chicago, houston, warsaw],
};

function setup(options: Parameters<typeof createFakeServices>[0] = {}) {
    const fake = createFakeServices({
        now: NOW,
        ...options,
        monitor: { locations, selection: { institution: chicago, serviceCode: '1' }, tabTitleMarks: true, ...options.monitor },
    });
    // S6.T1 methods that the shared fake does not have yet
    Object.assign(fake.monitor, {
        setTabTitleMarks: vi.fn(),
        notificationPermission: vi.fn(() => 'default'),
        requestNotifications: vi.fn(async () => 'granted'),
        audioReady: vi.fn(() => false),
        testAlert: vi.fn(async () => {}),
    });
    Object.assign(fake.extensionLink, { setDraftUrl: vi.fn() });
    render(<SettingsView />, { wrapper: fake.wrapper });
    return { fake, user: userEvent.setup(), monitor: fake.monitor as typeof fake.monitor & Record<string, ReturnType<typeof vi.fn>>, link: fake.extensionLink as typeof fake.extensionLink & { setDraftUrl: ReturnType<typeof vi.fn> } };
}

describe('SettingsView', () => {
    it('shows the selection and the parameter line', () => {
        setup();
        expect(screen.getByLabelText('Країна')).toHaveValue('us');
        expect(screen.getByLabelText('Консульська установа')).toHaveValue('chi');
        expect(screen.getByLabelText('Послуга')).toHaveValue('1');
        expect(screen.getByText(/код chi · GMT-06:00 · слот 10 хв · горизонт 25 тижнів · свята: 25.12/)).toBeInTheDocument();
    });

    it('changes the institution and keeps the service when the new one has it', async () => {
        const { user, monitor } = setup({ monitor: { selection: { institution: chicago, serviceCode: '2' } } });
        await user.selectOptions(screen.getByLabelText('Консульська установа'), 'hou');
        expect(monitor.setSelection).toHaveBeenCalledWith('hou', '2');
    });

    it('picks the first institution and service of another country', async () => {
        const { user, monitor } = setup();
        await user.selectOptions(screen.getByLabelText('Країна'), 'pl');
        expect(monitor.setSelection).toHaveBeenCalledWith('war', '1');
    });

    it('changes the service', async () => {
        const { user, monitor } = setup();
        await user.selectOptions(screen.getByLabelText('Послуга'), '2');
        expect(monitor.setSelection).toHaveBeenCalledWith('chi', '2');
    });

    it('keeps the interval at 10 seconds or more', async () => {
        const { user, monitor } = setup();
        const min = screen.getByLabelText('Кожні, від');
        await user.clear(min);
        await user.type(min, '5');
        await user.tab();
        expect(monitor.setInterval).toHaveBeenLastCalledWith({ min: 10, max: 180 });
    });

    it('sets and clears the date range', async () => {
        const { user, monitor } = setup({ monitor: { dateRange: { from: '2027-03-15', to: '2027-04-01' } } });
        fireDate(screen.getByLabelText('Дати слотів: не раніше'), '2027-03-20');
        expect(monitor.setDateRange).toHaveBeenLastCalledWith({ from: '2027-03-20', to: '2027-04-01' });
        await user.click(screen.getByRole('button', { name: 'Очистити' }));
        expect(monitor.setDateRange).toHaveBeenLastCalledWith({ from: null, to: null });
    });

    it('takes the token by hand without echoing it', async () => {
        const { user, monitor } = setup();
        await user.click(screen.getByRole('button', { name: 'Ввести вручну' }));
        const input = screen.getByLabelText('Токен сесії');
        expect(input).toHaveAttribute('type', 'password');
        await user.type(input, SECRET);
        await user.click(screen.getByRole('button', { name: 'Зберегти токен' }));
        expect(monitor.setToken).toHaveBeenCalledWith(SECRET, 'manual');
        expect(document.body).not.toHaveTextContent(SECRET);
        expect(screen.queryByLabelText('Токен сесії')).not.toBeInTheDocument();
    });

    it('shows how long the token lives', () => {
        setup({ extension: { connected: true, auth: { loggedIn: true, exp: NOW + (21 * 60 + 14) * 60000, reason: null } } });
        expect(screen.getByText(/токен ще 21 год 14 хв/)).toBeInTheDocument();
    });

    it('saves the draft link when the field loses focus', async () => {
        const { user, link } = setup();
        await user.type(screen.getByLabelText('Чернетка заявки'), DRAFT);
        await user.tab();
        expect(link.setDraftUrl).toHaveBeenCalledWith(DRAFT);
    });

    it('explains a link that is not a draft', async () => {
        const { user } = setup();
        await user.type(screen.getByLabelText('Чернетка заявки'), 'https://example.com/x');
        expect(screen.getByText(/Це не посилання на чернетку/)).toBeInTheDocument();
    });

    it('disables auto-booking without the extension and switches it with one', async () => {
        const first = setup();
        expect(first.link.setAutoBook).not.toHaveBeenCalled();
        expect(screen.getByRole('checkbox', { name: /Бронювати автоматично/ })).toBeDisabled();
    });

    it('switches auto-booking when the extension is connected', async () => {
        const { user, link } = setup({ extension: { connected: true } });
        await user.click(screen.getByRole('checkbox', { name: /Бронювати автоматично/ }));
        expect(link.setAutoBook).toHaveBeenCalledWith(true);
    });

    it('runs the test alerts and the tab mark switch', async () => {
        const { user, monitor, link } = setup({ extension: { connected: true } });
        await user.click(screen.getByRole('button', { name: 'Сигнал нових слотів' }));
        expect(monitor.testAlert).toHaveBeenCalledWith('slots');
        await user.click(screen.getByRole('button', { name: 'Сигнал «сесія скінчилась»' }));
        expect(monitor.testAlert).toHaveBeenCalledWith('session');
        await user.click(screen.getByRole('button', { name: 'Вимкнути звук розширення' }));
        expect(link.testSound).toHaveBeenCalledWith('mute');
        await user.click(screen.getByRole('checkbox', { name: /Позначати заголовок вкладки/ }));
        expect(monitor.setTabTitleMarks).toHaveBeenCalledWith(false);
        expect(screen.getByText('Тестові слоти розширення ніколи не бронює.')).toBeInTheDocument();
    });
});

function fireDate(input: HTMLElement, value: string) {
    // date inputs ignore typing in jsdom: set the value the way the browser does
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
