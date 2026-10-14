/**
 * Factory for pollable GeoJSON / ArcGIS FeatureServer layers.
 */
import { fetchJson } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import { emptyFeatureCollection } from '../core/geojson.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { firstSymbolLayer } from '../core/map-host.ts';
import {
    emptyFc,
    ensureGeoJsonSource,
    mapOf,
    refreshStatus,
    registerLayer,
    removeLayerSafe,
    removeSourceSafe,
    type LayerDef,
    type LayerGroupId,
} from './registry.ts';

export type GeoLayerOpts = {
    id: string;
    group: LayerGroupId;
    label: string;
    description: string;
    hosts: string[];
    sends: string;
    experimental?: boolean;
    keyHtml?: string;
    sourceId: string;
    fillId?: string;
    lineId?: string;
    circleId?: string;
    fillColor?: string;
    fillOpacity?: number;
    lineColor?: string;
    circleColor?: string;
    circleRadius?: number;
    pollMs?: number;
    /** Build the fetch URL (may use map bounds). */
    url: () => string | null;
    /** Transform raw JSON into a FeatureCollection. */
    parse?: (raw: unknown) => FeatureCollection;
    paintExtra?: (map: LiveWxMap) => void;
};

function asFc(raw: unknown): FeatureCollection {
    if (raw && typeof raw === 'object' && (raw as FeatureCollection).type === 'FeatureCollection') {
        return raw as FeatureCollection;
    }
    if (raw && typeof raw === 'object' && Array.isArray((raw as { features?: unknown }).features)) {
        return raw as FeatureCollection;
    }
    // ArcGIS FeatureSet
    const fs = raw as { features?: Array<{ geometry?: unknown; attributes?: Record<string, unknown> }> };
    if (Array.isArray(fs.features)) {
        const features = fs.features.map((f, i) => {
            const g = f.geometry as {
                x?: number;
                y?: number;
                rings?: number[][][];
                paths?: number[][][];
            } | null;
            let geometry: FeatureCollection['features'][0]['geometry'] = null;
            if (g && typeof g.x === 'number' && typeof g.y === 'number') {
                geometry = { type: 'Point', coordinates: [g.x, g.y] };
            } else if (g?.rings) {
                geometry = { type: 'Polygon', coordinates: g.rings };
            } else if (g?.paths) {
                geometry = { type: 'MultiLineString', coordinates: g.paths };
            }
            return {
                type: 'Feature' as const,
                id: i,
                geometry,
                properties: f.attributes ?? {},
            };
        });
        return { type: 'FeatureCollection', features };
    }
    return emptyFeatureCollection();
}

export function createGeoLayer(opts: GeoLayerOpts): LayerDef {
    let timer: ReturnType<typeof setInterval> | null = null;
    let data: FeatureCollection = emptyFc();
    let lastError = '';
    let featureCount = 0;
    let running = false;

    async function refresh(): Promise<void> {
        const url = opts.url();
        if (!url) {
            lastError = 'No URL (move the map or pick a point)';
            return;
        }
        try {
            const raw = await fetchJson(url);
            data = opts.parse ? opts.parse(raw) : asFc(raw);
            featureCount = data.features.length;
            lastError = '';
            const map = mapOf();
            if (map && running) paint(map);
        } catch (e) {
            lastError = e instanceof Error ? e.message : 'Fetch failed';
        }
        refreshStatus(opts.id);
    }

    function paint(map: LiveWxMap): void {
        ensureGeoJsonSource(map, opts.sourceId, data);
        const before = firstSymbolLayer(map);
        if (opts.fillId && !map.getLayer(opts.fillId)) {
            map.addLayer({
                id: opts.fillId,
                type: 'fill',
                source: opts.sourceId,
                paint: {
                    'fill-color': opts.fillColor ?? '#f59f00',
                    'fill-opacity': opts.fillOpacity ?? 0.25,
                },
            }, before);
        }
        if (opts.lineId && !map.getLayer(opts.lineId)) {
            map.addLayer({
                id: opts.lineId,
                type: 'line',
                source: opts.sourceId,
                paint: {
                    'line-color': opts.lineColor ?? '#d63939',
                    'line-width': 1.5,
                },
            }, before);
        }
        if (opts.circleId && !map.getLayer(opts.circleId)) {
            map.addLayer({
                id: opts.circleId,
                type: 'circle',
                source: opts.sourceId,
                paint: {
                    'circle-radius': opts.circleRadius ?? 5,
                    'circle-color': opts.circleColor ?? '#206bc4',
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#fff',
                },
            }, before);
        }
        opts.paintExtra?.(map);
    }

    function clear(map: LiveWxMap | null): void {
        if (!map) return;
        if (opts.fillId) removeLayerSafe(map, opts.fillId);
        if (opts.lineId) removeLayerSafe(map, opts.lineId);
        if (opts.circleId) removeLayerSafe(map, opts.circleId);
        removeSourceSafe(map, opts.sourceId);
    }

    const def: LayerDef = {
        id: opts.id,
        group: opts.group,
        label: opts.label,
        description: opts.description,
        hosts: opts.hosts,
        sends: opts.sends,
        experimental: opts.experimental,
        keyHtml: opts.keyHtml,
        start: async () => {
            running = true;
            await refresh();
            if (timer) clearInterval(timer);
            timer = setInterval(() => { void refresh(); }, opts.pollMs ?? 300_000);
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
            paint(map);
        },
        status: () => {
            if (lastError) return lastError;
            if (!running) return 'Off';
            return `${featureCount} feature${featureCount === 1 ? '' : 's'}`;
        },
    };

    registerLayer(def);
    return def;
}

/** ArcGIS FeatureServer query URL helper. */
export function arcgisQueryUrl(serviceUrl: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({
        where: '1=1',
        outFields: '*',
        returnGeometry: 'true',
        outSR: '4326',
        f: 'geojson',
        ...extra,
    });
    const base = serviceUrl.endsWith('/query') ? serviceUrl : `${serviceUrl.replace(/\/$/, '')}/query`;
    return `${base}?${params}`;
}

/** Map extent as ArcGIS envelope (xmin,ymin,xmax,ymax). */
export function mapEnvelope(): string | null {
    const map = mapOf();
    if (!map?.getBounds) return null;
    const b = map.getBounds();
    if (!b) return null;
    const west = typeof b.getWest === 'function' ? b.getWest() : (b as unknown as { _sw: { lng: number } })._sw?.lng;
    const south = typeof b.getSouth === 'function' ? b.getSouth() : (b as unknown as { _sw: { lat: number } })._sw?.lat;
    const east = typeof b.getEast === 'function' ? b.getEast() : (b as unknown as { _ne: { lng: number } })._ne?.lng;
    const north = typeof b.getNorth === 'function' ? b.getNorth() : (b as unknown as { _ne: { lat: number } })._ne?.lat;
    if ([west, south, east, north].some((n) => typeof n !== 'number')) return null;
    return `${west},${south},${east},${north}`;
}
