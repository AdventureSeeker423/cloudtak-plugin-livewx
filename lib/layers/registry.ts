/**
 * Layer catalog registry: enable/disable, status, z-order hooks.
 * Enabling a layer records consent for its hosts (listed in the UI).
 */
import { reactive } from 'vue';
import { refreshAuthToken } from '../core/auth-token.ts';
import type { FeatureCollection } from '../core/geojson.ts';
import { emptyFeatureCollection } from '../core/geojson.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { getApi, mapOf, registerModule } from '../core/map-host.ts';
import { persistLayers, persistSoon, setOpacity, state } from '../core/state.ts';

export type LayerGroupId =
    | 'radar'
    | 'wind'
    | 'alerts'
    | 'more';

export type LayerDef = {
    id: string;
    group: LayerGroupId;
    label: string;
    description: string;
    hosts: string[];
    /** What is sent when the layer fetches (shown in UI). */
    sends: string;
    experimental?: boolean;
    keyHtml?: string;
    /** Default raster opacity when the layer supports a slider. */
    defaultOpacity?: number;
    /** Apply opacity to the live map paint (raster overlays). */
    applyOpacity?: (opacity: number) => void;
    start: () => void | Promise<void>;
    stop: () => void | Promise<void>;
    restore: (map: LiveWxMap) => void;
    status?: () => string;
};

export const GROUP_LABELS: Record<LayerGroupId, string> = {
    radar: 'Radar',
    wind: 'Wind',
    alerts: 'Alerts',
    more: 'More',
};

const defs = new Map<string, LayerDef>();

export const layerUi = reactive({
    /** layerId → last status string */
    status: {} as Record<string, string>,
    /** layerId → busy starting/stopping */
    busy: {} as Record<string, boolean>,
});

export function registerLayer(def: LayerDef): void {
    defs.set(def.id, def);
    registerModule({
        id: `layer:${def.id}`,
        restore: (map) => {
            if (isEnabled(def.id)) def.restore(map);
        },
        destroy: () => {
            if (isEnabled(def.id)) void def.stop();
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

function clamp01(n: number, fallback: number): number {
    if (!Number.isFinite(n)) return fallback;
    return Math.min(1, Math.max(0, n));
}

function ensureLayerState(id: string): void {
    if (!state.layers[id]) {
        // Replace object so Vue tracks new keys reliably.
        state.layers = {
            ...state.layers,
            [id]: { enabled: false, consent: false },
        };
    }
}

function writeLayerState(
    id: string,
    patch: { enabled?: boolean; consent?: boolean; opacity?: number },
): void {
    ensureLayerState(id);
    const cur = state.layers[id];
    const next: typeof cur = {
        enabled: patch.enabled ?? cur.enabled,
        consent: patch.consent ?? cur.consent,
    };
    const opacity = patch.opacity ?? cur.opacity;
    if (typeof opacity === 'number') next.opacity = clamp01(opacity, defs.get(id)?.defaultOpacity ?? 0.7);
    state.layers = {
        ...state.layers,
        [id]: next,
    };
    persistLayers();
}

/** Whether the master pane should show an opacity slider for this layer. */
export function layerHasOpacity(id: string): boolean {
    if (id === 'radar_overlay') return true;
    return Boolean(defs.get(id)?.applyOpacity);
}

export function getLayerOpacity(id: string): number {
    if (id === 'radar_overlay') return state.opacity;
    const fallback = defs.get(id)?.defaultOpacity ?? 0.7;
    const stored = state.layers[id]?.opacity;
    return typeof stored === 'number' ? clamp01(stored, fallback) : fallback;
}

export function setLayerOpacity(id: string, opacity: number): void {
    const def = defs.get(id);
    const fallback = def?.defaultOpacity ?? 0.7;
    const n = clamp01(opacity, fallback);
    if (id === 'radar_overlay') {
        setOpacity(n);
        def?.applyOpacity?.(n);
        return;
    }
    if (!def?.applyOpacity) return;
    ensureLayerState(id);
    const cur = state.layers[id];
    state.layers = {
        ...state.layers,
        [id]: { ...cur, opacity: n },
    };
    persistSoon();
    def.applyOpacity(n);
}

export async function setLayerEnabled(id: string, enabled: boolean): Promise<void> {
    const def = defs.get(id);
    if (!def) {
        layerUi.status[id] = 'Unknown layer';
        return;
    }
    layerUi.busy[id] = true;
    // Enabling implies consent for the hosts listed on the row.
    const enablePatch: { enabled: boolean; consent?: boolean; opacity?: number } = enabled
        ? { enabled: true, consent: true }
        : { enabled: false };
    if (enabled && def.defaultOpacity != null && state.layers[id]?.opacity == null) {
        enablePatch.opacity = def.defaultOpacity;
    }
    writeLayerState(id, enablePatch);
    refreshStatus(id);
    try {
        if (enabled) {
            layerUi.status[id] = 'Starting…';
            await refreshAuthToken();
            await def.start();
            const map = mapOf();
            if (map) def.restore(map);
        } else {
            await def.stop();
        }
    } catch (e) {
        if (enabled) {
            try { await def.stop(); } catch { /* ignore */ }
            writeLayerState(id, { enabled: false });
        }
        layerUi.status[id] = e instanceof Error ? e.message : 'Layer failed';
    } finally {
        layerUi.busy[id] = false;
        refreshStatus(id);
    }
}

export async function setGroupEnabled(group: LayerGroupId, enabled: boolean): Promise<void> {
    const layers = layersInGroup(group);
    // Sequential so map paint stays stable and status updates are readable.
    for (const layer of layers) {
        await setLayerEnabled(layer.id, enabled);
    }
}

export function refreshStatus(id: string): void {
    const def = defs.get(id);
    if (!def) {
        layerUi.status[id] = 'Off';
        return;
    }
    if (layerUi.busy[id]) {
        layerUi.status[id] = isEnabled(id) ? 'Starting…' : 'Stopping…';
        return;
    }
    if (!def.status) {
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
    await refreshAuthToken();
    for (const def of defs.values()) {
        if (isEnabled(def.id)) {
            try {
                await def.start();
                const map = mapOf();
                if (map) def.restore(map);
            } catch (e) {
                layerUi.status[def.id] = e instanceof Error ? e.message : 'Start failed';
            }
        }
        refreshStatus(def.id);
    }
}

export function stopAllLayers(): void {
    for (const def of defs.values()) {
        if (isEnabled(def.id)) {
            try { void def.stop(); } catch { /* ignore */ }
        }
    }
}

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

export { getApi, mapOf };
