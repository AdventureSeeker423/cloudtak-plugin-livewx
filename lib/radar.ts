import { ref } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { startAlerts, stopAlerts } from './alerts.ts';
import {
    MOSAIC_CLOSEUP_ZOOM,
    MOSAIC_MAXZOOM,
    RADAR_LAYER_ID,
    RADAR_SOURCE_ID,
    REFRESH_MS,
    RIDGE_MAXZOOM,
} from './constants.ts';
import type { LiveWxMap } from './map-types.ts';
import { FALLBACK_SITE_CODES, getProduct, mosaicProducts, productsForSite, siteCode } from './products.ts';
import type { RadarProduct } from './products.ts';
import { refreshSiteMarkers, startSiteMarkers, stopSiteMarkers } from './site-markers.ts';
import { findSite, isMosaic, nearestWsr88d, toIemId } from './sites.ts';
import { persist, setSite, state } from './state.ts';
import {
    ensureFilterProtocol,
    fetchAvailableProducts,
    fetchMosaicValidAt,
    fetchSiteScans,
    mosaicFrameLabel,
    mosaicLoopStamps,
    removeFilterProtocol,
    tileUrl,
    ageLabel,
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
export const autoSiteId = ref<string | null>(null);
export const liveValidAt = ref<number | null>(null);
let styleHandler: (() => void) | null = null;
let viewHandler: (() => void) | null = null;
let lastSourceSig = '';
let filterRaf = 0;
let viewRaf = 0;

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
    let where = site ? (isMosaic(site.id) ? 'CONUS mosaic' : site.id) : state.siteId;
    if (isMosaic(state.siteId) && autoSiteId.value) {
        where = `${autoSiteId.value} close-up`;
    }
    const frame = state.replayIndex >= 0 && frames[state.replayIndex]
        ? ageLabel(frames[state.replayIndex].at)
        : (liveValidAt.value != null ? `Live · ${ageLabel(liveValidAt.value)}` : 'Live');
    return `${where} · ${product?.label ?? state.productId} · ${frame}`;
}

function displaySite(): { siteId: string; siteType: string; maxzoom: number } {
    if (!isMosaic(state.siteId)) {
        const site = findSite(state.siteId);
        autoSiteId.value = null;
        return {
            siteId: state.siteId,
            siteType: site?.type ?? 'wsr88d',
            maxzoom: RIDGE_MAXZOOM,
        };
    }
    const map = mapOf();
    const zoom = map?.getZoom?.() ?? 0;
    const live = state.replayIndex < 0;
    if (live && zoom >= MOSAIC_CLOSEUP_ZOOM) {
        const center = map?.getCenter?.();
        const nearest = center ? nearestWsr88d(center.lat, center.lng) : undefined;
        if (nearest) {
            autoSiteId.value = nearest.id;
            return { siteId: nearest.id, siteType: nearest.type, maxzoom: RIDGE_MAXZOOM };
        }
    }
    autoSiteId.value = null;
    return { siteId: state.siteId, siteType: 'mosaic', maxzoom: MOSAIC_MAXZOOM };
}

function applyTiles(map: LiveWxMap): void {
    const product = currentProduct();
    if (!product) return;
    const display = displaySite();
    const useProtocol = protocolOn && product.filterKind !== 'other';
    const url = tileUrl({
        siteId: display.siteId,
        product,
        siteType: display.siteType,
        stamp: currentStamp(),
        filter: state.filter,
        cacheBust,
    }, useProtocol);

    const sig = `${display.siteId}|${display.maxzoom}`;
    const source = map.getSource(RADAR_SOURCE_ID) as RasterSource | undefined;
    if (source?.setTiles && lastSourceSig === sig && map.getLayer(RADAR_LAYER_ID)) {
        source.setTiles([url]);
        map.setPaintProperty?.(RADAR_LAYER_ID, 'raster-opacity', state.opacity);
        return;
    }
    lastSourceSig = sig;
    if (map.getLayer(RADAR_LAYER_ID)) map.removeLayer(RADAR_LAYER_ID);
    if (map.getSource(RADAR_SOURCE_ID)) map.removeSource(RADAR_SOURCE_ID);
    map.addSource(RADAR_SOURCE_ID, {
        type: 'raster',
        tiles: [url],
        tileSize: 256,
        minzoom: 0,
        maxzoom: display.maxzoom,
        attribution: 'Radar: Iowa Environmental Mesonet',
    });
    map.addLayer({
        id: RADAR_LAYER_ID,
        type: 'raster',
        source: RADAR_SOURCE_ID,
        paint: {
            'raster-opacity': state.opacity,
            'raster-fade-duration': 0,
            'raster-resampling': 'linear',
        },
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
    lastSourceSig = '';
    autoSiteId.value = null;
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
        const now = Date.now();
        frames = loopable
            ? mosaicLoopStamps().map((stamp) => {
                const mins = Number(/^m(\d{2})m$/.exec(stamp)?.[1] ?? 0);
                return {
                    stamp,
                    label: mosaicFrameLabel(stamp),
                    at: now - mins * 60_000,
                };
            })
            : [];
        replayFramesRef.value = frames;
        liveValidAt.value = await fetchMosaicValidAt();
        return;
    }
    const product = currentProduct();
    const site = findSite(state.siteId);
    if (!product || !site) {
        frames = [];
        replayFramesRef.value = frames;
        liveValidAt.value = null;
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
    liveValidAt.value = frames.length ? frames[frames.length - 1].at : null;
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
        if (isMosaic(state.siteId)) {
            void fetchMosaicValidAt().then((at) => {
                if (at) liveValidAt.value = at;
                state.status = statusText();
            });
        } else if (frames.length) {
            liveValidAt.value = frames[frames.length - 1].at;
        }
        const map = mapOf();
        if (map) applyTiles(map);
        state.status = statusText();
    }, REFRESH_MS);
}

