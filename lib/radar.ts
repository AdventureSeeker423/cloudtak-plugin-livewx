import { ref } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { startAlerts, stopAlerts } from './alerts.ts';
import { attachRadarAgeControl, detachRadarAgeControl, setRadarAge } from './age-control.ts';
import {
    MOSAIC_MAXZOOM,
    RADAR_LAYER_ID,
    RADAR_SOURCE_ID,
    REFRESH_MS,
    RIDGE_MAXZOOM,
} from './constants.ts';
import {
    applyLightning,
    destroyLightning,
    initLightning,
    raiseLightningLayer,
    restoreLightningLayers,
} from './lightning.ts';
import type { LiveWxMap } from './map-types.ts';
import {
    FALLBACK_SITE_CODES,
    availableTilts,
    getProduct,
    mosaicProducts,
    productsForSite,
    siteCode,
} from './products.ts';
import type { RadarProduct } from './products.ts';
import { refreshSiteMarkers, startSiteMarkers, stopSiteMarkers } from './site-markers.ts';
import { findSite, isMosaic, toIemId } from './sites.ts';
import { persist, setSite, state } from './state.ts';
import { restoreTracks, startTracks, stopTracks } from './tracks.ts';
import { syncSidebarTheme } from './theme.ts';
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
export const liveValidAt = ref<number | null>(null);
let styleHandler: (() => void) | null = null;
let lastSourceSig = '';
let filterRaf = 0;

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

function currentImageAt(): number | null {
    if (state.replayIndex >= 0 && frames[state.replayIndex]) {
        return frames[state.replayIndex].at;
    }
    return liveValidAt.value;
}

function statusText(): string {
    if (!state.overlayEnabled) {
        setRadarAge(null, false);
        return 'Overlay Off';
    }
    setRadarAge(currentImageAt(), true);
    const product = currentProduct();
    const site = findSite(state.siteId);
    const where = site ? (isMosaic(site.id) ? 'CONUS mosaic' : site.id) : state.siteId;
    const frame = state.replayIndex >= 0 && frames[state.replayIndex]
        ? ageLabel(frames[state.replayIndex].at)
        : (liveValidAt.value != null ? `Live · ${ageLabel(liveValidAt.value)}` : 'Live');
    return `${where} · ${product?.label ?? state.productId} · ${frame}`;
}

function displaySite(): { siteId: string; siteType: string; maxzoom: number } {
    if (!isMosaic(state.siteId)) {
        const site = findSite(state.siteId);
        return {
            siteId: state.siteId,
            siteType: site?.type ?? 'wsr88d',
            maxzoom: RIDGE_MAXZOOM,
        };
    }
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
        tilt: state.tilt,
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
    raiseLightningLayer();
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
    let changed = false;
    if (!visible.some((p) => p.id === state.productId)) {
        const fallback = visible.find((p) => p.category === 'REF') ?? visible[0];
        if (fallback) {
            state.productId = fallback.id;
            changed = true;
        }
    }
    const product = currentProduct();
    const site = findSite(state.siteId);
    const tilts = availableTilts(product, site?.type ?? 'wsr88d', availableCodes.value);
    if (tilts.length && !tilts.includes(state.tilt)) {
        state.tilt = tilts[0];
        changed = true;
    }
    if (changed) persist();
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
        siteCode(product, site.type, state.tilt),
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
    attachRadarAgeControl(map);
    if (state.alertsEnabled && apiRef) startAlerts(apiRef);
    if (state.sitesOnMap && apiRef) startSiteMarkers(apiRef, onSitePicked);
    if (apiRef) restoreTracks(apiRef);
    restoreLightningLayers();
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
    initLightning(api);
    const map = mapOf();
    if (map) {
        styleHandler = onStyle;
        map.on('style.load', styleHandler);
        attachRadarAgeControl(map);
    }
    if (state.alertsEnabled) startAlerts(api);
    if (state.sitesOnMap) startSiteMarkers(api, onSitePicked);
    if (state.tracksEnabled) startTracks(api);
    if (state.lightningEnabled) applyLightning();
    syncSidebarTheme();
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
    stopAlerts();
    stopSiteMarkers();
    stopTracks();
    destroyLightning();
    const map = mapOf();
    if (map) {
        if (styleHandler) {
            try { map.off('style.load', styleHandler); } catch { /* ignore */ }
        }
        removeRadarLayer(map);
    }
    detachRadarAgeControl();
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
        setRadarAge(null, false);
        state.status = 'Overlay Off';
        return;
    }
    cacheBust = Date.now();
    await loadAvailable();
    await loadFrames();
    if (map) {
        ensureRadarLayer(map);
        attachRadarAgeControl(map);
    }
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

export function applyLightningToggle(): void {
    persist();
    applyLightning();
}

export function applyTracks(): void {
    persist();
    if (!apiRef) return;
    if (state.tracksEnabled) startTracks(apiRef);
    else stopTracks();
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
