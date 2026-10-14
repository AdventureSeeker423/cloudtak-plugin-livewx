/**
 * Observed rain totals (MRMS QPE + RFC 7-day analysis) as a MapLibre raster.
 */
import { MAPSERVICES_NWS } from '../core/constants.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { persist, setRainTotalsWindow as persistRainWindow, state } from '../core/state.ts';
import { getLayerOpacity, registerLayer } from './registry.ts';
import { arcgisExportTileUrl, ensureRasterLayer, removeRaster } from './wms.ts';

export const RAIN_TOTAL_WINDOWS = [
    { id: '1h', label: '1 hour', kind: 'mrms', rasterFunction: 'rft_1hr' },
    { id: '6h', label: '6 hours', kind: 'mrms', rasterFunction: 'rft_6hr' },
    { id: '24h', label: '24 hours', kind: 'mrms', rasterFunction: 'rft_24hr' },
    { id: '72h', label: '3 days', kind: 'mrms', rasterFunction: 'rft_72hr' },
    { id: '7d', label: '7 days', kind: 'rfc', layers: 'show:56' },
] as const;

export type RainTotalWindowId = (typeof RAIN_TOTAL_WINDOWS)[number]['id'];

const SOURCE_ID = 'livewx-raintotals-src';
const LAYER_ID = 'livewx-raintotals-lyr';
const DEFAULT_OPACITY = 0.7;

let running = false;

function windowDef(id: string = state.rainTotalsWindow) {
    return RAIN_TOTAL_WINDOWS.find((w) => w.id === id) ?? RAIN_TOTAL_WINDOWS[2];
}

export function rainTotalsWindowLabel(id: string = state.rainTotalsWindow): string {
    return windowDef(id).label;
}

function tileUrl(): string {
    const w = windowDef();
    if (w.kind === 'rfc') {
        return arcgisExportTileUrl(
            `${MAPSERVICES_NWS}/raster/rest/services/obs/rfc_qpe/MapServer`,
            'map',
            { layers: w.layers },
        );
    }
    return arcgisExportTileUrl(
        `${MAPSERVICES_NWS}/raster/rest/services/obs/mrms_qpe/ImageServer`,
        'image',
        { rasterFunction: w.rasterFunction },
    );
}

function paint(map: LiveWxMap): void {
    ensureRasterLayer(
        map,
        SOURCE_ID,
        LAYER_ID,
        tileUrl(),
        getLayerOpacity('rain_totals'),
    );
}

export function setRainTotalsWindow(id: RainTotalWindowId): void {
    if (state.rainTotalsWindow === id) return;
    persistRainWindow(id);
    const map = mapOf();
    if (map && running) paint(map);
}

export function registerRainTotalsLayer(): void {
    registerLayer({
        id: 'rain_totals',
        group: 'radar',
        label: 'Rain Totals',
        description: 'Observed rainfall (MRMS / RFC analysis)',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Tiles',
        defaultOpacity: DEFAULT_OPACITY,
        applyOpacity: (opacity) => {
            const m = mapOf();
            if (m?.getLayer(LAYER_ID)) {
                m.setPaintProperty?.(LAYER_ID, 'raster-opacity', opacity);
            }
        },
        start: () => {
            running = true;
            const m = mapOf();
            if (m) paint(m);
        },
        stop: () => {
            running = false;
            const m = mapOf();
            if (m) removeRaster(m, SOURCE_ID, LAYER_ID);
        },
        restore: (map) => {
            if (running) paint(map);
        },
        status: () => (running ? `On · ${rainTotalsWindowLabel()}` : 'Off'),
    });
}

/** Migrate old exclusive rain_* toggles into rain_totals + window. */
export function migrateLegacyRainLayers(): void {
    const legacy: Array<[string, RainTotalWindowId]> = [
        ['rain_forecast', '1h'],
        ['rain_12h', '24h'],
    ];
    let enabled = Boolean(state.layers.rain_totals?.enabled);
    let window = state.rainTotalsWindow;
    for (const [id, win] of legacy) {
        if (state.layers[id]?.enabled) {
            enabled = true;
            window = win;
            state.layers[id].enabled = false;
        }
    }
    if (enabled) {
        if (!state.layers.rain_totals) {
            state.layers.rain_totals = { enabled: true, consent: true };
        } else {
            state.layers.rain_totals.enabled = true;
            state.layers.rain_totals.consent = true;
        }
        state.rainTotalsWindow = window;
        persist();
    }
}
