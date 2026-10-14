/**
 * Layer catalog registry: enable/disable, consent, status, z-order hooks.
 */
import { reactive } from 'vue';
import type { FeatureCollection } from '../core/geojson.ts';
import { emptyFeatureCollection } from '../core/geojson.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { getApi, mapOf, registerModule } from '../core/map-host.ts';
import { persistLayers, state } from '../core/state.ts';

export type LayerGroupId =
    | 'spot_stations'
    | 'wind'
    | 'storms'
    | 'fire'
    | 'rain_rivers'
    | 'ocean'
    | 'snow'
    | 'ground'
    | 'alerts';

export type LayerDef = {
    id: string;
    group: LayerGroupId;
    label: string;
    description: string;
    hosts: string[];
    /** What is sent when the layer fetches (shown in consent). */
    sends: string;
    experimental?: boolean;
    keyHtml?: string;
    /** Attach map sources/layers when enabled. */
    start: () => void | Promise<void>;
    stop: () => void | Promise<void>;
    restore: (map: LiveWxMap) => void;
    /** Optional status line for the layers page. */
    status?: () => string;
};

export const GROUP_LABELS: Record<LayerGroupId, string> = {
    spot_stations: 'Spot & Stations',
    wind: 'Wind',
    storms: 'Storms',
    fire: 'Fire',
    rain_rivers: 'Rain & Rivers',
    ocean: 'Ocean',
    snow: 'Snow',
    ground: 'Ground',
    alerts: 'Alerts & Lightning',
};

const defs = new Map<string, LayerDef>();

export const layerUi = reactive({
    /** layerId → last status string */
    status: {} as Record<string, string>,
    consentOpen: null as string | null,
});

export function registerLayer(def: LayerDef): void {
    defs.set(def.id, def);
    registerModule({
        id: `layer:${def.id}`,
        restore: (map) => {
            if (isEnabled(def.id)) def.restore(map);
        },
        destroy: () => {
            if (isEnabled(def.id)) def.stop();
        },
    });
}

export function allLayers(): LayerDef[] {
    return [...defs.values()];
}

export function layersInGroup(group: LayerGroupId): LayerDef[] {
    return allLayers().filter((d) => d.group === group);
}

export function getLayer(id: string): LayerDef | undefined {
    return defs.get(id);
}

export function isEnabled(id: string): boolean {
    return Boolean(state.layers[id]?.enabled);
}

export function hasConsent(id: string): boolean {
    return Boolean(state.layers[id]?.consent);
}

export function setConsent(id: string, ok: boolean): void {
    ensureLayerState(id);
    state.layers[id].consent = ok;
    persistLayers();
}

function ensureLayerState(id: string): void {
    if (!state.layers[id]) {
        state.layers[id] = { enabled: false, consent: false };
    }
}

export async function setLayerEnabled(id: string, enabled: boolean): Promise<void> {
    const def = defs.get(id);
    if (!def) return;
    ensureLayerState(id);
    if (enabled && !state.layers[id].consent) {
        layerUi.consentOpen = id;
        return;
    }
    state.layers[id].enabled = enabled;
    persistLayers();
    if (enabled) {
        await def.start();
        const map = mapOf();
        if (map) def.restore(map);
    } else {
        await def.stop();
    }
    refreshStatus(id);
}

export function confirmConsentAndEnable(id: string): void {
    setConsent(id, true);
    layerUi.consentOpen = null;
    void setLayerEnabled(id, true);
}

export function cancelConsent(): void {
    layerUi.consentOpen = null;
}

export function refreshStatus(id: string): void {
    const def = defs.get(id);
    if (!def?.status) {
        layerUi.status[id] = isEnabled(id) ? 'On' : 'Off';
        return;
    }
    try {
        layerUi.status[id] = def.status();
    } catch {
        layerUi.status[id] = isEnabled(id) ? 'On' : 'Off';
    }
}

export function refreshAllStatuses(): void {
    for (const id of defs.keys()) refreshStatus(id);
}

export async function startEnabledLayers(): Promise<void> {
    for (const def of defs.values()) {
        if (isEnabled(def.id) && hasConsent(def.id)) {
            try {
                await def.start();
                const map = mapOf();
                if (map) def.restore(map);
            } catch {
                /* ignore */
            }
        }
        refreshStatus(def.id);
    }
}

export function stopAllLayers(): void {
    for (const def of defs.values()) {
        if (isEnabled(def.id)) {
            try { def.stop(); } catch { /* ignore */ }
        }
    }
}

/** Helper for GeoJSON layer modules. */
export function ensureGeoJsonSource(
    map: LiveWxMap,
    sourceId: string,
    data: FeatureCollection | object,
): void {
    const existing = map.getSource(sourceId) as { setData?: (d: unknown) => void } | undefined;
    if (existing?.setData) {
        existing.setData(data);
        return;
    }
    if (map.getSource(sourceId)) {
        try { map.removeSource(sourceId); } catch { /* ignore */ }
    }
    map.addSource(sourceId, { type: 'geojson', data: data as FeatureCollection });
}

export function removeLayerSafe(map: LiveWxMap, id: string): void {
    try { if (map.getLayer(id)) map.removeLayer(id); } catch { /* ignore */ }
}

export function removeSourceSafe(map: LiveWxMap, id: string): void {
    try { if (map.getSource(id)) map.removeSource(id); } catch { /* ignore */ }
}

export function emptyFc(): FeatureCollection {
    return emptyFeatureCollection();
}

/** Re-export for layer modules that need the plugin API. */
export { getApi, mapOf };
