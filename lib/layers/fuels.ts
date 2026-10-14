/**
 * National Fuel Moisture Database sampling sites (www.nfmdb.org), by state.
 */
import { fetchJson } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import { firstSymbolLayer, mapOf } from '../core/map-host.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { usStateAtMapCenter } from '../core/us-state.ts';
import { escapeHtml, registerFeatureLayers, unregisterFeatureLayers } from './feature-popup.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
} from './registry.ts';

const SOURCE_ID = 'livewx-fuel-src';
const CIRCLE_ID = 'livewx-fuel-circle';
const POLL_MS = 60 * 60_000;

/** Live-fuel moisture breaks (% of dry weight): critical / high / moderate / low. */
const LIVE_BREAKS = [60, 79, 99] as const;
const DEAD_1_10 = [6, 9, 15] as const;
const DEAD_100 = [10, 13, 18] as const;
const DEAD_1000 = [13, 16, 22] as const;
const LEVEL_COLORS = ['#e53935', '#ff9800', '#ffeb3b', '#43a047'] as const;
const LEVEL_LABELS = ['Critical', 'High', 'Moderate', 'Low'] as const;
const NO_SCALE = '#b0b0b0';

type FuelSample = {
    fuelType: string;
    lastSampledValue: number;
    lastSampledDate: string;
    yearsSampled?: number[];
};

type Station = {
    stationName?: string;
    coordinates?: { lat?: number; lng?: number };
    fuelData?: FuelSample[];
};

let running = false;
let data: FeatureCollection = emptyFc();
let lastError = '';
let featureCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let moveHandler: (() => void) | null = null;

function isDead(fuel: string): boolean {
    const f = fuel.trim();
    return f.endsWith('-Hour') || f.toLowerCase() === 'duff';
}

function breaksFor(fuel: string): readonly number[] | null {
    const f = fuel.trim();
    if (!isDead(f)) return LIVE_BREAKS;
    if (f === '1-Hour' || f === '10-Hour') return DEAD_1_10;
    if (f === '100-Hour') return DEAD_100;
    if (f === '1000-Hour') return DEAD_1000;
    return null;
}

function levelIndex(pct: number, breaks: readonly number[]): number {
    if (pct <= breaks[0]) return 0;
    if (pct <= breaks[1]) return 1;
    if (pct <= breaks[2]) return 2;
    return 3;
}

function colorFor(fuel: string, pct: number): string {
    const b = breaksFor(fuel);
    if (!b) return NO_SCALE;
    return LEVEL_COLORS[levelIndex(pct, b)];
}

function levelLabel(fuel: string, pct: number): string {
    const b = breaksFor(fuel);
    if (!b) return 'No scale';
    return LEVEL_LABELS[levelIndex(pct, b)];
}

function shortFuel(fuel: string): string {
    const i = fuel.indexOf(',');
    return (i > 0 ? fuel.slice(0, i) : fuel).trim();
}

function parseSampleDate(raw: string): number {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? t : 0;
}

function newestSample(fuels: FuelSample[]): FuelSample | null {
    let best: FuelSample | null = null;
    let bestAt = -1;
    for (const f of fuels) {
        if (f.lastSampledValue == null || !Number.isFinite(f.lastSampledValue)) continue;
        const at = parseSampleDate(f.lastSampledDate || '');
        if (at >= bestAt) {
            best = f;
            bestAt = at;
        }
    }
    return best;
}

