import type { PluginAPI } from '@tak-ps/cloudtak';
import {
    SITES_CIRCLE_ID,
    SITES_LABEL_ID,
    SITES_SELECTED_ID,
    SITES_SOURCE_ID,
} from './constants.ts';
import type { LiveWxMap } from './map-types.ts';
import { allSites } from './sites.ts';
import { state } from './state.ts';

type GeoSource = { setData?: (data: unknown) => void };

let mapRef: LiveWxMap | null = null;
let onPick: ((id: string) => void) | null = null;

function sitesCollection() {
    const selected = state.siteId;
    return {
        type: 'FeatureCollection' as const,
        features: allSites().map((site) => ({
            type: 'Feature' as const,
            geometry: {
                type: 'Point' as const,
                coordinates: [site.lon, site.lat],
            },
            properties: {
                id: site.id,
                name: site.place,
                state: site.state,
                kind: site.type,
                selected: site.id === selected ? 'yes' : 'no',
                label: site.id,
            },
        })),
    };
}

function firstSymbolLayer(map: LiveWxMap): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
}

function ensureLayers(map: LiveWxMap): void {
    if (!map.getSource(SITES_SOURCE_ID)) {
        map.addSource(SITES_SOURCE_ID, {
            type: 'geojson',
            data: sitesCollection(),
        });
    } else {
        (map.getSource(SITES_SOURCE_ID) as GeoSource | undefined)?.setData?.(sitesCollection());
    }

    const before = firstSymbolLayer(map);

    if (!map.getLayer(SITES_SELECTED_ID)) {
        map.addLayer({
            id: SITES_SELECTED_ID,
            type: 'circle',
            source: SITES_SOURCE_ID,
            filter: ['==', ['get', 'selected'], 'yes'],
            paint: {
                'circle-radius': 9,
                'circle-color': 'transparent',
                'circle-stroke-width': 2.5,
                'circle-stroke-color': '#f2c14e',
            },
        }, before);
    }
    if (!map.getLayer(SITES_CIRCLE_ID)) {
        map.addLayer({
            id: SITES_CIRCLE_ID,
            type: 'circle',
            source: SITES_SOURCE_ID,
            paint: {
                'circle-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    3, 3,
                    8, 6,
                ],
                'circle-color': [
                    'case',
                    ['==', ['get', 'kind'], 'tdwr'],
                    '#f59f00',
                    '#74c0fc',
                ],
                'circle-stroke-width': 1.25,
                'circle-stroke-color': '#0f172a',
            },
        }, before);
    }
    if (!map.getLayer(SITES_LABEL_ID)) {
        map.addLayer({
            id: SITES_LABEL_ID,
            type: 'symbol',
            source: SITES_SOURCE_ID,
            minzoom: 5,
            layout: {
                'text-field': ['get', 'label'],
                'text-size': 11,
                'text-offset': [0, 1.15],
                'text-anchor': 'top',
                'text-allow-overlap': false,
            },
            paint: {
                'text-color': '#e9ecef',
                'text-halo-color': '#0f172a',
                'text-halo-width': 1.25,
            },
        });
    }
}

function removeLayers(map: LiveWxMap): void {
    try { if (map.getLayer(SITES_LABEL_ID)) map.removeLayer(SITES_LABEL_ID); } catch { /* ignore */ }
    try { if (map.getLayer(SITES_CIRCLE_ID)) map.removeLayer(SITES_CIRCLE_ID); } catch { /* ignore */ }
    try { if (map.getLayer(SITES_SELECTED_ID)) map.removeLayer(SITES_SELECTED_ID); } catch { /* ignore */ }
    try { if (map.getSource(SITES_SOURCE_ID)) map.removeSource(SITES_SOURCE_ID); } catch { /* ignore */ }
}

function onClick(e: {
    features?: Array<{ properties?: { id?: string } }>;
}): void {
    const id = e.features?.[0]?.properties?.id;
    if (!id || !onPick) return;
    onPick(id);
}

function onEnter(): void {
    const canvas = (mapRef as { getCanvas?: () => { style: { cursor: string } } } | null)?.getCanvas?.();
    if (canvas) canvas.style.cursor = 'pointer';
}

function onLeave(): void {
    const canvas = (mapRef as { getCanvas?: () => { style: { cursor: string } } } | null)?.getCanvas?.();
    if (canvas) canvas.style.cursor = '';
}

export function refreshSiteMarkers(): void {
    if (!mapRef) return;
    (mapRef.getSource(SITES_SOURCE_ID) as GeoSource | undefined)?.setData?.(sitesCollection());
}

export function startSiteMarkers(api: PluginAPI, pick: (id: string) => void): void {
    const map = api.map as unknown as LiveWxMap;
    mapRef = map;
    onPick = pick;
    ensureLayers(map);
    map.off('click', SITES_CIRCLE_ID, onClick);
    map.on('click', SITES_CIRCLE_ID, onClick);
    map.off('mouseenter', SITES_CIRCLE_ID, onEnter);
    map.on('mouseenter', SITES_CIRCLE_ID, onEnter);
    map.off('mouseleave', SITES_CIRCLE_ID, onLeave);
    map.on('mouseleave', SITES_CIRCLE_ID, onLeave);
}

export function stopSiteMarkers(): void {
    if (mapRef) {
        try { mapRef.off('click', SITES_CIRCLE_ID, onClick); } catch { /* ignore */ }
        try { mapRef.off('mouseenter', SITES_CIRCLE_ID, onEnter); } catch { /* ignore */ }
        try { mapRef.off('mouseleave', SITES_CIRCLE_ID, onLeave); } catch { /* ignore */ }
        onLeave();
        removeLayers(mapRef);
    }
    mapRef = null;
    onPick = null;
}
