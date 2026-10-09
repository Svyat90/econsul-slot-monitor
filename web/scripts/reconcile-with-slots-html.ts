// Stage 3 of docs/plans/web-rewrite-plan.md: the new domain must give the same calendar days, free
// slots and day-opening moments as slots.html on the same recorded responses and the same moment.
//
// Opens slots.html (served at /old) from the running server in a separate headless Chrome (puppeteer-core, the
// installed Google Chrome, a fresh profile without the extension), feeds it each fixture of
// src/domain/__fixtures__/econsul/ with Date.now pinned, and compares with the domain functions.
// No request goes to e-Consul: the page only gets data we hand it.
//
//   pnpm run reconcile [http://localhost:3000]
import { readFile, readdir } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { reservedResponseSchema, scheduleResponseSchema } from '../src/domain/contracts/econsul.ts';
import { locationsSchema } from '../src/domain/contracts/locations.ts';
import { upcomingReleases } from '../src/domain/monitoring/releases.ts';
import { calculateFreeSlots, collectNonWorking } from '../src/domain/slots/free-slots.ts';
import { buildScheduleDays, holidaySet, type ScheduleInput } from '../src/domain/slots/schedule-days.ts';
import { consulateOffset, type DateKey } from '../src/domain/slots/time.ts';

const BASE_URL = process.argv[2] ?? 'http://localhost:3000';
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FIXTURES = new URL('../src/domain/__fixtures__/econsul/', import.meta.url);
const SERVICE_CODE = '1';
const HOUR = 3600_000;

// slots.html takes "today" from the browser's time zone; Chrome and this script run on the same machine
const localDateKey = (ms: number): DateKey => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface Fixture { recordedAtMs: number; institutionCode: string; schedule: unknown; reserved: unknown }

const locations = locationsSchema.parse(JSON.parse(await readFile(new URL('../../server/data/locations.json', import.meta.url), 'utf8')));
const files = (await readdir(FIXTURES)).filter((name) => name.endsWith('.json')).sort();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
let failures = 0;
try {
    const page = await browser.newPage();
    await page.goto(BASE_URL + '/old', { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.querySelectorAll('#countrySelect option').length > 0);

    for (const file of files) {
        const fixture = JSON.parse(await readFile(new URL(file, FIXTURES), 'utf8')) as Fixture;
        const inst = locations.institutions.find((i) => i.code === fixture.institutionCode);
        if (!inst) throw new Error(`${file}: institution ${fixture.institutionCode} is not in locations.json`);
        const rows = scheduleResponseSchema.parse(fixture.schedule).data.map((entry) => entry.data).filter((row) => row != null);
        const recordedReserved = reservedResponseSchema.parse(fixture.reserved).data.reservedSlots;
        const nonWorking = collectNonWorking(rows, SERVICE_CODE);

        // The recorded consuls are fully booked (0 free slots), so the same responses are also
        // compared with every other reserved slot dropped and with none reserved
        const variants = {
            recorded: recordedReserved,
            half: recordedReserved.filter((_, i) => i % 2 === 0),
            none: [],
        };
        // The recording moment, then moments that move the horizon across opening times
        const moments = [0, 3, 6, 20, 26, 50].map((h) => fixture.recordedAtMs + h * HOUR);

        for (const [variant, reserved] of Object.entries(variants)) for (const nowMs of moments) {
            const reservedResponse = { ...(fixture.reserved as object), data: { ...(fixture.reserved as { data: object }).data, reservedSlots: reserved } };
            const input: ScheduleInput = {
                rows,
                serviceCode: SERVICE_CODE,
                numberWeeks: inst.numberWeeks,
                offset: consulateOffset(inst.timeZone, [nonWorking[0]?.from, reserved[0]?.receptionDateAndTimeFrom].filter((s): s is string => !!s), -new Date(nowMs).getTimezoneOffset()),
                holidays: holidaySet(locations.holidays, SERVICE_CODE),
                localDateKey,
            };
            const days = buildScheduleDays(input, nowMs);
            const free = calculateFreeSlots({ days, nonWorking, reserved, slotMinutes: inst.serviceMinutes[SERVICE_CODE] ?? 10 });
            const releases = upcomingReleases(input, nowMs);
            const ours = { days, byDate: free.byDate, slotConsuls: free.slotConsuls, keys: free.keys, releases };

            const theirs = await page.evaluate((f, nowMs, serviceCode, reservedResponse) => {
                // Everything below is slots.html's own code and globals
                const w = window as unknown as Record<string, any>;
                Date.now = () => nowMs;
                const inst = w.eval('locations').institutions.find((i: { code: string }) => i.code === f.institutionCode);
                w.eval('fillCountries')(inst.countryCode);
                w.eval('fillInstitutions')(inst.code);
                w.eval('fillServices')(serviceCode);
                w.eval('processNonworkingData')(f.schedule);
                w.eval('processSlotsData')(reservedResponse, { keepView: true });
                w.eval('calculateBookableWindows')();
                w.eval('releaseCache = null');
                return {
                    days: w.eval('buildScheduleDays')(nowMs),
                    byDate: w.eval('bookableWindowsByDate'),
                    slotConsuls: w.eval('freeSlotConsuls'),
                    keys: w.eval('getFreeSlotKeys')(),
                    releases: w.eval('getUpcomingReleases')(),
                };
            }, fixture as never, nowMs, SERVICE_CODE, reservedResponse as never);

            const label = `${file} [reserved: ${variant}] @ ${new Date(nowMs).toISOString()}`;
            const diffs = (Object.keys(ours) as (keyof typeof ours)[])
                .filter((key) => JSON.stringify(ours[key]) !== JSON.stringify(theirs[key]));
            if (diffs.length) {
                failures++;
                console.error(`✗ ${label}: differs in ${diffs.join(', ')}`);
                for (const key of diffs) {
                    console.error(`  ${key}: new ${JSON.stringify(ours[key]).slice(0, 300)}`);
                    console.error(`  ${key}: old ${JSON.stringify(theirs[key]).slice(0, 300)}`);
                }
            } else {
                console.log(`✓ ${label}: ${days.length} days, ${free.keys.length} free slots, ${releases.length} openings`);
            }
        }
    }
} finally {
    await browser.close();
}
if (failures) {
    console.error(`${failures} mismatch(es)`);
    process.exit(1);
}
console.log('slots.html and the new domain agree');
