import { CONUS_SITE_ID, IEM_JSON_BASE, IEM_TMS_BASE, PROTOCOL_NAME } from './constants.ts';
import { filterImageData } from './palette.ts';
import { ALL_PRODUCTS, siteCode } from './products.ts';
import type { FilterKind, RadarProduct } from './products.ts';
import { isMosaic, toIemId } from './sites.ts';

export interface TileRequest {
    siteId: string;
    product: RadarProduct;
    siteType: string;
    stamp: string;
    filter: number;
    cacheBust: number;
}

let protocolReady = false;
let protocolFailed = false;

type ProtocolParams = {
    url?: string;
    type?: string;
};

type AddProtocol = (
    name: string,
    handler: (params: ProtocolParams, abort?: AbortController) => Promise<{ data: ArrayBuffer }>,
) => void;

async function maplibreModule(): Promise<{ addProtocol?: AddProtocol; removeProtocol?: (name: string) => void } | null> {
    try {
        const ml = await import('maplibre-gl') as {
            addProtocol?: AddProtocol;
            removeProtocol?: (name: string) => void;
            default?: { addProtocol?: AddProtocol; removeProtocol?: (name: string) => void };
        };
        return {
            addProtocol: ml.addProtocol ?? ml.default?.addProtocol,
            removeProtocol: ml.removeProtocol ?? ml.default?.removeProtocol,
        };
    } catch {
        return null;
    }
}

function httpsFromProtocol(url: string): string {
    return url.replace(`${PROTOCOL_NAME}://`, 'https://');
}

async function handleProtocol(
    params: ProtocolParams,
    abort?: AbortController,
): Promise<{ data: ArrayBuffer }> {
    const raw = params.url ?? '';
    const parsed = new URL(httpsFromProtocol(raw));
    const threshold = Number(parsed.searchParams.get('f') ?? '0');
    const kind = (parsed.searchParams.get('k') ?? 'reflectivity') as FilterKind;
    parsed.searchParams.delete('f');
    parsed.searchParams.delete('k');

    const response = await fetch(parsed.toString(), {
        signal: abort?.signal,
    });
    if (!response.ok) {
        throw new Error(`Radar tile HTTP ${response.status}`);
    }

    const blob = await response.blob();
    if (threshold <= 0) {
        return { data: await blob.arrayBuffer() };
    }

    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        bitmap.close();
        return { data: await blob.arrayBuffer() };
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    filterImageData(image.data, kind, threshold);
    ctx.putImageData(image, 0, 0);

    const out = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => {
            if (b) resolve(b);
            else reject(new Error('Failed to encode filtered tile'));
        }, 'image/png');
    });
    return { data: await out.arrayBuffer() };
}

export async function ensureFilterProtocol(): Promise<boolean> {
    if (protocolReady) return true;
    if (protocolFailed) return false;
    const ml = await maplibreModule();
    if (!ml?.addProtocol) {
        protocolFailed = true;
        return false;
    }
    try {
        ml.addProtocol(PROTOCOL_NAME, handleProtocol);
        protocolReady = true;
        return true;
    } catch {
        protocolFailed = true;
        return false;
    }
}

export async function removeFilterProtocol(): Promise<void> {
    if (!protocolReady) return;
    const ml = await maplibreModule();
    try {
        ml?.removeProtocol?.(PROTOCOL_NAME);
    } catch {
        /* ignore */
    }
    protocolReady = false;
}

function mosaicLayerName(product: RadarProduct, stamp: string): string {
    const layer = product.mosaicLayer ?? 'nexrad-n0q';
    if (!stamp || stamp === '0' || stamp === 'live') return layer;
    // IEM loop layers: nexrad-n0q-m05m … nexrad-n0q-m55m
    if (/^m\d{2}m$/.test(stamp)) return `${layer}-${stamp}`;
    // RIDGE mosaic archive: ridge::USCOMP-N0Q-YYYYMMDDHHMI
    return `ridge::USCOMP-${product.iemCode === 'N0B' ? 'N0Q' : product.iemCode}-${stamp}`;
}

function ridgeLayerName(siteId: string, product: RadarProduct, siteType: string, stamp: string): string {
    const sector = toIemId(siteId);
    const prod = siteCode(product, siteType);
    const when = !stamp || stamp === 'live' ? '0' : stamp;
    return `ridge::${sector}-${prod}-${when}`;
}

