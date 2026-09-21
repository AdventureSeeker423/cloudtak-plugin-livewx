import { reactive, ref } from 'vue';
import { CONUS_SITE_ID, DEFAULT_FILTER, DEFAULT_OPACITY, STORAGE_KEY } from './constants.ts';
import {
    MOSAIC_DEFAULT_PRODUCT_ID,
    SITE_DEFAULT_PRODUCT_ID,
    getProduct,
} from './products.ts';
import { isMosaic } from './sites.ts';

export interface PersistedSettings {
    siteId: string;
    productId: string;
    opacity: number;
    filter: number;
    alertsEnabled: boolean;
    sitesOnMap: boolean;
}

export interface LiveWxState extends PersistedSettings {
    overlayEnabled: boolean;
    playing: boolean;
    replayIndex: number;
    status: string;
    error: string;
    alertCount: number;
    selectedAlert: string;
}

function load(): PersistedSettings {
    const defaults: PersistedSettings = {
        siteId: CONUS_SITE_ID,
        productId: MOSAIC_DEFAULT_PRODUCT_ID,
        opacity: DEFAULT_OPACITY,
        filter: DEFAULT_FILTER,
        alertsEnabled: false,
        sitesOnMap: false,
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaults;
        const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
        return {
            siteId: typeof parsed.siteId === 'string' ? parsed.siteId : defaults.siteId,
            productId: typeof parsed.productId === 'string' ? parsed.productId : defaults.productId,
            opacity: clamp(Number(parsed.opacity), 0, 1, defaults.opacity),
            filter: clamp(Number(parsed.filter), 0, 75, defaults.filter),
            alertsEnabled: Boolean(parsed.alertsEnabled),
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
    status: 'Overlay off',
    error: '',
    alertCount: 0,
    selectedAlert: '',
});

export const siteQuery = ref('');

export function persist(): void {
    const payload: PersistedSettings = {
        siteId: state.siteId,
        productId: state.productId,
        opacity: state.opacity,
        filter: state.filter,
        alertsEnabled: state.alertsEnabled,
        sitesOnMap: state.sitesOnMap,
    };
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
        /* ignore quota */
    }
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

export function setOpacity(opacity: number): void {
    state.opacity = clamp(opacity, 0, 1, DEFAULT_OPACITY);
    persist();
}

export function setFilter(filter: number): void {
    state.filter = clamp(filter, 0, 75, DEFAULT_FILTER);
    persist();
}

export function setAlertsEnabled(enabled: boolean): void {
    state.alertsEnabled = enabled;
    persist();
}

export function setSitesOnMap(enabled: boolean): void {
    state.sitesOnMap = enabled;
    persist();
}
