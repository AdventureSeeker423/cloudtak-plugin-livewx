import { reactive } from 'vue';
import {
    CONUS_SITE_ID,
    DEFAULT_FILTER,
    DEFAULT_LIGHTNING_STALE_SEC,
    DEFAULT_OPACITY,
    STORAGE_KEY,
} from './constants.ts';
import {
    MOSAIC_DEFAULT_PRODUCT_ID,
    SITE_DEFAULT_PRODUCT_ID,
    getProduct,
} from './products.ts';
import { isMosaic } from './sites.ts';

export interface PersistedSettings {
    siteId: string;
    productId: string;
    tilt: number;
    opacity: number;
    filter: number;
    alertsEnabled: boolean;
    lightningEnabled: boolean;
    lightningStaleSec: number;
    tracksEnabled: boolean;
    sitesOnMap: boolean;
}

export interface LiveWxState extends PersistedSettings {
    overlayEnabled: boolean;
    playing: boolean;
    replayIndex: number;
    status: string;
    error: string;
    alertCount: number;
    trackCount: number;
}

function load(): PersistedSettings {
    const defaults: PersistedSettings = {
        siteId: CONUS_SITE_ID,
        productId: MOSAIC_DEFAULT_PRODUCT_ID,
        tilt: 0,
        opacity: DEFAULT_OPACITY,
        filter: DEFAULT_FILTER,
        alertsEnabled: false,
        lightningEnabled: false,
        lightningStaleSec: DEFAULT_LIGHTNING_STALE_SEC,
        tracksEnabled: false,
        sitesOnMap: false,
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
        return {
            siteId: typeof parsed.siteId === 'string' ? parsed.siteId : defaults.siteId,
            productId: typeof parsed.productId === 'string' ? parsed.productId : defaults.productId,
            tilt: clamp(Number(parsed.tilt), 0, 9, defaults.tilt),
            opacity: clamp(Number(parsed.opacity), 0, 1, defaults.opacity),
            filter: clamp(Number(parsed.filter), 0, 75, defaults.filter),
            alertsEnabled: Boolean(parsed.alertsEnabled),
            lightningEnabled: Boolean(parsed.lightningEnabled),
            lightningStaleSec: clamp(
                Number(parsed.lightningStaleSec),
                15,
                600,
                defaults.lightningStaleSec,
            ),
            tracksEnabled: Boolean(parsed.tracksEnabled),
            sitesOnMap: Boolean(parsed.sitesOnMap),
        };
    } catch {
        return defaults;
    }
}

function clamp(n: number, min: number, max: number, fallback: number): number {
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
}

const persisted = load();

export const state = reactive<LiveWxState>({
    ...persisted,
    overlayEnabled: false,
    playing: false,
    replayIndex: -1,
    status: 'Overlay Off',
    error: '',
    alertCount: 0,
    trackCount: 0,
});

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function persist(): void {
    if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = null;
    }
    const payload: PersistedSettings = {
        siteId: state.siteId,
        productId: state.productId,
        tilt: state.tilt,
        opacity: state.opacity,
        filter: state.filter,
        alertsEnabled: state.alertsEnabled,
        lightningEnabled: state.lightningEnabled,
        lightningStaleSec: state.lightningStaleSec,
        tracksEnabled: state.tracksEnabled,
        sitesOnMap: state.sitesOnMap,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        /* ignore quota */
    }
}

/** Debounced persist for slider drags / wheel so the overlay can update immediately. */
export function persistSoon(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        persist();
    }, 300);
}

export function setSite(siteId: string): void {
    const wasMosaic = isMosaic(state.siteId);
    const nowMosaic = isMosaic(siteId);
    state.siteId = siteId;
    if (wasMosaic !== nowMosaic) {
        state.productId = nowMosaic ? MOSAIC_DEFAULT_PRODUCT_ID : SITE_DEFAULT_PRODUCT_ID;
    } else if (nowMosaic && !getProduct(state.productId)?.mosaicLayer) {
        state.productId = MOSAIC_DEFAULT_PRODUCT_ID;
    }
    state.replayIndex = -1;
    state.playing = false;
    persist();
}

export function setProduct(productId: string): void {
    state.productId = productId;
    persist();
}

export function setTilt(tilt: number): void {
    state.tilt = clamp(tilt, 0, 9, 0);
    persist();
}

export function setOpacity(opacity: number): void {
    state.opacity = clamp(opacity, 0, 1, DEFAULT_OPACITY);
    persistSoon();
}

export function setFilter(filter: number): void {
    state.filter = clamp(filter, 0, 75, DEFAULT_FILTER);
    persistSoon();
}

export function setAlertsEnabled(enabled: boolean): void {
    state.alertsEnabled = enabled;
    persist();
}

export function setLightningEnabled(enabled: boolean): void {
    state.lightningEnabled = enabled;
    persist();
}

export function setLightningStaleSec(sec: number): void {
    state.lightningStaleSec = clamp(sec, 15, 600, DEFAULT_LIGHTNING_STALE_SEC);
    persistSoon();
}

export function setTracksEnabled(enabled: boolean): void {
    state.tracksEnabled = enabled;
    persist();
}

export function setSitesOnMap(enabled: boolean): void {
    state.sitesOnMap = enabled;
    persist();
}
