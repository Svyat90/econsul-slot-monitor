// LocationsSource: server/data/locations.json, served by the same origin at /api/locations.
import type { LocationsSource } from '@/application/ports.ts';
import { locationsSchema } from '@/domain/contracts/locations.ts';

export function createLocationsSource(fetchFn: typeof fetch = (...args) => fetch(...args)): LocationsSource {
    return {
        async load() {
            // the reference list from the server (server/data/locations.json)
            const response = await fetchFn('/api/locations');
            if (!response.ok) throw new Error(`locations.json: HTTP ${response.status}`);
            return locationsSchema.parse(await response.json());
        },
    };
}
