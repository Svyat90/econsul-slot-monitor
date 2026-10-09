// Records fresh e-Consul responses as test fixtures for web/src/domain (see web/docs/fixtures.md).
//
// Run by hand: open https://e-consul.gov.ua while logged in, open DevTools › Console, paste this
// file and press Enter. It makes exactly the read-only requests the monitor makes — the schedule
// and the reserved slots of each institution below — two seconds apart, and downloads one JSON
// file per institution. It never books anything and never writes the token into the files.

(async () => {
    const API = 'https://my.e-consul.gov.ua/external_reader';
    const SERVICE_CODE = '1'; // «Оформлення закордонного паспорта»
    const INSTITUTIONS = [
        { code: '1000000522', slug: 'chicago' },
        { code: '1000000510', slug: 'houston' },
        { code: '1000000514', slug: 'new-york' },
    ];
    const PAUSE_MS = 2000;

    const token = localStorage.getItem('token');
    if (!token) {
        console.error('[fixtures] No localStorage.token: log in to e-consul.gov.ua first.');
        return;
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // Same request as callExternalReader() in slots.html
    async function callExternalReader(method, filters) {
        const response = await fetch(API, {
            method: 'POST',
            headers: { accept: '*/*', 'content-type': 'application/json', token },
            body: JSON.stringify({ service: 'e-queue-register', method, filters }),
        });
        if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
        return response.json();
    }

    function download(name, value) {
        const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = name;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    for (const institution of INSTITUTIONS) {
        try {
            const recordedAtMs = Date.now();
            const scheduleFilters = { institutionCode: institution.code };
            const schedule = await callExternalReader('public-calendar-get-actual-consuls-schedule', scheduleFilters);

            // Like getServiceConsulHashes(): consuls whose schedule offers the service
            const consulIpnHash = [...new Set((schedule.data || [])
                .map((entry) => entry.data)
                .filter((row) => row && (row.consularInstitutionService || []).some((s) => String(s.code) === SERVICE_CODE))
                .map((row) => row.consulIpnHash))];

            await sleep(PAUSE_MS);
            const reservedFilters = { institutionCode: institution.code, status: [1, 2, 4, 5], consulIpnHash };
            const reserved = consulIpnHash.length
                ? await callExternalReader('public-get-consuls-reserved-slots', reservedFilters)
                : null;

            const date = new Date(recordedAtMs).toISOString().slice(0, 10);
            download(`${institution.slug}-${date}.json`, {
                recordedAt: new Date(recordedAtMs).toISOString(),
                recordedAtMs,
                institutionCode: institution.code,
                serviceCode: SERVICE_CODE,
                requests: {
                    schedule: { method: 'public-calendar-get-actual-consuls-schedule', filters: scheduleFilters },
                    reserved: { method: 'public-get-consuls-reserved-slots', filters: reservedFilters },
                },
                schedule,
                reserved,
            });
            console.info(`[fixtures] ${institution.slug}: ${consulIpnHash.length} consul(s), saved`);
        } catch (error) {
            console.error(`[fixtures] ${institution.slug}:`, error.message);
        }
        await sleep(PAUSE_MS);
    }
    console.info('[fixtures] Done. Move the files to web/src/domain/__fixtures__/econsul/.');
})();
