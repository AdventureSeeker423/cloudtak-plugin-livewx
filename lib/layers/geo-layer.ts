/**
 * Factory for pollable GeoJSON / ArcGIS FeatureServer layers.
 */
import { fetchJson } from '../core/egress.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import { emptyFeatureCollection } from '../core/geojson.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { firstSymbolLayer } from '../core/map-host.ts';
import { ensureMapIcons, removeMapIcons, type MapIcon } from '../core/map-icons.ts';
import {
    registerFeatureLayers,
    unregisterFeatureLayers,
} from './feature-popup.ts';
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
    circleColor?: string | unknown[];
    circleRadius?: number;
    /** Icon drawn on top of each circle (needs circleId); clicks open the same popup. */
    icon?: MapIcon;
    pollMs?: number;
    /** Re-fetch when the map finishes panning/zooming (extent layers). */
    refreshOnMove?: boolean;
    /** Preferred property keys for the click-detail title. */
    titleKeys?: string[];
    /** Custom click-detail HTML builder. */
    detailHtml?: (props: Record<string, unknown>) => string;
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
    const iconId = opts.icon && opts.circleId ? `${opts.circleId}-icon` : undefined;
    let timer: ReturnType<typeof setInterval> | null = null;
    let moveTimer: ReturnType<typeof setTimeout> | null = null;
    let moveHandler: (() => void) | null = null;
    let data: FeatureCollection = emptyFc();
    let lastError = '';
    let featureCount = 0;
    let running = false;

    function layerMeta() {
        return {
            label: opts.label,
            titleKeys: opts.titleKeys,
            detailHtml: opts.detailHtml,
        };
    }

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
        } else if (opts.circleId && opts.circleColor != null && map.getLayer(opts.circleId)) {
            map.setPaintProperty?.(opts.circleId, 'circle-color', opts.circleColor);
        }
        // Style swaps drop images, so (re-)add the icon on every paint.
        if (iconId && opts.icon && ensureMapIcons(map, [opts.icon]) && !map.getLayer(iconId)) {
            map.addLayer({
                id: iconId,
                type: 'symbol',
                source: opts.sourceId,
                layout: {
                    'icon-image': opts.icon.id,
                    'icon-allow-overlap': true,
                    'icon-ignore-placement': true,
                },
            });
        }
        opts.paintExtra?.(map);
    }

    function bindMoveRefresh(): void {
        if (!opts.refreshOnMove) return;
        const map = mapOf();
        if (!map || moveHandler) return;
        moveHandler = () => {
            if (moveTimer) clearTimeout(moveTimer);
            moveTimer = setTimeout(() => { void refresh(); }, 450);
        };
        map.on('moveend', moveHandler);
    }

    function unbindMoveRefresh(): void {
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

    function paintIds(): string[] {
        return [opts.fillId, opts.lineId, opts.circleId, iconId].filter((id): id is string => Boolean(id));
    }

    function clear(map: LiveWxMap | null): void {
        unregisterFeatureLayers(paintIds());
        if (!map) return;
        if (iconId) removeLayerSafe(map, iconId);
        if (opts.fillId) removeLayerSafe(map, opts.fillId);
        if (opts.lineId) removeLayerSafe(map, opts.lineId);
        if (opts.circleId) removeLayerSafe(map, opts.circleId);
        removeSourceSafe(map, opts.sourceId);
        if (opts.icon) removeMapIcons(map, [opts.icon]);
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
            registerFeatureLayers(paintIds(), layerMeta());
            bindMoveRefresh();
            await refresh();
            if (!running) return;
            if (timer) clearInterval(timer);
            timer = setInterval(() => { void refresh(); }, opts.pollMs ?? 300_000);
        },
        stop: () => {
            running = false;
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            unbindMoveRefresh();
            clear(mapOf());
            data = emptyFc();
            featureCount = 0;
        },
        restore: (map) => {
            if (!running) return;
            registerFeatureLayers(paintIds(), layerMeta());
            bindMoveRefresh();
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

/**
 * ArcGIS FeatureServer/MapServer query URL.
 * Values stay unencoded — viaProxy() applies a single encodeURIComponent pass
 * (URLSearchParams would double-encode through the proxy and ArcGIS returns 400).
 */
export function arcgisQueryUrl(serviceUrl: string, extra: Record<string, string> = {}): string {
    const parts = [
        'where=1=1',
        'outFields=*',
        'returnGeometry=true',
        'outSR=4326',
        'f=geojson',
    ];
    for (const [k, v] of Object.entries(extra)) {
        parts.push(`${k}=${v}`);
    }
    const base = serviceUrl.endsWith('/query') ? serviceUrl : `${serviceUrl.replace(/\/$/, '')}/query`;
    return `${base}?${parts.join('&')}`;
}

/** Map extent as ArcGIS envelope (xmin,ymin,xmax,ymax), unencoded. */
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
