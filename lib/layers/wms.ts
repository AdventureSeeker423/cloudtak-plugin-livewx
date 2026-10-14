/**
 * Helpers for NOAA/nowCOAST-style WMS raster overlays in MapLibre.
 */
import type { LiveWxMap } from '../core/map-types.ts';
import { firstSymbolLayer } from '../core/map-host.ts';
import { removeLayerSafe, removeSourceSafe } from './registry.ts';

export function wmsTileUrl(base: string, layers: string, extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({
        SERVICE: 'WMS',
        VERSION: '1.1.1',
        REQUEST: 'GetMap',
        LAYERS: layers,
        STYLES: '',
        FORMAT: 'image/png',
        TRANSPARENT: 'true',
        SRS: 'EPSG:3857',
        WIDTH: '256',
        HEIGHT: '256',
        BBOX: '{bbox-epsg-3857}',
        ...extra,
    });
    const q = params.toString().replace('%7Bbbox-epsg-3857%7D', '{bbox-epsg-3857}');
    return `${base}?${q}`;
}

export function ensureRasterLayer(
    map: LiveWxMap,
    sourceId: string,
    layerId: string,
    tileUrl: string,
    opacity = 0.7,
    beforeId?: string,
): void {
    const source = map.getSource(sourceId) as { setTiles?: (t: string[]) => void } | undefined;
    if (source?.setTiles && map.getLayer(layerId)) {
        source.setTiles([tileUrl]);
        map.setPaintProperty?.(layerId, 'raster-opacity', opacity);
        return;
    }
    removeLayerSafe(map, layerId);
    removeSourceSafe(map, sourceId);
    map.addSource(sourceId, {
        type: 'raster',
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 12,
    });
    map.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: {
            'raster-opacity': opacity,
            'raster-fade-duration': 0,
        },
    }, beforeId ?? firstSymbolLayer(map));
}

export function removeRaster(map: LiveWxMap, sourceId: string, layerId: string): void {
    removeLayerSafe(map, layerId);
    removeSourceSafe(map, sourceId);
}
