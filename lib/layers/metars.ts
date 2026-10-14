/**
 * METARs from the AWC minute cache (not the bbox API).
 * Respects AWC guidance: prefer cache files, ≤100 req/min, avoid per-pan queries.
 * https://aviationweather.gov/data/api/
 */
import { fetchBytes } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { firstSymbolLayer, mapOf } from '../core/map-host.ts';
import { state } from '../core/state.ts';
import { convertPressure, convertSpeed, convertTemp, type UnitSystem } from '../core/units.ts';
import { escapeHtml, registerFeatureLayers, unregisterFeatureLayers } from './feature-popup.ts';
import { mapEnvelope } from './geo-layer.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
} from './registry.ts';

const CACHE_URL = 'https://aviationweather.gov/data/cache/metars.cache.csv.gz';
/** Cache file updates once a minute — never hit AWC more often than that. */
const MIN_FETCH_GAP_MS = 60_000;
/** METARs usually update hourly; refresh a few times per hour is plenty. */
const POLL_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 120_000;
const BACKOFF_MAX_MS = 15 * 60_000;
const SOURCE_ID = 'livewx-metar-src';
const CIRCLE_ID = 'livewx-metar-circle';

const FLIGHT_COLORS = [
    'match',
    ['get', 'fltcat'],
    'VFR', '#2f9e44',
    'MVFR', '#1971c2',
    'IFR', '#e03131',
    'LIFR', '#9c36b5',
    '#868e96',
] as unknown[];

type MetarRow = {
    id: string;
    lon: number;
    lat: number;
    props: Record<string, unknown>;
};

type Cloud = { cover?: string; base?: number | null };

let running = false;
let allRows: MetarRow[] = [];
let visible: FeatureCollection = emptyFc();
let lastError = '';
let lastFetchAt = 0;
let backoffUntil = 0;
let backoffMs = BACKOFF_BASE_MS;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let moveHandler: (() => void) | null = null;
let abort: AbortController | null = null;
let fetchInFlight: Promise<void> | null = null;

function asNum(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
    return null;
}

function asStr(v: unknown): string {
    if (v == null) return '';
    return String(v).trim();
}

function parseClouds(raw: unknown): Cloud[] {
    if (Array.isArray(raw)) return raw as Cloud[];
    if (typeof raw === 'string' && raw.startsWith('[')) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            return Array.isArray(parsed) ? parsed as Cloud[] : [];
        } catch {
            return [];
        }
    }
    return [];
}

/** GeoJSON cloud bases are hundreds of feet; cache CSV uses feet AGL. */
function cloudBaseFt(base: number): number {
    return base > 0 && base < 1000 ? base * 100 : base;
}

function windText(props: Record<string, unknown>, units: UnitSystem): string {
    const dir = asStr(props.wdir);
    const spd = asNum(props.wspd);
    const gst = asNum(props.wgst);
    if (spd == null && !dir) return '—';
    const speed = spd == null ? null : convertSpeed(spd * 0.514444, units);
    const gust = gst == null ? null : convertSpeed(gst * 0.514444, units);
    const dirPart = !dir || dir === 'VRB' || dir === '0' || dir === '000'
        ? (spd === 0 ? 'Calm' : 'Variable')
        : `${dir}°`;
    if (dirPart === 'Calm' && (spd === 0 || spd == null)) return 'Calm';
    let out = dirPart === 'Variable' || dirPart === 'Calm'
        ? `${dirPart}${speed ? ` ${speed.value} ${speed.unit}` : ''}`
        : `${dirPart} at ${speed ? `${speed.value} ${speed.unit}` : `${spd} kt`}`;
    if (gust) out += `, gusting ${gust.value} ${gust.unit}`;
    return out;
}

