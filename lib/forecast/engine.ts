/**
 * Forecast fetch + normalize for pluggable JSON sources.
 */
import { reactive } from 'vue';
import { TtlCache, ageLabelMs, fetchJson, fetchText, roundCoord } from '../core/egress.ts';
import { state } from '../core/state.ts';
import { cacheTimeZone, timeZoneAt } from '../core/timezone.ts';
import { toCelsius, toMeters, toMps } from '../core/units.ts';
import {
    buildGroups,
    fillUrl,
    getSource,
    listSources,
    pathGet,
    type WxSourceDef,
} from './sources.ts';

export type SeriesPoint = { t: number; v: number | null };

export type ForecastReading = {
    key: string;
    label: string;
    quantity?: string;
    current: number | null;
    unit?: string;
    series: SeriesPoint[];
};

export type ForecastSnapshot = {
    sourceId: string;
    placeName: string;
    /** IANA timezone for the forecast point (e.g. America/New_York). */
    timeZone: string;
    fetchedAt: number;
    attribution: string;
    readings: ForecastReading[];
    afd: string;
    afdAt: number | null;
    error: string;
};

const resolveCache = new TtlCache<{ url: string; place: string; timeZone: string }>(7 * 24 * 60 * 60_000);
const forecastCache = new TtlCache<unknown>(15 * 60_000);

export const forecast = reactive<ForecastSnapshot>({
    sourceId: 'nws',
    placeName: '',
    timeZone: '',
    fetchedAt: 0,
    attribution: '',
    readings: [],
    afd: '',
    afdAt: null,
    error: '',
});

function gridValues(raw: unknown): SeriesPoint[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => {
        const r = row as { validTime?: string; value?: number | null };
        const start = r.validTime?.split('/')[0];
        const t = start ? Date.parse(start) : NaN;
        return { t: Number.isFinite(t) ? t : 0, v: r.value ?? null };
    }).filter((p) => p.t > 0);
}

function normalizeValue(v: number | null, unit?: string, quantity?: string): number | null {
    if (v == null || !Number.isFinite(v)) return null;
    if (quantity === 'temperature') return toCelsius(v, unit);
    if (quantity === 'speed') {
        if (unit?.includes('km')) return toMps(v, 'km/h');
        return toMps(v, unit);
    }
    if (quantity === 'length') return toMeters(v, unit);
    return v;
}

function nearestCurrent(series: SeriesPoint[]): number | null {
    if (!series.length) return null;
    const now = Date.now();
    let best = series[0];
    let bestAbs = Math.abs(best.t - now);
    for (const p of series) {
        const d = Math.abs(p.t - now);
        if (d < bestAbs) {
            best = p;
            bestAbs = d;
        }
    }
    return best.v;
}

async function resolveSource(
    def: WxSourceDef,
    lat: number,
    lon: number,
): Promise<{ url: string; place: string; timeZone: string }> {
    if (!def.resolveUrl) {
        const groups = buildGroups(def);
        return {
            url: fillUrl(def.requestUrl!, lat, lon, groups),
            place: '',
            timeZone: '',
        };
    }
    const key = `${def.sourceId}|${lat}|${lon}`;
    const hit = resolveCache.get(key);
    if (hit) return hit;
    const resolveUrl = fillUrl(def.resolveUrl, lat, lon, {});
    const body = await fetchJson(resolveUrl);
    const dataUrl = pathGet(body, def.resolvePath || '') as string | undefined;
    if (!dataUrl || !dataUrl.startsWith('https://')) {
        throw new Error('Resolve did not return an HTTPS data URL');
    }
    const placeParts = (def.placePaths ?? [])
        .map((p) => pathGet(body, p))
        .filter((x): x is string => typeof x === 'string' && x.length > 0);
    const place = placeParts.join(', ');
    const tzRaw = pathGet(body, 'properties.timeZone');
    const timeZone = typeof tzRaw === 'string' ? tzRaw : '';
    if (timeZone) cacheTimeZone(lat, lon, timeZone);
    const entry = { url: dataUrl, place, timeZone };
    resolveCache.set(key, entry);
    return entry;
}

