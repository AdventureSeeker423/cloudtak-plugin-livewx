/**
 * SPC fire weather outlooks (Day 1–2) as GeoJSON polygons.
 * Raster export of Day 1 alone often looks empty when only Day 2 has risk areas.
 */
import { MAPSERVICES_NWS } from '../core/constants.ts';
import { fetchJson } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import { firstSymbolLayer, mapOf } from '../core/map-host.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { escapeHtml, registerFeatureLayers, unregisterFeatureLayers } from './feature-popup.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
} from './registry.ts';

const SOURCE_ID = 'livewx-fwo-src';
const FILL_ID = 'livewx-fwo-fill';
const LINE_ID = 'livewx-fwo-line';
const POLL_MS = 15 * 60_000;

const OUTLOOK_LAYERS = [
    { id: 1, day: 'Day 1', kind: 'outlook' as const },
    { id: 2, day: 'Day 1', kind: 'dryt' as const },
    { id: 4, day: 'Day 2', kind: 'outlook' as const },
    { id: 5, day: 'Day 2', kind: 'dryt' as const },
];

const OUTLOOK_LABEL: Record<number, string> = {
    5: 'Elevated',
    8: 'Critical',
    10: 'Extreme',
};
const DRYT_LABEL: Record<number, string> = {
    5: 'Isolated dry thunderstorm',
    8: 'Scattered dry thunderstorm',
};

const FILL_COLOR = [
    'match',
    ['get', 'dn'],
    5, '#e69800',
    8, '#ff0000',
    10, '#e600a9',
    '#868e96',
] as unknown[];

let running = false;
let data: FeatureCollection = emptyFc();
let lastError = '';
let featureCount = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function riskLabel(kind: 'outlook' | 'dryt', dn: number): string {
    if (kind === 'dryt') return DRYT_LABEL[dn] || `DryT ${dn}`;
    return OUTLOOK_LABEL[dn] || `Risk ${dn}`;
}

function detailHtml(props: Record<string, unknown>): string {
    const day = escapeHtml(String(props.day || ''));
    const risk = escapeHtml(String(props.risk || ''));
    const kind = String(props.kind) === 'dryt' ? 'Dry thunderstorm' : 'Fire weather';
    const valid = escapeHtml(String(props.valid || '—'));
    const expire = escapeHtml(String(props.expire || '—'));
    const title = `${day} — ${risk}`;
    const dl = [
        ['Type', kind],
        ['Risk', risk],
        ['Valid', valid],
        ['Expires', expire],
    ].map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${v}</dd>`).join('');
    return `<div class="livewx-alert-card"><div class="livewx-alert-eyebrow">Fire Outlook</div><div class="livewx-alert-title">${title}</div><dl class="livewx-alert-dl">${dl}</dl></div>`;
}

function asFc(raw: unknown): FeatureCollection {
    if (raw && typeof raw === 'object' && (raw as FeatureCollection).type === 'FeatureCollection') {
        return raw as FeatureCollection;
    }
    return emptyFc();
}

async function fetchLayer(
    layerId: number,
    day: string,
    kind: 'outlook' | 'dryt',
): Promise<FeatureCollection['features']> {
    const url = `${MAPSERVICES_NWS}/vector/rest/services/fire_weather/SPC_firewx/MapServer/${layerId}/query`
        + '?where=dn>0&outFields=dn,valid,expire&returnGeometry=true&outSR=4326&f=geojson';
    const fc = asFc(await fetchJson(url));
    const out: FeatureCollection['features'] = [];
    for (const f of fc.features) {
        if (!f.geometry) continue;
        const props = (f.properties || {}) as Record<string, unknown>;
        const dn = Number(props.dn);
        if (!Number.isFinite(dn) || dn <= 0) continue;
        out.push({
            ...f,
            properties: {
                ...props,
                dn,
                day,
                kind,
                risk: riskLabel(kind, dn),
                name: `${day} ${riskLabel(kind, dn)}`,
            },
        });
    }
    return out;
}

function paint(map: LiveWxMap): void {
    ensureGeoJsonSource(map, SOURCE_ID, data);
    const before = firstSymbolLayer(map);
    if (!map.getLayer(FILL_ID)) {
        map.addLayer({
            id: FILL_ID,
            type: 'fill',
            source: SOURCE_ID,
            paint: {
                'fill-color': FILL_COLOR,
                'fill-opacity': 0.35,
            },
        }, before);
    } else {
        map.setPaintProperty?.(FILL_ID, 'fill-color', FILL_COLOR);
    }
    if (!map.getLayer(LINE_ID)) {
        map.addLayer({
            id: LINE_ID,
            type: 'line',
            source: SOURCE_ID,
            paint: {
                'line-color': FILL_COLOR,
                'line-width': 1.5,
            },
        }, before);
    }
}

async function refresh(): Promise<void> {
    try {
        const chunks = await Promise.all(
            OUTLOOK_LAYERS.map((L) => fetchLayer(L.id, L.day, L.kind)),
        );
        const features = chunks.flat();
        data = { type: 'FeatureCollection', features };
        featureCount = features.length;
        lastError = featureCount === 0 ? 'No Day 1–2 risk areas right now' : '';
        const map = mapOf();
        if (map && running) paint(map);
    } catch (e) {
        lastError = e instanceof Error ? e.message : 'Fire outlook failed';
    }
    refreshStatus('fire_outlook');
}

export function registerFireOutlookLayer(): void {
    registerLayer({
        id: 'fire_outlook',
        group: 'more',
        label: 'Fire Outlook',
        description: 'SPC fire weather Day 1–2 (elevated / critical / extreme)',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Outlook polygons',
        start: async () => {
            running = true;
            registerFeatureLayers([FILL_ID, LINE_ID], {
                label: 'Fire Outlook',
                titleKeys: ['name', 'risk'],
                detailHtml,
            });
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
            unregisterFeatureLayers([FILL_ID, LINE_ID]);
            const map = mapOf();
            if (map) {
                removeLayerSafe(map, FILL_ID);
                removeLayerSafe(map, LINE_ID);
                removeSourceSafe(map, SOURCE_ID);
            }
            data = emptyFc();
            featureCount = 0;
        },
        restore: (map) => {
            if (!running) return;
            registerFeatureLayers([FILL_ID, LINE_ID], {
                label: 'Fire Outlook',
                titleKeys: ['name', 'risk'],
                detailHtml,
            });
            paint(map);
        },
        status: () => {
            if (lastError) return lastError;
            if (!running) return 'Off';
            return `${featureCount} area${featureCount === 1 ? '' : 's'}`;
        },
    });
}
