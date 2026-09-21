/**
 * Live Blitzortung strikes in the current map view.
 * Protocol adapted from https://github.com/cmlaird/CloudTAK-Plugin-Lightning (MIT).
 * Data: Blitzortung.org & contributors — entertainment use only.
 */
import { reactive } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { LIGHTNING_LAYER_ID, LIGHTNING_SOURCE_ID } from './constants.ts';
import type { LiveWxMap } from './map-types.ts';
import { state } from './state.ts';

export interface Strike {
    id: string;
    lat: number;
    lon: number;
    timeMs: number;
}

export interface VisibleStrike extends Strike {
    distMi: number;
    compass: string;
}

const WS_SERVERS = [
    'wss://ws1.blitzortung.org',
    'wss://ws7.blitzortung.org',
    'wss://ws8.blitzortung.org',
];

const COMPASS = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
];

const PAD = 0.08;

export const lightning = reactive({
    connected: false,
    error: '',
    totalSeen: 0,
    strikes: [] as Strike[],
    inView: [] as VisibleStrike[],
});

type GeoSource = { setData?: (data: unknown) => void };

let apiRef: PluginAPI | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let serverIdx = Math.floor(Math.random() * WS_SERVERS.length);
let viewHandler: (() => void) | null = null;
let running = false;

function mapOf(): LiveWxMap | null {
    try {
        return (apiRef?.map as unknown as LiveWxMap) ?? null;
    } catch {
        return null;
    }
}