function parseReadings(def: WxSourceDef, body: unknown): ForecastReading[] {
    const layout = def.layout || 'columns';
    const readings: ForecastReading[] = [];

    for (const p of def.parameters) {
        let series: SeriesPoint[] = [];
        let current: number | null = null;

        if (layout === 'grid' && p.seriesPath) {
            series = gridValues(pathGet(body, p.seriesPath)).map((pt) => ({
                t: pt.t,
                v: normalizeValue(pt.v, p.unit, p.quantity),
            }));
            current = nearestCurrent(series);
        } else if (layout === 'columns') {
            if (p.currentPath) {
                const cv = pathGet(body, p.currentPath);
                current = normalizeValue(typeof cv === 'number' ? cv : null, p.unit, p.quantity);
            }
            if (p.seriesPath && def.timePath) {
                const times = pathGet(body, def.timePath) as string[] | undefined;
                const vals = pathGet(body, p.seriesPath) as Array<number | null> | undefined;
                if (Array.isArray(times) && Array.isArray(vals)) {
                    series = times.map((t, i) => ({
                        t: Date.parse(t),
                        v: normalizeValue(vals[i] ?? null, p.unit, p.quantity),
                    })).filter((pt) => Number.isFinite(pt.t));
                }
            }
            if (current == null) current = nearestCurrent(series);
        }

        readings.push({
            key: p.key,
            label: p.label,
            quantity: p.quantity,
            current,
            unit: p.unit,
            series,
        });
    }
    return readings;
}

async function fetchAfd(lat: number, lon: number): Promise<{ text: string; at: number | null }> {
    try {
        const pts = await fetchJson(`https://api.weather.gov/points/${lat},${lon}`);
        const office = pathGet(pts, 'properties.cwa') as string | undefined;
        if (!office) return { text: '', at: null };
        const prod = await fetchJson(`https://api.weather.gov/products/types/AFD/locations/${office}`);
        const latest = pathGet(prod, '@graph.0.@id') as string | undefined
            || pathGet(prod, 'graph.0.id') as string | undefined;
        // NWS product collection uses @graph
        const graph = (prod as { '@graph'?: Array<{ '@id'?: string; id?: string }> })['@graph'];
        const id = latest || graph?.[0]?.['@id'] || graph?.[0]?.id;
        if (!id) return { text: '', at: null };
        const detail = await fetchJson(id);
        const text = (pathGet(detail, 'productText') as string) || '';
        return { text, at: Date.now() };
    } catch {
        return { text: '', at: null };
    }
}

export async function refreshForecast(): Promise<void> {
    const lat = state.queryLat;
    const lon = state.queryLon;
    if (lat == null || lon == null) {
        forecast.error = 'Select a forecast location';
        forecast.timeZone = '';
        return;
    }
    const rLat = roundCoord(lat);
    const rLon = roundCoord(lon);
    const def = getSource(state.forecastSourceId) || getSource('nws');
    if (!def) {
        forecast.error = 'No forecast source';
        return;
    }

    // Keep last good readings while refreshing
    forecast.error = '';
    forecast.sourceId = def.sourceId;
    forecast.attribution = def.attribution || def.displayName;

    try {
        const { url, place, timeZone } = await resolveSource(def, rLat, rLon);
        if (place) {
            forecast.placeName = place;
            state.placeName = place;
        }
        let tz = timeZone;
        const cacheKey = `${def.sourceId}|${url}`;
        let body = forecastCache.get(cacheKey);
        if (!body) {
            body = await fetchJson(url);
            forecastCache.set(cacheKey, body);
        }
        if (!tz && body && typeof body === 'object' && body !== null) {
            const omTz = (body as { timezone?: unknown }).timezone;
            if (typeof omTz === 'string' && omTz.length > 0) tz = omTz;
        }
        if (!tz) tz = await timeZoneAt(rLat, rLon);
        forecast.timeZone = tz;
        forecast.readings = parseReadings(def, body);
        forecast.fetchedAt = Date.now();

        if (def.sourceId === 'nws' || def.resolveUrl?.includes('api.weather.gov')) {
            const afd = await fetchAfd(rLat, rLon);
            forecast.afd = afd.text;
            forecast.afdAt = afd.at;
        }
    } catch (e) {
        forecast.error = e instanceof Error ? e.message : 'Forecast failed';
        if (!forecast.fetchedAt) {
            /* nothing cached */
        }
    }
}

export function forecastAge(): string {
    if (!forecast.fetchedAt) return '—';
    return ageLabelMs(forecast.fetchedAt);
}

export function availableSources(): WxSourceDef[] {
    return listSources();
}

export function reading(key: string): ForecastReading | undefined {
    return forecast.readings.find((r) => r.key === key || r.key.includes(key));
}

/** Best-effort lookup by label fragment. */
export function readingByLabel(...labels: string[]): ForecastReading | undefined {
    for (const label of labels) {
        const hit = forecast.readings.find((r) =>
            r.key.toLowerCase() === label.toLowerCase()
            || r.label.toLowerCase().includes(label.toLowerCase()),
        );
        if (hit) return hit;
    }
    return undefined;
}

void fetchText;
