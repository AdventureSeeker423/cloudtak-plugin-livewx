/**
 * Rain gauges: USGS NWIS precip (24 h sum) + CoCoRaHS daily reports for the state.
 */
import { fetchJson, fetchText } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import { firstSymbolLayer, mapOf } from '../core/map-host.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { usStateAtMapCenter } from '../core/us-state.ts';
import { DROPLET_SEARCH_ICON, ensureMapIcons, removeMapIcons } from '../core/map-icons.ts';
import { escapeHtml, linkHtml, registerFeatureLayers, unregisterFeatureLayers } from './feature-popup.ts';
import { mapEnvelope } from './geo-layer.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
} from './registry.ts';

const SOURCE_ID = 'livewx-rgauge-src';
const CIRCLE_ID = 'livewx-rgauge-circle';
const ICON_ID = 'livewx-rgauge-icon';
/** Circle + icon layers; clicks on either open the popup. */
const POPUP_IDS = [CIRCLE_ID, ICON_ID];
const POLL_MS = 15 * 60_000;
/** USGS NWIS IV rejects large bBoxes (about >5° on a side → HTTP 400). */
const USGS_MAX_SPAN_DEG = 4.5;

let running = false;
let data: FeatureCollection = emptyFc();
let lastError = '';
let featureCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let moveHandler: (() => void) | null = null;

function colorForInches(inches: number, trace: boolean): string {
    if (trace || (Number.isFinite(inches) && inches <= 0)) return '#adb5bd';
    if (!Number.isFinite(inches)) return '#868e96';
    if (inches < 0.1) return '#74c0fc';
    if (inches < 0.5) return '#1c7ed6';
    if (inches < 1) return '#2b8a3e';
    if (inches < 2) return '#f08c00';
    return '#e03131';
}

function parseCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
            if (q && line[i + 1] === '"') {
                cur += '"';
                i++;
            } else {
                q = !q;
            }
            continue;
        }
        if (c === ',' && !q) {
            out.push(cur.trim());
            cur = '';
            continue;
        }
        cur += c;
    }
    out.push(cur.trim());
    return out;
}

function cocoDate(d: Date): string {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

function parseCocoInches(raw: string): { inches: number; trace: boolean } {
    const t = raw.trim().toUpperCase();
    if (!t || t === 'NA' || t === 'M' || t === '-999') return { inches: NaN, trace: false };
    if (t === 'T' || t === 'TRACE') return { inches: 0, trace: true };
    const n = Number(t);
    return { inches: Number.isFinite(n) ? n : NaN, trace: false };
}

function parseCocoCsv(text: string, west: number, south: number, east: number, north: number): FeatureCollection['features'] {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const idx = (name: string) => headers.indexOf(name);
    const iNum = idx('stationnumber');
    const iName = idx('stationname');
    const iLat = idx('latitude');
    const iLon = idx('longitude');
    const iPrecip = idx('totalprecipamt');
    const iDate = idx('observationdate');
    const iTime = idx('observationtime');
    if (iLat < 0 || iLon < 0 || iPrecip < 0) return [];

    const features: FeatureCollection['features'] = [];
    for (let r = 1; r < lines.length; r++) {
        const cols = parseCsvLine(lines[r]);
        const lat = Number(cols[iLat]);
        const lon = Number(cols[iLon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lon < west || lon > east || lat < south || lat > north) continue;
        const { inches, trace } = parseCocoInches(cols[iPrecip] ?? '');
        const label = Number.isFinite(inches)
            ? (trace ? 'T' : `${inches.toFixed(2)} in`)
            : '—';
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
                name: cols[iName] || cols[iNum] || 'CoCoRaHS',
                id: cols[iNum] || '',
                source: 'CoCoRaHS',
                inches: Number.isFinite(inches) ? inches : null,
                inchesLabel: label,
                trace,
                observed: `${cols[iDate] || ''} ${cols[iTime] || ''}`.trim(),
                color: colorForInches(inches, trace),
            },
        });
    }
    return features;
}