function detailHtml(props: Record<string, unknown>): string {
    const name = escapeHtml(String(props.stationName || 'Fuel site'));
    const fuel = String(props.fuelType || '');
    const pct = Number(props.moisture);
    const when = props.sampledAt ? escapeHtml(String(props.sampledAt)) : '—';
    const level = escapeHtml(String(props.level || ''));
    const rows: Array<[string, string]> = [
        ['Moisture', Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—'],
        ['Fuel', shortFuel(fuel) || '—'],
        ['Full name', fuel || '—'],
        ['Level', level || '—'],
        ['Sampled', when],
    ];
    const fuelsRaw = props.fuelsJson;
    if (typeof fuelsRaw === 'string' && fuelsRaw) {
        try {
            const list = JSON.parse(fuelsRaw) as Array<{ fuelType: string; lastSampledValue: number }>;
            for (const f of list.slice(0, 20)) {
                const v = Number.isFinite(f.lastSampledValue) ? `${f.lastSampledValue.toFixed(1)}%` : '—';
                rows.push([shortFuel(f.fuelType), v]);
            }
        } catch { /* ignore */ }
    }
    const dl = rows.map(([k, v]) =>
        `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`,
    ).join('');
    return `<div class="livewx-alert-card"><div class="livewx-alert-title">${name}</div><dl class="livewx-alert-dl">${dl}</dl></div>`;
}

function toFeatures(stations: Station[], stateAbbr: string): FeatureCollection {
    const features: FeatureCollection['features'] = [];
    for (const st of stations) {
        const lat = st.coordinates?.lat;
        const lon = st.coordinates?.lng;
        if (typeof lat !== 'number' || typeof lon !== 'number') continue;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const fuels = Array.isArray(st.fuelData) ? st.fuelData : [];
        const newest = newestSample(fuels);
        if (!newest) continue;
        const moisture = newest.lastSampledValue;
        const fuelType = newest.fuelType || '';
        features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: {
                stationName: st.stationName || 'Fuel site',
                state: stateAbbr,
                fuelType,
                fuelShort: shortFuel(fuelType),
                moisture,
                moistureLabel: `${moisture.toFixed(0)}%`,
                sampledAt: newest.lastSampledDate || '',
                level: levelLabel(fuelType, moisture),
                color: colorFor(fuelType, moisture),
                fuelsJson: JSON.stringify(fuels.map((f) => ({
                    fuelType: f.fuelType,
                    lastSampledValue: f.lastSampledValue,
                    lastSampledDate: f.lastSampledDate,
                }))),
            },
        });
    }
    return { type: 'FeatureCollection', features };
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
                'circle-radius': 6,
                'circle-color': ['get', 'color'],
                'circle-stroke-width': 1,
                'circle-stroke-color': '#fff',
            },
        }, before);
    }
}

async function refresh(): Promise<void> {
    try {
        const st = await usStateAtMapCenter();
        if (!st) {
            lastError = 'Move the map over a US state';
            return;
        }
        const raw = await fetchJson<{ stationsData?: Station[] }>(
            `https://www.nfmdb.org/api/FMR/site_location_v2?input=${st}`,
        );
        data = toFeatures(raw.stationsData ?? [], st);
        featureCount = data.features.length;
        lastError = '';
        const map = mapOf();
        if (map && running) paint(map);
    } catch (e) {
        lastError = e instanceof Error ? e.message : 'Fuel moisture failed';
    }
    refreshStatus('fuel_moisture');
}

function bindMove(): void {
    const map = mapOf();
    if (!map || moveHandler) return;
    moveHandler = () => {
        if (moveTimer) clearTimeout(moveTimer);
        moveTimer = setTimeout(() => { void refresh(); }, 600);
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

export function registerFuelMoistureLayer(): void {
    registerLayer({
        id: 'fuel_moisture',
        group: 'more',
        label: 'Fuel Moisture',
        description: 'NFMD sampling sites for the state under the map',
        hosts: ['www.nfmdb.org', 'api.weather.gov'],
        sends: 'State code',
        start: async () => {
            running = true;
            registerFeatureLayers([CIRCLE_ID], {
                label: 'Fuel Moisture',
                titleKeys: ['stationName', 'fuelShort'],
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
            unregisterFeatureLayers([CIRCLE_ID]);
            const map = mapOf();
            if (map) {
                removeLayerSafe(map, CIRCLE_ID);
                removeSourceSafe(map, SOURCE_ID);
            }
            data = emptyFc();
            featureCount = 0;
        },
        restore: (map) => {
            if (!running) return;
            registerFeatureLayers([CIRCLE_ID], {
                label: 'Fuel Moisture',
                titleKeys: ['stationName', 'fuelShort'],
                detailHtml,
            });
            bindMove();
            paint(map);
        },
        status: () => {
            if (lastError) return lastError;
            if (!running) return 'Off';
            return `${featureCount} site${featureCount === 1 ? '' : 's'}`;
        },
    });
}