function onStyle(): void {
    const map = mapOf();
    if (!map) return;
    lastSourceSig = '';
    if (state.overlayEnabled) ensureRadarLayer(map);
    if (state.alertsEnabled && apiRef) startAlerts(apiRef);
    if (state.sitesOnMap && apiRef) startSiteMarkers(apiRef, onSitePicked);
}

function onViewChange(): void {
    if (!state.overlayEnabled || !isMosaic(state.siteId)) return;
    if (viewRaf) return;
    viewRaf = requestAnimationFrame(() => {
        viewRaf = 0;
        const map = mapOf();
        if (map && state.overlayEnabled) {
            applyTiles(map);
            state.status = statusText();
        }
    });
}

function onSitePicked(id: string): void {
    setSite(id);
    void applyRadarSettings();
    refreshSiteMarkers();
}

export function applySiteMarkers(): void {
    persist();
    if (!apiRef) return;
    if (state.sitesOnMap) {
        startSiteMarkers(apiRef, onSitePicked);
        refreshSiteMarkers();
    } else {
        stopSiteMarkers();
    }
}

export async function init(api: PluginAPI): Promise<void> {
    apiRef = api;
    protocolOn = await ensureFilterProtocol();
    const map = mapOf();
    if (map) {
        styleHandler = onStyle;
        viewHandler = onViewChange;
        map.on('style.load', styleHandler);
        map.on('zoom', viewHandler);
        map.on('moveend', viewHandler);
    }
    if (state.alertsEnabled) startAlerts(api);
    if (state.sitesOnMap) startSiteMarkers(api, onSitePicked);
}

export function destroy(): void {
    stopPlayTimer();
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    if (filterRaf) {
        cancelAnimationFrame(filterRaf);
        filterRaf = 0;
    }
    if (viewRaf) {
        cancelAnimationFrame(viewRaf);
        viewRaf = 0;
    }
    stopAlerts();
    stopSiteMarkers();
    const map = mapOf();
    if (map) {
        if (styleHandler) {
            try { map.off('style.load', styleHandler); } catch { /* ignore */ }
        }
        if (viewHandler) {
            try { map.off('zoom', viewHandler); } catch { /* ignore */ }
            try { map.off('moveend', viewHandler); } catch { /* ignore */ }
        }
        removeRadarLayer(map);
    }
    styleHandler = null;
    viewHandler = null;
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
    refreshSiteMarkers();
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
    const map = mapOf();
    map?.setPaintProperty?.(RADAR_LAYER_ID, 'raster-opacity', state.opacity);
}

export function applyFilter(): void {
    if (!state.overlayEnabled) return;
    if (filterRaf) return;
    filterRaf = requestAnimationFrame(() => {
        filterRaf = 0;
        const map = mapOf();
        if (map) applyTiles(map);
    });
}

export function applyAlerts(): void {
    persist();
    if (!apiRef) return;
    if (state.alertsEnabled) startAlerts(apiRef);
    else stopAlerts();
}

export async function setReplayIndex(index: number): Promise<void> {
    if (!frames.length || index < 0 || index >= frames.length) {
        state.replayIndex = -1;
        cacheBust = Date.now();
        const map = mapOf();
        if (map && state.overlayEnabled) applyTiles(map);
        state.status = statusText();
        return;
    }
    state.replayIndex = index;
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
