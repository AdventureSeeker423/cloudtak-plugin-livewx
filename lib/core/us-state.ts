/**
 * Resolve the US state under the map (or a point) for state-scoped feeds.
 */
import { fetchJson, roundCoord, TtlCache } from './egress.ts';
import { mapOf } from './map-host.ts';

const cache = new TtlCache<string>(7 * 24 * 60 * 60_000);

function pathGet(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

/** NWS two-letter state for lat/lon (CONUS/AK/HI/PR/etc.). */
export async function usStateAt(lat: number, lon: number): Promise<string> {
    const key = `${roundCoord(lat)}|${roundCoord(lon)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const body = await fetchJson(`https://api.weather.gov/points/${roundCoord(lat)},${roundCoord(lon)}`);
    const st = pathGet(body, 'properties.relativeLocation.properties.state');
    if (typeof st !== 'string' || !/^[A-Z]{2}$/i.test(st)) {
        throw new Error('No US state for this map area');
    }
    const up = st.toUpperCase();
    cache.set(key, up);
    return up;
}

/** State under the map center, or null when the map is unavailable. */
export async function usStateAtMapCenter(): Promise<string | null> {
    const map = mapOf();
    if (!map?.getCenter) return null;
    const c = map.getCenter();
    if (!c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return null;
    return usStateAt(c.lat, c.lng);
}
