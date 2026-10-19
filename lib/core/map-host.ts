/**
 * Shared MapLibre host: style.load restack for every registered layer module.
 */
import type { PluginAPI } from '@tak-ps/cloudtak';
import type { LiveWxMap } from './map-types.ts';
export type LayerModule = {
    id: string;
    /** Re-attach sources/layers after basemap style swaps. */
    restore: (map: LiveWxMap) => void;
    destroy?: () => void;
};

let apiRef: PluginAPI | null = null;
let styleHandler: (() => void) | null = null;
const modules = new Map<string, LayerModule>();

export function getApi(): PluginAPI | null {
    return apiRef;
}

export function mapOf(): LiveWxMap | null {
    try {
        return (apiRef?.map as unknown as LiveWxMap) ?? null;
    } catch {
        return null;
    }
}

export function firstSymbolLayer(map: LiveWxMap): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
}

export function registerModule(mod: LayerModule): void {
    modules.set(mod.id, mod);
}

export function unregisterModule(id: string): void {
    const mod = modules.get(id);
    mod?.destroy?.();
    modules.delete(id);
}

function restack(): void {
    const map = mapOf();
    if (!map) return;
    for (const mod of modules.values()) {
        try {
            mod.restore(map);
        } catch {
            /* ignore per-layer restore errors */
        }
    }
}

export function initMapHost(api: PluginAPI): void {
    apiRef = api;
    const map = mapOf();
    if (map) {
        styleHandler = restack;
        map.on('style.load', styleHandler);
    }
}

export function destroyMapHost(): void {
    const map = mapOf();
    if (map && styleHandler) {
        try { map.off('style.load', styleHandler); } catch { /* ignore */ }
    }
    for (const mod of [...modules.values()]) {
        try { mod.destroy?.(); } catch { /* ignore */ }
    }
    modules.clear();
    styleHandler = null;
    apiRef = null;
}

export function restackNow(): void {
    restack();
}
