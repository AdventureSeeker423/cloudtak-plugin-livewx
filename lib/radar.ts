import { ref } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { startAlerts, stopAlerts } from './alerts.ts';
import { RADAR_LAYER_ID, RADAR_SOURCE_ID, REFRESH_MS } from './constants.ts';
import type { LiveWxMap } from './map-types.ts';
import { FALLBACK_SITE_CODES, getProduct, mosaicProducts, productsForSite, siteCode } from './products.ts';
import type { RadarProduct } from './products.ts';
import { findSite, isMosaic, toIemId } from './sites.ts';
import { persist, state } from './state.ts';
import {
    ensureFilterProtocol,
    fetchAvailableProducts,
    fetchSiteScans,
    mosaicFrameLabel,
    mosaicLoopStamps,
    removeFilterProtocol,
    tileUrl,
    type ScanFrame,
} from './tiles.ts';

type RasterSource = { setTiles?: (tiles: string[]) => void };

let apiRef: PluginAPI | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let playTimer: ReturnType<typeof setInterval> | null = null;
let cacheBust = 0;
let protocolOn = false;
export const availableCodes = ref<string[] | null>(null);
let frames: ScanFrame[] = [];
export const replayFramesRef = ref<ScanFrame[]>([]);
let styleHandler: (() => void) | null = null;

export function currentProduct(): RadarProduct | undefined {
    return getProduct(state.productId);
}

export function visibleProducts(): RadarProduct[] {
    if (isMosaic(state.siteId)) return mosaicProducts();
    const site = findSite(state.siteId);
    return productsForSite(availableCodes.value, site?.type ?? 'wsr88d');
}

export function replayFrames(): ScanFrame[] {
    return replayFramesRef.value;
}

function mapOf(): LiveWxMap | null {
    try {
        return (apiRef?.map as unknown as LiveWxMap) ?? null;
    } catch {
        return null;
    }
}

function firstSymbolLayer(map: LiveWxMap): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
}

function currentStamp(): string {
    if (state.replayIndex < 0 || !frames[state.replayIndex]) return '0';
    return frames[state.replayIndex].stamp;
}

function statusText(): string {
    if (!state.overlayEnabled) return 'Overlay off';
    const product = currentProduct();
    const site = findSite(state.siteId);
    const where = site ? (isMosaic(site.id) ? 'CONUS mosaic' : site.id) : state.siteId;
    const frame = state.replayIndex >= 0 && frames[state.replayIndex]
        ? frames[state.replayIndex].label
        : 'Live';
    return `${where} · ${product?.label ?? state.productId} · ${frame}`;
}

function applyTiles(map: LiveWxMap): void {
    const product = currentProduct();
    if (!product) return;
    const site = findSite(state.siteId);
    const url = tileUrl({
        siteId: state.siteId,
        product,
        siteType: site?.type ?? 'wsr88d',
        stamp: currentStamp(),
        filter: state.filter,
        cacheBust,
    }, protocolOn && state.filter > 0 && product.filterKind !== 'other');

    const source = map.getSource(RADAR_SOURCE_ID) as RasterSource | undefined;
    if (source?.setTiles) {
        source.setTiles([url]);
        return;
    }
    if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID);
    if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID);
    map.addSource(RADAR_SOURCE_ID, {
        type: 'raster',
        tiles: [url],
        tileSize: 256,
        attribution: 'Radar: Iowa Environmental Mesonet',
    });
    map.addLayer({
        id: RADAR_LAYER_ID,
        type: 'raster',
        source: RADAR_SOURCE_ID,
        paint: { 'raster-opacity': state.opacity },
    }, firstSymbolLayer(map));
}

function ensureRadarLayer(map: LiveWxMap): void {
    if (!map.getSource(RADAR_SOURCE_ID) || !map.getLayer(RADAR_LAYER_ID)) {
        applyTiles(map);
        return;
    }
    applyTiles(map);
    map.setPaintProperty?.(RADAR_LAYER_ID, 'raster-opacity', state.opacity);
}

function removeRadarLayer(map: LiveWxMap): void {
    try { if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID); } catch { /* ignore */ }
    try { if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID); } catch { /* ignore */ }
}

async function loadAvailable(): Promise<void> {
    if (isMosaic(state.siteId)) {
        availableCodes.value = null;
        return;
    }
    const codes = await fetchAvailableProducts(toIemId(state.siteId));
    availableCodes.value = codes && codes.length ? codes : FALLBACK_SITE_CODES;
    const visible = visibleProducts();
    if (!visible.some((p) => p.id === state.productId)) {
        const fallback = visible.find((p) => p.category === 'REF') ?? visible[0];
        if (fallback) state.productId = fallback.id;
        persist();
    }
}

