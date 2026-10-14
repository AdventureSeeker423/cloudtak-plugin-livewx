import { RAINVIEWER_API } from '../core/constants.ts';
import { fetchJson } from '../core/egress.ts';

type RainviewerMaps = {
    host?: string;
    radar?: {
        past?: Array<{ path: string; time: number }>;
        nowcast?: Array<{ path: string; time: number }>;
    };
};

let cached: { host: string; path: string; at: number } | null = null;

export async function fetchRainviewerHost(): Promise<{ host: string; path: string; at: number } | null> {
    if (cached && Date.now() - cached.at < 60_000) return cached;
    try {
        const body = await fetchJson<RainviewerMaps>(RAINVIEWER_API);
        const host = body.host?.replace(/\/$/, '') || 'https://tilecache.rainviewer.com';
        const frames = [...(body.radar?.past ?? []), ...(body.radar?.nowcast ?? [])];
        const last = frames[frames.length - 1];
        if (!last?.path) return null;
        cached = { host, path: last.path, at: Date.now() };
        return cached;
    } catch {
        return null;
    }
}

/** MapLibre raster tile template for RainViewer universal composite. */
export function rainviewerTileUrl(host: string, path: string): string {
    // {z}/{x}/{y}/ size / color / options
    return `${host}${path}/256/{z}/{x}/{y}/2/1_1.png`;
}
