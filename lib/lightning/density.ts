/**
 * NOAA nowCOAST lightning density WMS (Atmosphere-style delayed density).
 */
import {
    LIGHTNING_DENSITY_LAYER_ID,
    LIGHTNING_DENSITY_SOURCE_ID,
} from '../core/constants.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { persist, state } from '../core/state.ts';
import { registerLayer } from '../layers/registry.ts';
import { ensureRasterLayer, nowcoastTileUrl, removeRaster } from '../layers/wms.ts';

let running = false;

function tile(): string {
    // nowCOAST LDN strike density (workspace:layer from GetCapabilities).
    return nowcoastTileUrl('lightning_detection:ldn_lightning_strike_density');
}

function paint(map: LiveWxMap): void {
    ensureRasterLayer(map, LIGHTNING_DENSITY_SOURCE_ID, LIGHTNING_DENSITY_LAYER_ID, tile(), 0.7);
}

export function registerDensityLayer(): void {
    registerLayer({
        id: 'lightning_density',
        group: 'alerts',
        label: 'Lightning Density (NOAA)',
        description: '15-minute GOES GLM flash density — delayed, not live strikes',
        hosts: ['nowcoast.noaa.gov'],
        sends: 'Map tile requests only.',
        keyHtml: 'Density bands (not individual strikes). Latency applies.',
        start: () => {
            running = true;
            state.densityLightningEnabled = true;
            persist();
            const map = mapOf();
            if (map) paint(map);
        },
        stop: () => {
            running = false;
            state.densityLightningEnabled = false;
            persist();
            const map = mapOf();
            if (map) removeRaster(map, LIGHTNING_DENSITY_SOURCE_ID, LIGHTNING_DENSITY_LAYER_ID);
        },
        restore: (map) => {
            if (running || state.densityLightningEnabled) {
                running = true;
                paint(map);
            }
        },
        status: () => (running ? 'Density raster on' : 'Off'),
    });
}

export function applyDensityFromState(): void {
    if (state.densityLightningEnabled) {
        running = true;
        const map = mapOf();
        if (map) paint(map);
    }
}
