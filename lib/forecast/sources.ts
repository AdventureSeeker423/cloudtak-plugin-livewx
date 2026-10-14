/**
 * Pluggable forecast source definitions (Atmosphere-inspired JSON schema).
 */
import nwsDef from '../../data/wx_sources/nws.json';
import openMeteoDef from '../../data/wx_sources/open-meteo.json';

export type Quantity = 'temperature' | 'speed' | 'length' | 'precipitation' | 'pressure' | 'angle' | 'percent';

export type SourceParameter = {
    key: string;
    label: string;
    quantity?: Quantity;
    unit?: string;
    requestGroups?: string[];
    currentPath?: string;
    seriesPath?: string;
    parse?: string;
    defaultOn?: boolean;
};

export type WxSourceDef = {
    schemaVersion: number;
    sourceId: string;
    displayName: string;
    description?: string;
    attribution?: string;
    termsUrl?: string;
    requestUrl?: string;
    resolveUrl?: string;
    resolvePath?: string;
    placePaths?: string[];
    layout?: 'columns' | 'records' | 'grid';
    timePath?: string;
    currentTimePath?: string;
    recordsPath?: string;
    parameters: SourceParameter[];
};

const bundled: WxSourceDef[] = [
    nwsDef as WxSourceDef,
    openMeteoDef as WxSourceDef,
];

const overrides = new Map<string, WxSourceDef>();

export function listSources(): WxSourceDef[] {
    const map = new Map<string, WxSourceDef>();
    for (const s of bundled) {
        if (s.schemaVersion === 1) map.set(s.sourceId, s);
    }
    for (const s of overrides.values()) {
        if (s.schemaVersion === 1) map.set(s.sourceId, s);
    }
    return [...map.values()];
}

export function getSource(id: string): WxSourceDef | undefined {
    return listSources().find((s) => s.sourceId === id);
}

export function registerOverride(def: WxSourceDef): string | null {
    if (def.schemaVersion !== 1) return `Unsupported schemaVersion ${def.schemaVersion}`;
    if (!def.sourceId || !/^[a-z0-9-]+$/.test(def.sourceId)) return 'Invalid sourceId';
    if (!def.displayName) return 'Missing displayName';
    if (!def.requestUrl && !def.resolveUrl) return 'Need requestUrl or resolveUrl';
    if (!def.parameters?.length) return 'Need parameters';
    overrides.set(def.sourceId, def);
    return null;
}

export function pathGet(obj: unknown, path: string): unknown {
    if (!path) return undefined;
    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let cur: unknown = obj;
    for (const p of parts) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
}

export function fillUrl(template: string, lat: number, lon: number, groups: Record<string, string[]>): string {
    let url = template
        .replaceAll('{lat}', String(lat))
        .replaceAll('{lon}', String(lon));
    for (const [name, keys] of Object.entries(groups)) {
        url = url.replaceAll(`{group:${name}}`, keys.join(','));
    }
    return url;
}

export function buildGroups(def: WxSourceDef): Record<string, string[]> {
    const groups: Record<string, string[]> = {};
    for (const p of def.parameters) {
        for (const g of p.requestGroups ?? []) {
            if (!groups[g]) groups[g] = [];
            groups[g].push(p.key);
        }
    }
    return groups;
}
