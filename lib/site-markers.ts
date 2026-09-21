import type { PluginAPI } from '@tak-ps/cloudtak';
import {
    SITES_CIRCLE_ID,
    SITES_LABEL_ID,
    SITES_RANGE_FILL_ID,
    SITES_RANGE_LINE_ID,
    SITES_RANGE_SOURCE_ID,
    SITES_SOURCE_ID,
    TDWR_RANGE_KM,
    WSR88D_RANGE_KM,
} from './constants.ts';
import type { LiveWxMap } from './map-types.ts';
import { allSites, findSite, isMosaic } from './sites.ts';
import type { RadarSite } from './sites.ts';
import { state } from './state.ts';

type GeoSource = { setData?: (data: unknown) => void };

let mapRef: LiveWxMap | null = null;
let onPick: ((id: string) => void) | null = null;

const EARTH_KM = 6371.0088;
const RANGE_STEPS = 72;

function emptyCollection() {
    return { type: 'FeatureCollection' as const, features: [] };
}

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

function rangeKm(site: RadarSite): number {
    return site.type === 'tdwr' ? TDWR_RANGE_KM : WSR88D_RANGE_KM;
}

/** Geodesic ring around a site, in GeoJSON [lon, lat] order. */
function rangeRing(lon: number, lat: number, radiusKm: number): number[][] {
    const coords: number[][] = [];
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const ang = radiusKm / EARTH_KM;
    for (let i = 0; i <= RANGE_STEPS; i++) {
        const brng = (i / RANGE_STEPS) * 2 * Math.PI;
        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(ang)
            + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
        );
        const lon2 = lon1 + Math.atan2(
            Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
            Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
        );
        let degLon = lon2 * 180 / Math.PI;
        if (degLon > 180) degLon -= 360;
        if (degLon < -180) degLon += 360;
        coords.push([degLon, lat2 * 180 / Math.PI]);
    }
    return coords;
}

function rangeCollection() {
    if (isMosaic(state.siteId)) return emptyCollection();
    const site = findSite(state.siteId);
    if (!site || site.type === 'mosaic') return emptyCollection();
    const ring = rangeRing(site.lon, site.lat, rangeKm(site));
    return {
        type: 'FeatureCollection' as const,
        features: [{
            type: 'Feature' as const,
            geometry: {
                type: 'Polygon' as const,
                coordinates: [ring],
            },
            properties: {
                id: site.id,
                rangeKm: rangeKm(site),
            },
        }],
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

    if (!map.getSource(SITES_RANGE_SOURCE_ID)) {
        map.addSource(SITES_RANGE_SOURCE_ID, {
            type: 'geojson',
            data: rangeCollection(),
        });
    } else {
        (map.getSource(SITES_RANGE_SOURCE_ID) as GeoSource | undefined)?.setData?.(rangeCollection());
    }

    const before = firstSymbolLayer(map);

    if (!map.getLayer(SITES_RANGE_FILL_ID)) {
        map.addLayer({
            id: SITES_RANGE_FILL_ID,
            type: 'fill',
            source: SITES_RANGE_SOURCE_ID,
            paint: {
                'fill-color': '#f2c14e',
                'fill-opacity': 0.08,
            },
        }, before);
    }
    if (!map.getLayer(SITES_RANGE_LINE_ID)) {
        map.addLayer({
            id: SITES_RANGE_LINE_ID,
            type: 'line',
            source: SITES_RANGE_SOURCE_ID,
            paint: {
                'line-color': '#f2c14e',
                'line-width': 2,
                'line-opacity': 0.95,
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
                'circle-stroke-width': [
                    'case',
                    ['==', ['get', 'selected'], 'yes'],
                    2.25,
                    1.25,
                ],
                'circle-stroke-color': [
                    'case',
                    ['==', ['get', 'selected'], 'yes'],
                    '#f2c14e',
                    '#0f172a',
                ],
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
    try { if (map.getLayer(SITES_RANGE_LINE_ID)) map.removeLayer(SITES_RANGE_LINE_ID); } catch { /* ignore */ }
    try { if (map.getLayer(SITES_RANGE_FILL_ID)) map.removeLayer(SITES_RANGE_FILL_ID); } catch { /* ignore */ }
    try { if (map.getSource(SITES_RANGE_SOURCE_ID)) map.removeSource(SITES_RANGE_SOURCE_ID); } catch { /* ignore */ }
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
    (mapRef.getSource(SITES_RANGE_SOURCE_ID) as GeoSource | undefined)?.setData?.(rangeCollection());
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
