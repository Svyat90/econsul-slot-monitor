// LocationsSource: the bundled locations.json, served by the same origin.
import type { LocationsSource } from '@/application/ports.ts';
import { locationsSchema } from '@/domain/contracts/locations.ts';

export function createLocationsSource(fetchFn: typeof fetch = (...args) => fetch(...args)): LocationsSource {
    return {
        async load() {
            // absolute path: locations.json is served at the server root
            const response = await fetchFn('/locations.json');
            if (!response.ok) throw new Error(`locations.json: HTTP ${response.status}`);
            return locationsSchema.parse(await response.json());
        },
    };
}
