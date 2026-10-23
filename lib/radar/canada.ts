/**
 * Environment Canada GeoMet radar mosaic (same source Atmosphere uses over Canada).
 * Layer: RADAR_1KM_RRAI — North American rain precipitation rate, ~6 min updates.
 * @see https://eccc-msc.github.io/open-data/msc-data/obs_radar/readme_radar_geomet_en/
 */
import { CANADA_GEOMET } from '../core/constants.ts';
import { wmsTileUrl } from '../layers/wms.ts';

/** GeoMet WMS layer id for 1 km rain rate composite. */
export const CANADA_RADAR_LAYER = 'RADAR_1KM_RRAI';

/**
 * Atmosphere's "sees" box for Canada: from the 49th parallel north.
 * South of that, NWS/IEM border radars already cover the shared region.
 */
export const CANADA_SEES = {
    west: -141,
    east: -52,
    south: 49,
    north: 72,
} as const;

/** MapLibre raster tile template via same-origin proxy. */
export function canadaTileUrl(opts: { timeIso?: string; cacheBust?: number } = {}): string {
    const extra: Record<string, string> = {};
    if (opts.timeIso) extra.TIME = opts.timeIso;
    if (opts.cacheBust) extra._ = String(opts.cacheBust);
    return wmsTileUrl(CANADA_GEOMET, CANADA_RADAR_LAYER, extra);
}

export function inCanadaSees(lat: number, lng: number): boolean {
    return lat >= CANADA_SEES.south
        && lat <= CANADA_SEES.north
        && lng >= CANADA_SEES.west
        && lng <= CANADA_SEES.east;
}
