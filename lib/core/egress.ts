/**
 * Single HTTPS egress path: allowlisted hosts, rounded coords, stale helpers.
 */

export const COORD_DECIMALS = 3;

const DEFAULT_UA = 'CloudTAK-LiveWX/2.0 (weather plugin; +https://github.com/AdventureSeeker423/cloudtak-plugin-livewx)';

/** Hosts the plugin may contact from the browser (or via proxy). */
export const ALLOWED_HOSTS = new Set([
    'api.weather.gov',
    'api.open-meteo.com',
    'mesonet.agron.iastate.edu',
    'mapservices.weather.noaa.gov',
    'opengeo.ncep.noaa.gov',
    'geo.weather.gc.ca',
    'api.rainviewer.com',
    'tilecache.rainviewer.com',
    'nowcoast.noaa.gov',
    'nomads.ncep.noaa.gov',
    'maps.water.noaa.gov',
    'api.water.noaa.gov',
    'www.ndbc.noaa.gov',
    'api.tidesandcurrents.noaa.gov',
    'www.nhc.noaa.gov',
    'api.avalanche.org',
    'wcc.sc.egov.usda.gov',
    'services.arcgis.com',
    'services3.arcgis.com',
    'geocoding.geo.census.gov',
    'fsapps.nwcg.gov',
    'www.nfmdb.org',
    'data.cocorahs.org',
    'waterservices.usgs.gov',
    'waterdata.usgs.gov',
    'earthquake.usgs.gov',
    'services.dat.noaa.gov',
    'spot.weather.gov',
    'gacc.nifc.gov',
    'radar.weather.gov',
]);

export function roundCoord(n: number, decimals = COORD_DECIMALS): number {
    const f = 10 ** decimals;
    return Math.round(n * f) / f;
}

export function hostAllowed(url: string): boolean {
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:') return false;
        return ALLOWED_HOSTS.has(u.hostname);
    } catch {
        return false;
    }
}

export type FetchJsonOpts = {
    signal?: AbortSignal;
    headers?: Record<string, string>;
    /** When true, skip host allowlist (same-origin CloudTAK API only). */
    sameOrigin?: boolean;
};

export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOpts = {}): Promise<T> {
    if (!opts.sameOrigin && !hostAllowed(url)) {
        throw new Error(`Host not allowlisted: ${url}`);
    }
    const res = await fetch(url, {
        signal: opts.signal,
        headers: {
            Accept: 'application/geo+json, application/json',
            'User-Agent': DEFAULT_UA,
            ...opts.headers,
        },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.json() as Promise<T>;
}

export async function fetchText(url: string, opts: FetchJsonOpts = {}): Promise<string> {
    if (!opts.sameOrigin && !hostAllowed(url)) {
        throw new Error(`Host not allowlisted: ${url}`);
    }
    const res = await fetch(url, {
        signal: opts.signal,
        headers: {
            Accept: 'text/plain, text/html, */*',
            'User-Agent': DEFAULT_UA,
            ...opts.headers,
        },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

export function ageLabelMs(at: number | null | undefined): string {
    if (at == null || !Number.isFinite(at)) return '—';
    const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    return `${hr}h ago`;
}

/** Cache entry with stale-while-revalidate semantics. */
export class TtlCache<T> {
    private store = new Map<string, { at: number; value: T }>();

    constructor(private ttlMs: number) {}

    get(key: string): T | undefined {
        const e = this.store.get(key);
        if (!e) return undefined;
        if (Date.now() - e.at > this.ttlMs) return undefined;
        return e.value;
    }

    /** Return even if stale (for display while refreshing). */
    peek(key: string): { value: T; at: number; stale: boolean } | undefined {
        const e = this.store.get(key);
        if (!e) return undefined;
        return { value: e.value, at: e.at, stale: Date.now() - e.at > this.ttlMs };
    }

    set(key: string, value: T): void {
        this.store.set(key, { at: Date.now(), value });
    }

    clear(): void {
        this.store.clear();
    }
}