function skyText(props: Record<string, unknown>): string {
    const clouds = parseClouds(props.clouds);
    if (clouds.length) {
        return clouds.map((c) => {
            const cover = asStr(c.cover) || '—';
            const base = asNum(c.base);
            if (base == null) return cover;
            return `${cover} ${cloudBaseFt(base)} ft`;
        }).join(', ');
    }
    const cover = asStr(props.cover);
    const ceil = asNum(props.ceil);
    if (!cover && ceil == null) return '—';
    if (ceil != null) return `${cover || 'Ceiling'} ${cloudBaseFt(ceil)} ft`;
    return cover || '—';
}

function altimText(props: Record<string, unknown>, units: UnitSystem): string {
    const hPa = asNum(props.altim);
    if (hPa == null) return '—';
    const p = convertPressure(hPa, units);
    return `${p.value} ${p.unit}`;
}

function tempPair(props: Record<string, unknown>, units: UnitSystem): string {
    const t = asNum(props.temp);
    const d = asNum(props.dewp);
    if (t == null && d == null) return '—';
    const parts: string[] = [];
    if (t != null) {
        const c = convertTemp(t, units);
        parts.push(`${c.value}${c.unit}`);
    }
    if (d != null) {
        const c = convertTemp(d, units);
        parts.push(`dewpoint ${c.value}${c.unit}`);
    }
    return parts.join(' / ');
}

