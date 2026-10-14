/**
 * Point mode controller: self / map center / pick / favorite → state.queryLat/Lon.
 */
import type { PluginAPI } from '@tak-ps/cloudtak';
import { roundCoord } from './egress.ts';
import { mapOf } from './map-host.ts';
import { persist, state } from './state.ts';

let moveHandler: (() => void) | null = null;
let clickHandler: ((e: { lngLat?: { lat: number; lng: number } }) => void) | null = null;
let selfTimer: ReturnType<typeof setInterval> | null = null;
let apiRef: PluginAPI | null = null;

function apply(lat: number, lon: number, place?: string): void {
    state.queryLat = roundCoord(lat);
    state.queryLon = roundCoord(lon);
    if (place != null) state.placeName = place;
}

function fromCenter(): void {
    const map = mapOf();
    if (!map?.getCenter) return;
    const c = map.getCenter();
    if (c && typeof c.lat === 'number' && typeof c.lng === 'number') {
        apply(c.lat, c.lng);
    }
}

function fromFavorite(): void {
    const fav = state.favorites.find((f) => f.id === state.favoriteId);
    if (fav) apply(fav.lat, fav.lon, fav.name);
}

function fromPick(): void {
    if (state.pickLat != null && state.pickLon != null) {
        apply(state.pickLat, state.pickLon, 'Picked point');
    } else {
        fromCenter();
    }
}

async function fromSelf(): Promise<void> {
    try {
        if (!navigator.geolocation) {
            fromCenter();
            return;
        }
        await new Promise<void>((resolve) => {
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    apply(pos.coords.latitude, pos.coords.longitude, 'My position');
                    resolve();
                },
                () => {
                    fromCenter();
                    resolve();
                },
                { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
            );
        });
    } catch {
        fromCenter();
    }
}

export async function refreshQueryPoint(): Promise<void> {
    switch (state.pointMode) {
        case 'self':
            await fromSelf();
            break;
        case 'favorite':
            fromFavorite();
            break;
        case 'pick':
            fromPick();
            break;
        case 'center':
        default:
            fromCenter();
            break;
    }
}

export function initPointController(api: PluginAPI): void {
    apiRef = api;
    const map = mapOf();
    if (map) {
        moveHandler = () => {
            if (state.pointMode === 'center') fromCenter();
        };
        map.on('moveend', moveHandler);
        clickHandler = (e) => {
            if (state.pointMode !== 'pick') return;
            const ll = e.lngLat;
            if (!ll) return;
            state.pickLat = roundCoord(ll.lat);
            state.pickLon = roundCoord(ll.lng);
            apply(state.pickLat, state.pickLon, 'Picked point');
            persist();
        };
        map.on('click', clickHandler);
    }
    if (selfTimer) clearInterval(selfTimer);
    selfTimer = setInterval(() => {
        if (state.pointMode === 'self') void fromSelf();
    }, 60_000);
    void refreshQueryPoint();
    void apiRef;
}

export function destroyPointController(): void {
    const map = mapOf();
    if (map) {
        if (moveHandler) {
            try { map.off('moveend', moveHandler); } catch { /* ignore */ }
        }
        if (clickHandler) {
            try { map.off('click', clickHandler); } catch { /* ignore */ }
        }
    }
    if (selfTimer) {
        clearInterval(selfTimer);
        selfTimer = null;
    }
    moveHandler = null;
    clickHandler = null;
    apiRef = null;
}
