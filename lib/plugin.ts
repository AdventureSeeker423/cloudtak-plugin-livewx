/**
 * Plugin lifecycle: map host, layers, forecast point, radar/alerts/lightning.
 */
import { h } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { destroyMapHost, initMapHost } from './core/map-host.ts';
import { destroyPointController, initPointController, refreshQueryPoint } from './core/point.ts';
import { persist, state } from './core/state.ts';
import { syncSidebarTheme } from './core/theme.ts';
import { refreshForecast } from './forecast/engine.ts';
import { registerBridgeLayers } from './layers/bridges.ts';
import { registerCatalogLayers } from './layers/catalog.ts';
import { startEnabledLayers, stopAllLayers } from './layers/registry.ts';
import { registerDensityLayer, applyDensityFromState } from './lightning/density.ts';
import { destroy as destroyRadar, init as initRadar } from './radar/radar.ts';
import RadarBottomBar from './ui/RadarBottomBar.vue';

const BOTTOM_KEY = 'livewx-radar-opacity';

let wired = false;
let forecastTimer: ReturnType<typeof setInterval> | null = null;
let apiRef: PluginAPI | null = null;

function ensureCatalog(): void {
    if (wired) return;
    registerBridgeLayers();
    registerCatalogLayers();
    registerDensityLayer();
    wired = true;
}

/** Migrate pre-registry toggles into layer consent/enabled flags. */
function syncLegacyLayerFlags(): void {
    const pairs: Array<[string, boolean]> = [
        ['nws_wwa', state.alertsEnabled],
        ['blitzortung', state.lightningEnabled],
        ['radar_overlay', state.overlayEnabled],
        ['radar_sites', state.sitesOnMap],
        ['lightning_density', state.densityLightningEnabled],
    ];
    for (const [id, on] of pairs) {
        if (!on) continue;
        if (!state.layers[id]) state.layers[id] = { enabled: true, consent: true };
        else {
            state.layers[id].enabled = true;
            state.layers[id].consent = true;
        }
    }
    persist();
}

function attachBottomBar(api: PluginAPI): void {
    const bar = (api as PluginAPI & {
        bottomBar?: {
            add: (opts: { key: string; component: object }) => void;
            remove: (key: string) => void;
        };
    }).bottomBar;
    if (!bar?.add) return;
    try {
        bar.add({
            key: BOTTOM_KEY,
            component: { render: () => h(RadarBottomBar) },
        });
    } catch {
        /* older CloudTAK without bottomBar */
    }
}

function detachBottomBar(): void {
    const bar = (apiRef as PluginAPI & {
        bottomBar?: { remove: (key: string) => void };
    } | null)?.bottomBar;
    if (!bar?.remove) return;
    try { bar.remove(BOTTOM_KEY); } catch { /* ignore */ }
}

export async function init(api: PluginAPI): Promise<void> {
    apiRef = api;
    ensureCatalog();
    syncLegacyLayerFlags();
    initMapHost(api);
    initPointController(api);
    await initRadar(api);
    applyDensityFromState();
    await startEnabledLayers();
    attachBottomBar(api);
    await refreshQueryPoint();
    void refreshForecast();
    if (forecastTimer) clearInterval(forecastTimer);
    forecastTimer = setInterval(() => {
        void refreshQueryPoint().then(() => refreshForecast());
    }, 5 * 60_000);
    syncSidebarTheme();
}

export function destroy(): void {
    if (forecastTimer) {
        clearInterval(forecastTimer);
        forecastTimer = null;
    }
    detachBottomBar();
    stopAllLayers();
    destroyPointController();
    destroyRadar();
    destroyMapHost();
    apiRef = null;
}

export { refreshForecast, refreshQueryPoint };