/** Decoded METAR card with raw text underneath. */
export function metarDetailHtml(props: Record<string, unknown>): string {
    const units = state.units;
    const id = asStr(props.id) || 'METAR';
    const site = asStr(props.site);
    const raw = asStr(props.rawOb);
    const when = asStr(props.obsTime);
    const whenLabel = when ? new Date(when).toLocaleString() : '—';
    const flt = asStr(props.fltcat) || '—';
    const vis = asStr(props.visib) || '—';
    const wx = asStr(props.wx) || 'None';

    const rows: Array<[string, string]> = [
        ['Flight category', flt],
        ['Observed', whenLabel],
        ['Wind', windText(props, units)],
        ['Visibility', vis === '—' ? '—' : `${vis} SM`],
        ['Weather', wx],
        ['Sky', skyText(props)],
        ['Temperature', tempPair(props, units)],
        ['Altimeter', altimText(props, units)],
    ];

    const dl = rows.map(([k, v]) =>
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`,
    ).join('');

    const title = site ? `${id} — ${site}` : id;
    return `<div class="livewx-alert-card">
<div class="livewx-alert-eyebrow">METARs</div>
<div class="livewx-alert-title">${escapeHtml(title)}</div>
<dl class="livewx-alert-dl">${dl}</dl>
${raw ? `<div class="livewx-metar-raw">
<div class="livewx-metar-raw-label">Raw</div>
<pre class="livewx-metar-raw-text">${escapeHtml(raw)}</pre>
</div>` : ''}
</div>`;
}

async function gunzipText(buf: ArrayBuffer): Promise<string> {
    const DS = (globalThis as unknown as {
        DecompressionStream?: new (format: string) => GenericTransformStream;
    }).DecompressionStream;
    if (!DS) throw new Error('Gzip decompress not supported in this browser');
    const stream = new Response(buf).body?.pipeThrough(new DS('gzip'));
    if (!stream) throw new Error('Gzip decompress failed');
    return new Response(stream).text();
}

/** RFC-style CSV split that keeps quoted commas intact. */
function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (ch === ',' && !inQuotes) {
            out.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    out.push(cur);
    return out;
}

function uniqueHeaders(headers: string[]): string[] {
    const counts = new Map<string, number>();
    return headers.map((h) => {
        const key = h.trim();
        const n = counts.get(key) ?? 0;
        counts.set(key, n + 1);
        return n === 0 ? key : `${key}_${n}`;
    });
}

function parseCacheCsv(text: string): MetarRow[] {
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length < 2) return [];
    const headers = uniqueHeaders(splitCsvLine(lines[0]));
    const idx = (name: string) => headers.indexOf(name);
    const iId = idx('station_id');
    const iLat = idx('latitude');
    const iLon = idx('longitude');
    const iRaw = idx('raw_text');
    const iTime = idx('observation_time');
    const iTemp = idx('temp_c');
    const iDew = idx('dewpoint_c');
    const iWdir = idx('wind_dir_degrees');
    const iWspd = idx('wind_speed_kt');
    const iWgst = idx('wind_gust_kt');
    const iVis = idx('visibility_statute_mi');
    const iAltim = idx('altim_in_hg');
    const iWx = idx('wx_string');
    const iCat = idx('flight_category');
    const skyPairs: Array<{ cover: number; base: number }> = [];
    for (const h of headers) {
        if (!h.startsWith('sky_cover')) continue;
        const suffix = h.slice('sky_cover'.length); // '' | '_1' | '_2'
        const baseName = `cloud_base_ft_agl${suffix}`;
        const coverI = idx(h);
        const baseI = idx(baseName);
        if (coverI >= 0) skyPairs.push({ cover: coverI, base: baseI });
    }

    const rows: MetarRow[] = [];
    for (let li = 1; li < lines.length; li++) {
        const cols = splitCsvLine(lines[li]);
        const id = (cols[iId] || '').trim();
        const lat = Number(cols[iLat]);
        const lon = Number(cols[iLon]);
        if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const clouds: Cloud[] = [];
        for (const p of skyPairs) {
            const cover = (cols[p.cover] || '').trim();
            if (!cover) continue;
            const baseRaw = p.base >= 0 ? Number(cols[p.base]) : NaN;
            clouds.push({
                cover,
                base: Number.isFinite(baseRaw) ? baseRaw : null,
            });
        }
        const inHg = Number(cols[iAltim]);
        const altimHpa = Number.isFinite(inHg) ? inHg * 33.863886 : null;
        rows.push({
            id,
            lat,
            lon,
            props: {
                id,
                rawOb: (cols[iRaw] || '').trim(),
                obsTime: (cols[iTime] || '').trim(),
                temp: cols[iTemp] || '',
                dewp: cols[iDew] || '',
                wdir: (cols[iWdir] || '').trim(),
                wspd: cols[iWspd] || '',
                wgst: cols[iWgst] || '',
                visib: (cols[iVis] || '').trim(),
                altim: altimHpa == null ? '' : String(altimHpa),
                wx: (cols[iWx] || '').trim(),
                fltcat: (cols[iCat] || '').trim() || 'UNK',
                clouds: clouds.length ? JSON.stringify(clouds) : '',
                cover: clouds[0]?.cover || '',
            },
        });
    }
    return rows;
}

function bounds(): { west: number; south: number; east: number; north: number } | null {
    const env = mapEnvelope();
    if (!env) return null;
    const [west, south, east, north] = env.split(',').map(Number);
    if ([west, south, east, north].some((n) => !Number.isFinite(n))) return null;
    return { west, south, east, north };
}

function filterVisible(): FeatureCollection {
    const b = bounds();
    const features = [];
    for (const row of allRows) {
        if (b) {
            // Handle antimeridian simply: skip wrap for now; CONUS-safe.
            if (row.lon < b.west || row.lon > b.east || row.lat < b.south || row.lat > b.north) {
                continue;
            }
        }
        features.push({
            type: 'Feature' as const,
            id: row.id,
            geometry: { type: 'Point' as const, coordinates: [row.lon, row.lat] },
            properties: row.props,
        });
    }
    return { type: 'FeatureCollection', features };
}

function paint(map: LiveWxMap): void {
    ensureGeoJsonSource(map, SOURCE_ID, visible);
    const before = firstSymbolLayer(map);
    if (!map.getLayer(CIRCLE_ID)) {
        map.addLayer({
            id: CIRCLE_ID,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': 5,
                'circle-color': FLIGHT_COLORS,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff',
            },
        }, before);
    }
}

function applyVisible(): void {
    visible = filterVisible();
    const map = mapOf();
    if (map && running) paint(map);
    refreshStatus('metars');
}

async function fetchCache(force = false): Promise<void> {
    if (!running) return;
    const now = Date.now();
    if (!force && now < backoffUntil) {
        lastError = `Rate limited — retry in ${Math.ceil((backoffUntil - now) / 1000)}s`;
        refreshStatus('metars');
        return;
    }
    if (!force && lastFetchAt && now - lastFetchAt < MIN_FETCH_GAP_MS) {
        applyVisible();
        return;
    }
    if (fetchInFlight) {
        await fetchInFlight;
        return;
    }

    abort?.abort();
    abort = new AbortController();
    const ac = abort;

    fetchInFlight = (async () => {
        try {
            const buf = await fetchBytes(CACHE_URL, { signal: ac.signal });
            const text = await gunzipText(buf);
            allRows = parseCacheCsv(text);
            lastFetchAt = Date.now();
            lastError = '';
            backoffMs = BACKOFF_BASE_MS;
            backoffUntil = 0;
            applyVisible();
        } catch (e) {
            if (ac.signal.aborted) return;
            const msg = e instanceof Error ? e.message : 'Fetch failed';
            if (/429|Too Many Requests/i.test(msg)) {
                backoffUntil = Date.now() + backoffMs;
                lastError = `Rate limited — backing off ${Math.round(backoffMs / 1000)}s`;
                backoffMs = Math.min(BACKOFF_MAX_MS, backoffMs * 2);
            } else if (/403|Forbidden/i.test(msg)) {
                backoffUntil = Date.now() + BACKOFF_MAX_MS;
                lastError = 'Blocked by AWC — try again later';
            } else {
                lastError = msg;
            }
            // Keep prior dots if we have them.
            if (allRows.length) applyVisible();
            else refreshStatus('metars');
        } finally {
            fetchInFlight = null;
        }
    })();

    await fetchInFlight;
}

function bindMove(): void {
    const map = mapOf();
    if (!map || moveHandler) return;
    moveHandler = () => {
        if (moveTimer) clearTimeout(moveTimer);
        // Local filter only — no network on pan/zoom.
        moveTimer = setTimeout(() => {
            if (running) applyVisible();
        }, 120);
    };
    map.on('moveend', moveHandler);
}

function unbindMove(): void {
    if (moveTimer) {
        clearTimeout(moveTimer);
        moveTimer = null;
    }
    const map = mapOf();
    if (map && moveHandler) {
        try { map.off('moveend', moveHandler); } catch { /* ignore */ }
    }
    moveHandler = null;
}

export function registerMetarLayer(): void {
    registerLayer({
        id: 'metars',
        group: 'more',
        label: 'METARs',
        description: 'Airport METARs (AWC cache)',
        hosts: ['aviationweather.gov'],
        sends: 'Minute cache',
        start: async () => {
            running = true;
            registerFeatureLayers([CIRCLE_ID], {
                label: 'METARs',
                detailHtml: metarDetailHtml,
            });
            bindMove();
            await fetchCache(true);
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(() => { void fetchCache(false); }, POLL_MS);
        },
        stop: () => {
            running = false;
            abort?.abort();
            abort = null;
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            unbindMove();
            unregisterFeatureLayers([CIRCLE_ID]);
            const map = mapOf();
            if (map) {
                removeLayerSafe(map, CIRCLE_ID);
                removeSourceSafe(map, SOURCE_ID);
            }
            allRows = [];
            visible = emptyFc();
            lastError = '';
        },
        restore: (map) => {
            if (!running) return;
            registerFeatureLayers([CIRCLE_ID], {
                label: 'METARs',
                detailHtml: metarDetailHtml,
            });
            bindMove();
            visible = filterVisible();
            paint(map);
        },
        status: () => {
            if (lastError) return lastError;
            if (!running) return 'Off';
            return `${visible.features.length} station${visible.features.length === 1 ? '' : 's'}`;
        },
    });
}