async function fetchCoco(
    stateAbbr: string,
    west: number,
    south: number,
    east: number,
    north: number,
): Promise<FeatureCollection['features']> {
    const dates = [new Date(), new Date(Date.now() - 86400_000)];
    for (const d of dates) {
        const url = `https://data.cocorahs.org/export/exportreports.aspx?ReportType=Daily&Format=CSV&State=${stateAbbr}`
            + `&ReportDateType=reportdate&Date=${cocoDate(d)}&TimesInGMT=False`;
        try {
            const text = await fetchText(url);
            const feats = parseCocoCsv(text, west, south, east, north);
            if (feats.length) return feats;
        } catch {
            /* try prior day */
        }
    }
    return [];
}

type UsgsSeries = {
    sourceInfo?: {
        siteName?: string;
        siteCode?: Array<{ value?: string }>;
        geoLocation?: { geogLocation?: { latitude?: number; longitude?: number } };
    };
    values?: Array<{ value?: Array<{ value?: string; dateTime?: string }> }>;
};

function parseUsgs(raw: unknown): FeatureCollection['features'] {
    const series = (raw as { value?: { timeSeries?: UsgsSeries[] } })?.value?.timeSeries;
    if (!Array.isArray(series)) return [];
    const features: FeatureCollection['features'] = [];
    for (const t of series) {
        const info = t.sourceInfo;
        const loc = info?.geoLocation?.geogLocation;
        const lat = loc?.latitude;
        const lon = loc?.longitude;
        const site = info?.siteCode?.[0]?.value || '';
        if (typeof lat !== 'number' || typeof lon !== 'number' || !site) continue;
        const vals = t.values?.[0]?.value ?? [];
        let total = 0;
        let latest = '';
        for (const v of vals) {
            const n = Number(v.value);
            if (Number.isFinite(n)) total += n;
            if (v.dateTime) latest = v.dateTime;
        }
        const inches = Math.round(total * 1000) / 1000;
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
                name: info?.siteName || site,
                id: site,
                source: 'USGS',
                inches,
                inchesLabel: `${inches.toFixed(2)} in`,
                trace: false,
                observed: latest,
                url: `https://waterdata.usgs.gov/monitoring-location/${site}/`,
                color: colorForInches(inches, false),
            },
        });
    }
    return features;
}

