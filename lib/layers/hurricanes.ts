/**
 * Active NHC storms: CurrentStorms.json + tropical MapServer cone/track layers.
 * Service lives under /tropical/rest (not /vector/rest).
 */
import { fetchJson } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import { emptyFeatureCollection } from '../core/geojson.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { firstSymbolLayer, mapOf } from '../core/map-host.ts';
import { registerFeatureLayers, unregisterFeatureLayers } from './feature-popup.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
} from './registry.ts';

const CURRENT_STORMS = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const MAP_BASE = 'https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer';
const SOURCE_ID = 'livewx-nhc-src';
const FILL_ID = 'livewx-nhc-fill';
const LINE_ID = 'livewx-nhc-line';
const CIRCLE_ID = 'livewx-nhc-circle';

const SLOTS = [
    'AT1', 'AT2', 'AT3', 'AT4', 'AT5',
    'EP1', 'EP2', 'EP3', 'EP4', 'EP5',
    'CP1', 'CP2', 'CP3', 'CP4', 'CP5',
] as const;

const FIRST_BLOCK = 4;
const BLOCK_STRIDE = 26;

type Storm = {
    id?: string;
    binNumber?: string;
    name?: string;
    classification?: string;
    latitudeNumeric?: number;
    longitudeNumeric?: number;
    intensity?: string;
};

function layerId(bin: string, offset: number): number {
    const i = SLOTS.findIndex((s) => s.toLowerCase() === bin.toLowerCase());
    if (i < 0) return -1;
    return FIRST_BLOCK + BLOCK_STRIDE * i + offset;
}

function queryUrl(layer: number): string {
    return `${MAP_BASE}/${layer}/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
}

async function loadStorms(): Promise<FeatureCollection> {
    const body = await fetchJson<{ activeStorms?: Storm[] }>(CURRENT_STORMS);
    const storms = body.activeStorms ?? [];
    const features: FeatureCollection['features'] = [];

    for (const storm of storms) {
        const bin = storm.binNumber;
        if (!bin) continue;
        if (
            typeof storm.longitudeNumeric === 'number'
            && typeof storm.latitudeNumeric === 'number'
        ) {
            features.push({
                type: 'Feature',
                id: storm.id || bin,
                geometry: {
                    type: 'Point',
                    coordinates: [storm.longitudeNumeric, storm.latitudeNumeric],
                },
                properties: {
                    name: storm.name,
                    bin,
                    classification: storm.classification,
                    intensity: storm.intensity,
                    kind: 'center',
                },
            });
        }
        for (const [offset, kind] of [
            [4, 'cone'],
            [3, 'track'],
            [2, 'points'],
        ] as const) {
            const id = layerId(bin, offset);
            if (id < 0) continue;
            try {
                const fc = await fetchJson<FeatureCollection>(queryUrl(id));
                for (const f of fc.features ?? []) {
                    features.push({
                        ...f,
                        properties: {
                            ...(f.properties || {}),
                            name: storm.name,
                            bin,
                            kind,
                        },
                    });
                }
            } catch {
                /* empty slot */
            }
        }
    }

    return features.length ? { type: 'FeatureCollection', features } : emptyFeatureCollection();
}

export function registerHurricaneLayer(): void {
    let timer: ReturnType<typeof setInterval> | null = null;
    let data: FeatureCollection = emptyFc();
    let lastError = '';
    let featureCount = 0;
    let running = false;

    async function refresh(): Promise<void> {
        try {
            data = await loadStorms();
            featureCount = data.features.length;
            lastError = '';
            const map = mapOf();
            if (map && running) paint(map);
        } catch (e) {
            lastError = e instanceof Error ? e.message : 'Fetch failed';
        }
        refreshStatus('hurricanes');
    }

    function paint(map: LiveWxMap): void {
        ensureGeoJsonSource(map, SOURCE_ID, data);
        const before = firstSymbolLayer(map);
        if (!map.getLayer(FILL_ID)) {
            map.addLayer({
                id: FILL_ID,
                type: 'fill',
                source: SOURCE_ID,
                filter: [
                    'match',
                    ['geometry-type'],
                    ['Polygon', 'MultiPolygon'],
                    true,
                    false,
                ],
                paint: {
                    'fill-color': '#f03e3e',
                    'fill-opacity': 0.18,
                },
            }, before);
        }
        if (!map.getLayer(LINE_ID)) {
            map.addLayer({
                id: LINE_ID,
                type: 'line',
                source: SOURCE_ID,
                filter: [
                    'match',
                    ['geometry-type'],
                    ['LineString', 'MultiLineString'],
                    true,
                    false,
                ],
                paint: {
                    'line-color': '#c92a2a',
                    'line-width': 2,
                },
            }, before);
        }
        if (!map.getLayer(CIRCLE_ID)) {
            map.addLayer({
                id: CIRCLE_ID,
                type: 'circle',
                source: SOURCE_ID,
                filter: [
                    'match',
                    ['geometry-type'],
                    ['Point', 'MultiPoint'],
                    true,
                    false,
                ],
                paint: {
                    'circle-radius': 7,
                    'circle-color': '#fa5252',
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#fff',
                },
            }, before);
        }
    }

    const paintIds = [FILL_ID, LINE_ID, CIRCLE_ID];

    function clear(map: LiveWxMap | null): void {
        unregisterFeatureLayers(paintIds);
        if (!map) return;
        removeLayerSafe(map, FILL_ID);
        removeLayerSafe(map, LINE_ID);
        removeLayerSafe(map, CIRCLE_ID);
        removeSourceSafe(map, SOURCE_ID);
    }

    registerLayer({
        id: 'hurricanes',
        group: 'more',
        label: 'Hurricanes',
        description: 'NHC active storms',
        hosts: ['www.nhc.noaa.gov', 'mapservices.weather.noaa.gov'],
        sends: 'Storm list + cone/track',
        start: async () => {
            running = true;
            registerFeatureLayers(paintIds, {
                label: 'Hurricanes',
                titleKeys: ['name', 'bin', 'kind'],
            });
            await refresh();
            if (timer) clearInterval(timer);
            timer = setInterval(() => { void refresh(); }, 300_000);
        },
        stop: () => {
            running = false;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            clear(mapOf());
            data = emptyFc();
            featureCount = 0;
        },
        restore: (map) => {
            if (!running) return;
            registerFeatureLayers(paintIds, {
                label: 'Hurricanes',
                titleKeys: ['name', 'bin', 'kind'],
            });
            paint(map);
        },
        status: () => {
            if (lastError) return lastError;
            if (!running) return 'Off';
            return `${featureCount} feature${featureCount === 1 ? '' : 's'}`;
        },
    });
}