export function iemLayerName(req: TileRequest): string {
    if (isMosaic(req.siteId) || req.siteId === CONUS_SITE_ID) {
        return mosaicLayerName(req.product, req.stamp);
    }
    return ridgeLayerName(req.siteId, req.product, req.siteType, req.stamp);
}

export function tileUrl(req: TileRequest, useProtocol: boolean): string {
    const layer = iemLayerName(req);
    const kind = req.product.filterKind;
    const query = new URLSearchParams();
    if (req.cacheBust) query.set('t', String(req.cacheBust));
    if (useProtocol && req.filter > 0) {
        query.set('f', String(req.filter));
        query.set('k', kind);
    }
    const qs = query.toString();
    const path = `${IEM_TMS_BASE}/${layer}/{z}/{x}/{y}.png${qs ? `?${qs}` : ''}`;
    if (useProtocol && req.filter > 0 && kind !== 'other') {
        return path.replace('https://', `${PROTOCOL_NAME}://`);
    }
    return path;
}

export function mosaicLoopStamps(): string[] {
    const stamps: string[] = [];
    for (let m = 55; m >= 5; m -= 5) {
        stamps.push(`m${String(m).padStart(2, '0')}m`);
    }
    return stamps;
}

export async function fetchAvailableProducts(iemId: string): Promise<string[] | null> {
    try {
        const url = `${IEM_JSON_BASE}/radar.py?operation=available&radar=${encodeURIComponent(iemId)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const body = await res.json() as unknown;
        return extractProductCodes(body);
    } catch {
        return null;
    }
}

function extractProductCodes(body: unknown): string[] {
    const found = new Set<string>();
    const visit = (value: unknown): void => {
        if (typeof value === 'string') {
            const v = value.toUpperCase();
            if (/^[A-Z][A-Z0-9]{2,3}$/.test(v)) found.add(v);
            return;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value && typeof value === 'object') {
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                if (/product/i.test(k) || k === 'id' || k === 'code') visit(v);
                else if (typeof v !== 'string' || v.length > 8) visit(v);
            }
        }
    };
    visit(body);
    const known = new Set<string>();
    for (const product of ALL_PRODUCTS) {
        known.add(product.iemCode);
        if (product.tdwrCode) known.add(product.tdwrCode);
    }
    return [...found].filter((code) => known.has(code));
}

export interface ScanFrame {
    stamp: string;
    label: string;
    at: number;
}

export async function fetchSiteScans(
    iemId: string,
    productCode: string,
    startIso: string,
    endIso: string,
): Promise<ScanFrame[]> {
    try {
        const url = `${IEM_JSON_BASE}/radar.py?operation=list`
            + `&radar=${encodeURIComponent(iemId)}`
            + `&product=${encodeURIComponent(productCode)}`
            + `&start=${encodeURIComponent(startIso)}`
            + `&end=${encodeURIComponent(endIso)}`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const body = await res.json() as unknown;
        return extractScans(body);
    } catch {
        return [];
    }
}

function extractScans(body: unknown): ScanFrame[] {
    const frames: ScanFrame[] = [];
    const visit = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        if (value && typeof value === 'object') {
            const rec = value as Record<string, unknown>;
            const ts = rec.ts ?? rec.valid ?? rec.datetime ?? rec.time ?? rec.utc;
            if (typeof ts === 'string') {
                const at = Date.parse(ts);
                if (!Number.isNaN(at)) {
                    frames.push({
                        stamp: toRidgeStamp(new Date(at)),
                        label: new Date(at).toISOString().replace('.000Z', 'Z'),
                        at,
                    });
                }
            }
            for (const v of Object.values(rec)) {
                if (v && typeof v === 'object') visit(v);
            }
        }
    };
    visit(body);
    frames.sort((a, b) => a.at - b.at);
    const uniq = new Map<string, ScanFrame>();
    for (const f of frames) uniq.set(f.stamp, f);
    return [...uniq.values()];
}

export function toRidgeStamp(date: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
        + `${p(date.getUTCHours())}${p(date.getUTCMinutes())}`;
}

export function mosaicFrameLabel(stamp: string): string {
    if (!stamp || stamp === '0' || stamp === 'live') return 'Live';
    const match = /^m(\d{2})m$/.exec(stamp);
    if (match) return `${Number(match[1])} min ago`;
    return stamp;
}
