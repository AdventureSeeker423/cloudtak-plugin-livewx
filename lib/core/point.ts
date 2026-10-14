/**
 * Forecast location: last-used point, or map click while picking.
 */
import { reactive } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { roundCoord } from './egress.ts';
import { mapOf } from './map-host.ts';
import { persist, state } from './state.ts';

export const pointUi = reactive({
    /** True while waiting for a map click to set the forecast location. */
    picking: false,
});

let clickHandler: ((e: { lngLat?: { lat: number; lng: number } }) => void) | null = null;
let onPicked: (() => void) | null = null;
let apiRef: PluginAPI | null = null;

function apply(lat: number, lon: number, place?: string): void {
    state.queryLat = roundCoord(lat);
    state.queryLon = roundCoord(lon);
    if (place != null) state.placeName = place;
}

function setMapCursor(cursor: string): void {
    const canvas = mapOf()?.getCanvas?.();
    if (canvas) canvas.style.cursor = cursor;
}

/** Restore last-used forecast point (if any). Does not invent a location. */
export async function refreshQueryPoint(): Promise<void> {
    if (state.pickLat != null && state.pickLon != null) {
        apply(
            state.pickLat,
            state.pickLon,
            state.placeName || undefined,
        );
        return;
    }
    state.queryLat = null;
    state.queryLon = null;
}

export function beginLocationPick(afterPick?: () => void): void {
    pointUi.picking = true;
    onPicked = afterPick ?? null;
    setMapCursor('crosshair');
}

export function cancelLocationPick(): void {
    pointUi.picking = false;
    onPicked = null;
    setMapCursor('');
}

export function initPointController(api: PluginAPI): void {
    apiRef = api;
    const map = mapOf();
    if (map) {
        clickHandler = (e) => {
            if (!pointUi.picking) return;
            const ll = e.lngLat;
            if (!ll) return;
            state.pickLat = roundCoord(ll.lat);
            state.pickLon = roundCoord(ll.lng);
            apply(state.pickLat, state.pickLon, `${state.pickLat}, ${state.pickLon}`);
            persist();
            const cb = onPicked;
            cancelLocationPick();
            cb?.();
        };
        map.on('click', clickHandler);
    }
    void refreshQueryPoint();
    void apiRef;
}

export function destroyPointController(): void {
    cancelLocationPick();
    const map = mapOf();
    if (map && clickHandler) {
        try { map.off('click', clickHandler); } catch { /* ignore */ }
    }
    clickHandler = null;
    onPicked = null;
    apiRef = null;
}
