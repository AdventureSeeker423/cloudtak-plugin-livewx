/**
 * Bridge existing radar/alerts/Blitzortung toggles into the layer catalog.
 */
import { startAlerts, stopAlerts } from '../alerts/alerts.ts';
import { getApi } from '../core/map-host.ts';
import { persist, state } from '../core/state.ts';
import { applyLightning } from '../lightning/lightning.ts';
import { registerLayer } from './registry.ts';

export function registerBridgeLayers(): void {
    registerLayer({
        id: 'nws_wwa',
        group: 'alerts',
        label: 'Watches & Warnings',
        description: 'Nationwide NWS active watches, warnings, and advisories',
        hosts: ['api.weather.gov'],
        sends: 'Active alerts feed request (no coordinates).',
        keyHtml: 'Polygon colors by event — tap for headline.',
        start: () => {
            state.alertsEnabled = true;
            persist();
            const api = getApi();
            if (api) startAlerts(api);
        },
        stop: () => {
            state.alertsEnabled = false;
            persist();
            stopAlerts();
        },
        restore: () => {
            const api = getApi();
            if (state.alertsEnabled && api) startAlerts(api);
        },
        status: () => (state.alertsEnabled ? `${state.alertCount} active` : 'Off'),
    });

    registerLayer({
        id: 'blitzortung',
        group: 'alerts',
        label: 'Live Lightning (Blitzortung)',
        description: 'Live strikes via CloudTAK relay — CC BY-SA 4.0, not for warnings',
        hosts: ['(CloudTAK relay → Blitzortung.org)'],
        sends: 'Same-origin poll only; server connects upstream.',
        keyHtml: 'Bolts fade white→red over lifetime. Entertainment / SA only.',
        start: () => {
            state.lightningEnabled = true;
            persist();
            applyLightning();
        },
        stop: () => {
            state.lightningEnabled = false;
            persist();
            applyLightning();
        },
        restore: () => {
            if (state.lightningEnabled) applyLightning();
        },
        status: () => (state.lightningEnabled ? 'Live strikes' : 'Off'),
    });

    registerLayer({
        id: 'radar_overlay',
        group: 'wind',
        label: 'Radar Overlay',
        description: 'IEM NEXRAD mosaic / single-site RIDGE (see Radar page)',
        hosts: ['mesonet.agron.iastate.edu', 'api.rainviewer.com', 'tilecache.rainviewer.com'],
        sends: 'Tile requests; optional archive timestamps.',
        keyHtml: 'Reflectivity / velocity — configure on Radar page.',
        start: async () => {
            state.overlayEnabled = true;
            persist();
            const { setOverlayEnabled } = await import('../radar/radar.ts');
            await setOverlayEnabled(true);
        },
        stop: async () => {
            state.overlayEnabled = false;
            persist();
            const { setOverlayEnabled } = await import('../radar/radar.ts');
            await setOverlayEnabled(false);
        },
        restore: () => { /* radar module handles style.load */ },
        status: () => (state.overlayEnabled ? state.status : 'Off'),
    });
}