async function loadFrames(): Promise<void> {
    stopPlayTimer();
    if (isMosaic(state.siteId)) {
        const product = currentProduct();
        const loopable = product?.mosaicLayer === 'nexrad-n0q' || product?.mosaicLayer === 'nexrad-eet';
        frames = loopable
            ? mosaicLoopStamps().map((stamp) => ({
                stamp,
                label: mosaicFrameLabel(stamp),
                at: 0,
            }))
            : [];
        replayFramesRef.value = frames;
        return;
    }
    const product = currentProduct();
    const site = findSite(state.siteId);
    if (!product || !site) {
        frames = [];
        replayFramesRef.value = frames;
        return;
    }
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    frames = await fetchSiteScans(
        toIemId(site.id),
        siteCode(product, site.type),
        start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
        end.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    );
    replayFramesRef.value = frames;
}

function stopPlayTimer(): void {
    if (playTimer) {
        clearInterval(playTimer);
        playTimer = null;
    }
    state.playing = false;
}

function startRefresh(): void {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
        if (!state.overlayEnabled || state.replayIndex >= 0) return;
        cacheBust = Date.now();
        const map = mapOf();
        if (map) applyTiles(map);
        state.status = statusText();
    }, REFRESH_MS);
}

function onStyle(): void {
    const map = mapOf();
    if (!map || !state.overlayEnabled) return;
    ensureRadarLayer(map);
    if (state.alertsEnabled) startAlerts(apiRef!);
}

export async function init(api: PluginAPI): Promise<void> {
    apiRef = api;
    protocolOn = await ensureFilterProtocol();
    const map = mapOf();
    if (map) {
        styleHandler = onStyle;
        map.on('style.load', styleHandler);
    }
    if (state.alertsEnabled) startAlerts(api);
}

export function destroy(): void {
    stopPlayTimer();
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    stopAlerts();
    const map = mapOf();
    if (map) {
        if (styleHandler) {
            try { map.off('style.load', styleHandler); } catch { /* ignore */ }
        }
        removeRadarLayer(map);
    }
    styleHandler = null;
    apiRef = null;
    state.overlayEnabled = false;
    void removeFilterProtocol();
}

export async function setOverlayEnabled(enabled: boolean): Promise<void> {
    state.overlayEnabled = enabled;
    const map = mapOf();
    if (!enabled) {
        stopPlayTimer();
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (map) removeRadarLayer(map);
        state.status = 'Overlay off';
        return;
    }
    cacheBust = Date.now();
    await loadAvailable();
    await loadFrames();
    if (map) ensureRadarLayer(map);
    startRefresh();
    state.status = statusText();
}

export async function applyRadarSettings(): Promise<void> {
    persist();
    if (!state.overlayEnabled) {
        state.status = statusText();
        return;
    }
    state.replayIndex = -1;
    stopPlayTimer();
    cacheBust = Date.now();
    await loadAvailable();
    await loadFrames();
    const map = mapOf();
    if (map) ensureRadarLayer(map);
    state.status = statusText();
}

export function applyOpacity(): void {
    persist();
    const map = mapOf();
    map?.setPaintProperty?.(RADAR_LAYER_ID, 'raster-opacity', state.opacity);
}

export async function applyFilter(): Promise<void> {
    persist();
    if (!state.overlayEnabled) return;
    protocolOn = await ensureFilterProtocol();
    cacheBust = Date.now();
    const map = mapOf();
    if (map) applyTiles(map);
}

export function applyAlerts(): void {
    persist();
    if (!apiRef) return;
    if (state.alertsEnabled) startAlerts(apiRef);
    else stopAlerts();
}

export async function setReplayIndex(index: number): Promise<void> {
    if (index < 0 || !frames.length) {
        state.replayIndex = -1;
        cacheBust = Date.now();
        const map = mapOf();
        if (map && state.overlayEnabled) applyTiles(map);
        state.status = statusText();
        return;
    }
    state.replayIndex = Math.min(index, frames.length - 1);
    const map = mapOf();
    if (map && state.overlayEnabled) applyTiles(map);
    state.status = statusText();
}

export function togglePlay(): void {
    if (state.playing) {
        stopPlayTimer();
        state.status = statusText();
        return;
    }
    if (!frames.length) return;
    if (state.replayIndex < 0) state.replayIndex = 0;
    state.playing = true;
    playTimer = setInterval(() => {
        if (!frames.length) return;
        const next = state.replayIndex + 1;
        if (next >= frames.length) {
            state.replayIndex = 0;
        } else {
            state.replayIndex = next;
        }
        const map = mapOf();
        if (map && state.overlayEnabled) applyTiles(map);
        state.status = statusText();
    }, 400);
}

export function goLive(): void {
    stopPlayTimer();
    state.replayIndex = -1;
    cacheBust = Date.now();
    const map = mapOf();
    if (map && state.overlayEnabled) applyTiles(map);
    state.status = statusText();
}