function lzwDecode(input: string): string {
    const dict: Record<number, string> = {};
    const data = input.split('');
    let currChar = data[0];
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    let phrase: string;

    for (let i = 1; i < data.length; i++) {
        const currCode = data[i].charCodeAt(0);
        if (currCode < 256) {
            phrase = data[i];
        } else {
            phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join('');
}

function toRad(d: number): number {
    return d * Math.PI / 180;
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3958.7613;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingCompass(lat1: number, lon1: number, lat2: number, lon2: number): string {
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
        - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return COMPASS[Math.round(brg / 22.5) % 16];
}

function paddedBounds(): { west: number; east: number; south: number; north: number } | null {
    const map = mapOf();
    const b = map?.getBounds?.();
    if (!b) return null;
    const west = b.getWest();
    const east = b.getEast();
    const south = b.getSouth();
    const north = b.getNorth();
    const lngPad = Math.max(0.01, Math.abs(east - west) * PAD);
    const latPad = Math.max(0.01, Math.abs(north - south) * PAD);
    return {
        west: west - lngPad,
        east: east + lngPad,
        south: Math.max(-90, south - latPad),
        north: Math.min(90, north + latPad),
    };
}

function inBounds(lat: number, lon: number, box: { west: number; east: number; south: number; north: number }): boolean {
    if (lat < box.south || lat > box.north) return false;
    if (box.west <= box.east) return lon >= box.west && lon <= box.east;
    return lon >= box.west || lon <= box.east;
}

function firstSymbolLayer(map: LiveWxMap): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
}

function emptyCollection(): { type: 'FeatureCollection'; features: [] } {
    return { type: 'FeatureCollection', features: [] };
}

function cutoffMs(): number {
    return Date.now() - state.lightningStaleSec * 1000;
}

function pruneStrikes(): void {
    const cutoff = cutoffMs();
    if (lightning.strikes.length && lightning.strikes[0].timeMs < cutoff) {
        lightning.strikes = lightning.strikes.filter((s) => s.timeMs >= cutoff);
    }
}

function visibleStrikes(): VisibleStrike[] {
    const box = paddedBounds();
    const center = mapOf()?.getCenter?.();
    const list = box
        ? lightning.strikes.filter((s) => inBounds(s.lat, s.lon, box))
        : lightning.strikes;
    if (!center) {
        return list.map((s) => ({ ...s, distMi: 0, compass: '' }));
    }
    return list.map((s) => ({
        ...s,
        distMi: haversineMiles(center.lat, center.lng, s.lat, s.lon),
        compass: bearingCompass(center.lat, center.lng, s.lat, s.lon),
    }));
}

function renderStrikes(): void {
    const map = mapOf();
    const src = map?.getSource(LIGHTNING_SOURCE_ID) as GeoSource | undefined;
    if (!src?.setData) return;
    const now = Date.now();
    const staleMs = Math.max(1, state.lightningStaleSec) * 1000;
    const shown = visibleStrikes();
    lightning.inView = shown;
    src.setData({
        type: 'FeatureCollection',
        features: shown.map((s) => ({
            type: 'Feature',
            properties: {
                ageFrac: Math.min(1, Math.max(0, (now - s.timeMs) / staleMs)),
            },
            geometry: {
                type: 'Point',
                coordinates: [s.lon, s.lat],
            },
        })),
    });
}

function ensureLayers(): void {
    const map = mapOf();
    if (!map) return;
    try {
        if (!map.getSource(LIGHTNING_SOURCE_ID)) {
            map.addSource(LIGHTNING_SOURCE_ID, {
                type: 'geojson',
                data: emptyCollection(),
            });
        }
        if (!map.getLayer(LIGHTNING_LAYER_ID)) {
            map.addLayer({
                id: LIGHTNING_LAYER_ID,
                type: 'circle',
                source: LIGHTNING_SOURCE_ID,
                paint: {
                    'circle-color': [
                        'interpolate', ['linear'], ['get', 'ageFrac'],
                        0.0, '#ffffff',
                        0.25, '#ffec99',
                        0.5, '#ffa94d',
                        1.0, '#c92a2a',
                    ],
                    'circle-radius': [
                        'interpolate', ['linear'], ['get', 'ageFrac'],
                        0.0, 7,
                        1.0, 3,
                    ],
                    'circle-opacity': [
                        'interpolate', ['linear'], ['get', 'ageFrac'],
                        0.0, 1.0,
                        1.0, 0.4,
                    ],
                    'circle-stroke-color': '#000000',
                    'circle-stroke-width': 1,
                },
            }, firstSymbolLayer(map));
        }
    } catch {
        /* style not ready */
    }
}

function onViewChange(): void {
    if (!state.lightningEnabled) return;
    renderStrikes();
}

function bindView(): void {
    const map = mapOf();
    if (!map || viewHandler) return;
    viewHandler = onViewChange;
    map.on('moveend', viewHandler);
    map.on('zoomend', viewHandler);
}

function unbindView(): void {
    const map = mapOf();
    if (map && viewHandler) {
        try { map.off('moveend', viewHandler); } catch { /* ignore */ }
        try { map.off('zoomend', viewHandler); } catch { /* ignore */ }
    }
    viewHandler = null;
}

function scheduleReconnect(): void {
    if (reconnectTimer || !running) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, 3000);
}

function onStrike(lat: number, lon: number, timeMs: number): void {
    lightning.totalSeen++;
    lightning.strikes.push({
        id: `${timeMs}-${Math.round(lat * 1e4)}-${Math.round(lon * 1e4)}`,
        lat,
        lon,
        timeMs,
    });
    if (lightning.strikes.length > 5000) {
        lightning.strikes = lightning.strikes.slice(-4000);
    }
    renderStrikes();
}

function connect(): void {
    if (!running) return;
    const url = WS_SERVERS[serverIdx % WS_SERVERS.length];
    serverIdx++;
    try {
        ws = new WebSocket(url);
    } catch {
        lightning.error = 'Lightning Feed Blocked Or Unavailable';
        scheduleReconnect();
        return;
    }

    ws.onopen = () => {
        lightning.connected = true;
        lightning.error = '';
        ws?.send(JSON.stringify({ a: 111 }));
    };

    ws.onmessage = (evt: MessageEvent) => {
        try {
            const decoded = lzwDecode(String(evt.data));
            const rec = JSON.parse(decoded) as { lat?: number; lon?: number; time?: number };
            if (typeof rec.lat !== 'number' || typeof rec.lon !== 'number') return;
            onStrike(rec.lat, rec.lon, rec.time ? Math.round(rec.time / 1e6) : Date.now());
        } catch {
            /* non-strike frame */
        }
    };

    ws.onclose = () => {
        lightning.connected = false;
        if (running) {
            lightning.error = lightning.error || 'Reconnecting…';
            scheduleReconnect();
        }
    };

    ws.onerror = () => {
        lightning.connected = false;
        lightning.error = 'Lightning Feed Error (Check CSP For Blitzortung Websocket)';
        try { ws?.close(); } catch { /* ignore */ }
    };
}

export function initLightning(api: PluginAPI): void {
    apiRef = api;
}

export function startLightning(): void {
    if (!apiRef) return;
    lightning.error = '';
    ensureLayers();
    unbindView();
    bindView();
    if (!running) {
        running = true;
        connect();
        if (pruneTimer) clearInterval(pruneTimer);
        pruneTimer = setInterval(() => {
            pruneStrikes();
            renderStrikes();
        }, 1000);
    }
    renderStrikes();
}

export function stopLightning(): void {
    running = false;
    lightning.connected = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (pruneTimer) {
        clearInterval(pruneTimer);
        pruneTimer = null;
    }
    if (ws) {
        try { ws.close(); } catch { /* ignore */ }
        ws = null;
    }
    unbindView();
}

export function restoreLightningLayers(): void {
    if (!state.lightningEnabled) return;
    ensureLayers();
    unbindView();
    bindView();
    renderStrikes();
}

function removeLayers(): void {
    const map = mapOf();
    if (!map) return;
    try { if (map.getLayer(LIGHTNING_LAYER_ID)) map.removeLayer(LIGHTNING_LAYER_ID); } catch { /* ignore */ }
    try { if (map.getSource(LIGHTNING_SOURCE_ID)) map.removeSource(LIGHTNING_SOURCE_ID); } catch { /* ignore */ }
}

export function destroyLightning(): void {
    stopLightning();
    lightning.strikes = [];
    lightning.inView = [];
    lightning.totalSeen = 0;
    lightning.error = '';
    removeLayers();
    apiRef = null;
}

export function applyLightning(): void {
    if (state.lightningEnabled) startLightning();
    else {
        stopLightning();
        lightning.strikes = [];
        lightning.inView = [];
        lightning.totalSeen = 0;
        lightning.error = '';
        const map = mapOf();
        const src = map?.getSource(LIGHTNING_SOURCE_ID) as GeoSource | undefined;
        src?.setData?.(emptyCollection());
    }
}