function detailHtml(props: Record<string, unknown>): string {
    const name = escapeHtml(String(props.name || 'Rain gauge'));
    const rows: Array<[string, string]> = [
        ['Source', String(props.source || '')],
        ['24 h / daily', String(props.inchesLabel || '—')],
        ['Observed', String(props.observed || '—')],
        ['ID', String(props.id || '')],
    ];
    let dl = rows.map(([k, v]) =>
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`,
    ).join('');
    // Clickable like other popup URLs (opens in the small window).
    const url = String(props.url || '');
    if (/^https?:\/\//i.test(url)) dl += `<dt>Link</dt><dd>${linkHtml(url)}</dd>`;
    return `<div class="livewx-alert-card"><div class="livewx-alert-title">${name}</div><dl class="livewx-alert-dl">${dl}</dl></div>`;
}

function paint(map: LiveWxMap): void {
    ensureGeoJsonSource(map, SOURCE_ID, data);
    const before = firstSymbolLayer(map);
    if (!map.getLayer(CIRCLE_ID)) {
        map.addLayer({
            id: CIRCLE_ID,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-radius': [
                    'case',
                    ['==', ['get', 'source'], 'USGS'],
                    11,
                    10,
                ],
                // Same color as the legend (precip amount).
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff',
            },
        }, before);
    }
    // Style swaps drop images, so (re-)add the icon on every paint.
    if (ensureMapIcons(map, [DROPLET_SEARCH_ICON]) && !map.getLayer(ICON_ID)) {
        map.addLayer({
            id: ICON_ID,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'icon-image': DROPLET_SEARCH_ICON.id,
                'icon-size': ['case', ['==', ['get', 'source'], 'USGS'], 1, 0.9],
                'icon-allow-overlap': true,
                'icon-ignore-placement': true,
            },
        });
    }
}

/** Shrink a bbox to USGS's max span, keeping the map center. */
function clampUsgsBBox(
    west: number,
    south: number,
    east: number,
    north: number,
): { west: number; south: number; east: number; north: number; clamped: boolean } {
    const cx = (west + east) / 2;
    const cy = (south + north) / 2;
    let halfW = (east - west) / 2;
    let halfH = (north - south) / 2;
    let clamped = false;
    if (halfW * 2 > USGS_MAX_SPAN_DEG) {
        halfW = USGS_MAX_SPAN_DEG / 2;
        clamped = true;
    }
    if (halfH * 2 > USGS_MAX_SPAN_DEG) {
        halfH = USGS_MAX_SPAN_DEG / 2;
        clamped = true;
    }
    return {
        west: cx - halfW,
        south: cy - halfH,
        east: cx + halfW,
        north: cy + halfH,
        clamped,
    };
}

async function refresh(): Promise<void> {
    const env = mapEnvelope();
    if (!env) {
        lastError = 'Move the map';
        return;
    }
    const [west, south, east, north] = env.split(',').map(Number);
    if ([west, south, east, north].some((n) => !Number.isFinite(n))) {
        lastError = 'Bad map extent';
        return;
    }
    try {
        const box = clampUsgsBBox(west, south, east, north);
        let usgsFeats: FeatureCollection['features'] = [];
        let usgsNote = '';
        try {
            const usgsUrl = `https://waterservices.usgs.gov/nwis/iv/?format=json`
                + `&bBox=${box.west.toFixed(3)},${box.south.toFixed(3)},${box.east.toFixed(3)},${box.north.toFixed(3)}`
                + `&parameterCd=00045&period=P1D&siteStatus=active`;
            const usgsRaw = await fetchJson(usgsUrl);
            usgsFeats = parseUsgs(usgsRaw);
            if (box.clamped) usgsNote = 'USGS: zoom in for wider coverage';
        } catch {
            usgsNote = 'USGS unavailable';
        }

        let cocoFeats: FeatureCollection['features'] = [];
        try {
            const st = await usStateAtMapCenter();
            if (st) cocoFeats = await fetchCoco(st, west, south, east, north);
        } catch {
            /* CoCoRaHS optional if state resolve fails */
        }

        data = {
            type: 'FeatureCollection',
            features: [...usgsFeats, ...cocoFeats],
        };
        featureCount = data.features.length;
        lastError = featureCount === 0 && usgsNote ? usgsNote : '';
        const map = mapOf();
        if (map && running) paint(map);
    } catch (e) {
        lastError = e instanceof Error ? e.message : 'Rain gauges failed';
    }
    refreshStatus('rain_gauges');
}

function bindMove(): void {
    const map = mapOf();
    if (!map || moveHandler) return;
    moveHandler = () => {
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => { void refresh(); }, 500);
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

export function registerRainGaugesLayer(): void {
    registerLayer({
        id: 'rain_gauges',
        group: 'more',
        label: 'Rain Gauges',
        description: 'USGS 24 h precip + CoCoRaHS daily reports',
        hosts: ['waterservices.usgs.gov', 'waterdata.usgs.gov', 'data.cocorahs.org', 'api.weather.gov'],
        sends: 'Map extent / state',
        start: async () => {
            running = true;
            registerFeatureLayers(POPUP_IDS, {
                label: 'Rain Gauges',
                titleKeys: ['name', 'inchesLabel'],
                detailHtml,
            });
            bindMove();
            await refresh();
            if (!running) return;
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(() => { void refresh(); }, POLL_MS);
        },
        stop: () => {
            running = false;
            if (pollTimer) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            unbindMove();
            unregisterFeatureLayers(POPUP_IDS);
            const map = mapOf();
            if (map) {
                removeLayerSafe(map, ICON_ID);
                removeLayerSafe(map, CIRCLE_ID);
                removeSourceSafe(map, SOURCE_ID);
                removeMapIcons(map, [DROPLET_SEARCH_ICON]);
            }
            data = emptyFc();
            featureCount = 0;
        },
        restore: (map) => {
            if (!running) return;
            registerFeatureLayers(POPUP_IDS, {
                label: 'Rain Gauges',
                titleKeys: ['name', 'inchesLabel'],
                detailHtml,
            });
            bindMove();
            paint(map);
        },
        status: () => {
            if (lastError) return lastError;
            if (!running) return 'Off';
            return `${featureCount} gauge${featureCount === 1 ? '' : 's'}`;
        },
    });
}
