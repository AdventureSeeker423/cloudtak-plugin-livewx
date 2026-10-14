/**
 * Atmosphere-style animated wind streaks over MapLibre (screen-space canvas).
 * Particles live in lon/lat and are advected from an Open-Meteo wind grid.
 */
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { getLayerOpacity, refreshStatus, registerLayer } from '../layers/registry.ts';
import { boundsKey, fetchWindGrid, sampleGrid, type WindGrid } from './grid.ts';

const PARTICLES = 900;
const TRAIL = 28;
const MAX_AGE = 220;
const PX_PER_FRAME_AT_6MS = 1.7;
const TICK_MS = 50;
const MOVE_SETTLE_MS = 1_200;
const REFRESH_MS = 15 * 60_000;

/** Speed band upper edges (m/s) matching Atmosphere WindView. */
const BAND_MAX_MS = [2, 5, 8, 12, 18];
const BAND_COLORS = [
    [184, 220, 255],
    [88, 180, 255],
    [88, 232, 144],
    [255, 232, 80],
    [255, 154, 48],
    [255, 64, 64],
];

let running = false;
let attached = false;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let grid: WindGrid | null = null;
let tickTimer: ReturnType<typeof setTimeout> | null = null;
let moveTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let abort: AbortController | null = null;
let statusText = 'Off';
let opacity = 0.85;
let lastBoundsKey = '';
let backoffUntil = 0;

const lon = new Float64Array(PARTICLES);
const lat = new Float64Array(PARTICLES);
const tLon = new Float64Array(PARTICLES * TRAIL);
const tLat = new Float64Array(PARTICLES * TRAIL);
const head = new Int16Array(PARTICLES);
const len = new Int16Array(PARTICLES);
const age = new Int16Array(PARTICLES);
const speed = new Float32Array(PARTICLES);

function bandIndex(ms: number): number {
    for (let i = 0; i < BAND_MAX_MS.length; i++) {
        if (ms < BAND_MAX_MS[i]) return i;
    }
    return BAND_MAX_MS.length;
}

function canvasHost(map: LiveWxMap): HTMLElement | null {
    const fromApi = map.getCanvasContainer?.() || map.getCanvas?.()?.parentElement || map.getContainer?.();
    if (fromApi) return fromApi;
    return document.querySelector('.maplibregl-canvas-container') as HTMLElement | null;
}

function ensureCanvas(map: LiveWxMap): void {
    if (canvas?.isConnected) {
        syncSize(map);
        return;
    }
    const host = canvasHost(map);
    if (!host) {
        statusText = 'Map canvas not ready';
        return;
    }
    if (getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
    }
    canvas = document.createElement('canvas');
    canvas.className = 'livewx-wind-canvas';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    host.appendChild(canvas);
    ctx = canvas.getContext('2d');
    syncSize(map);
}

function syncSize(map: LiveWxMap): void {
    if (!canvas) return;
    const host = canvas.parentElement || canvasHost(map);
    if (!host) return;
    const w = host.clientWidth || map.getCanvas?.()?.clientWidth || 1;
    const h = host.clientHeight || map.getCanvas?.()?.clientHeight || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const tw = Math.max(1, Math.round(w * dpr));
    const th = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
    }
}

/** Project lon/lat → CSS pixels; falls back if map.project is missing. */
function projectPoint(map: LiveWxMap, lng: number, latDeg: number): { x: number; y: number } | null {
    if (map.project) {
        try {
            const p = map.project({ lng, lat: latDeg });
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
        } catch { /* fall through */ }
        try {
            const p = map.project([lng, latDeg]);
            if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
        } catch { /* fall through */ }
    }
    const center = map.getCenter?.();
    const zoom = map.getZoom?.();
    const host = canvas?.parentElement || canvasHost(map);
    if (!center || zoom == null || !host) return null;
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    const scale = (512 * (2 ** zoom)) / 360;
    const x = (lng - center.lng) * scale * Math.cos((center.lat * Math.PI) / 180) + w / 2;
    const y = (center.lat - latDeg) * scale + h / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

function respawn(i: number): void {
    const g = grid;
    const b = mapOf()?.getBounds?.();
    let w = g?.west ?? -180;
    let e = g?.east ?? 180;
    let s = g?.south ?? -85;
    let n = g?.north ?? 85;
    if (b) {
        try {
            const bw = typeof b.getWest === 'function' ? b.getWest() : undefined;
            const be = typeof b.getEast === 'function' ? b.getEast() : undefined;
            const bs = typeof b.getSouth === 'function' ? b.getSouth() : undefined;
            const bn = typeof b.getNorth === 'function' ? b.getNorth() : undefined;
            if ([bw, be, bs, bn].every((v) => typeof v === 'number')) {
                w = Math.max(w, bw as number);
                e = Math.min(e, be as number);
                s = Math.max(s, bs as number);
                n = Math.min(n, bn as number);
            }
        } catch { /* keep grid extents */ }
    }
    if (!(e > w) || !(n > s)) {
        w = g?.west ?? -180;
        e = g?.east ?? 180;
        s = g?.south ?? -85;
        n = g?.north ?? 85;
    }
    lon[i] = w + Math.random() * (e - w);
    lat[i] = s + Math.random() * (n - s);
    head[i] = 0;
    tLon[i * TRAIL] = lon[i];
    tLat[i * TRAIL] = lat[i];
    len[i] = 1;
    age[i] = Math.floor(Math.random() * (MAX_AGE / 2));
    speed[i] = 0;
}

function metersPerPixel(map: LiveWxMap): number {
    const c = map.getCenter?.();
    const z = map.getZoom?.() ?? 5;
    if (!c) return 100;
    const latRad = (c.lat * Math.PI) / 180;
    return (156543.03392 * Math.cos(latRad)) / (2 ** z);
}

function step(map: LiveWxMap): void {
    const g = grid;
    if (!g) return;
    const mPerPx = Math.max(0.1, metersPerPixel(map));
    const seconds = (PX_PER_FRAME_AT_6MS * mPerPx) / 6;
    const metersPerDegLat = 111_320;
    for (let i = 0; i < PARTICLES; i++) {
        if (++age[i] > MAX_AGE) {
            respawn(i);
            continue;
        }
        const s = sampleGrid(g, lon[i], lat[i]);
        if (!s) {
            respawn(i);
            continue;
        }
        // Keep calm particles drifting slowly so trails still build.
        const spd = Math.max(s.speed, 0.15);
        const scale = spd / Math.max(s.speed, 1e-6);
        const u = s.u * scale;
        const v = s.v * scale;
        speed[i] = s.speed;
        const metersPerDegLon = metersPerDegLat * Math.max(0.2, Math.cos((lat[i] * Math.PI) / 180));
        lon[i] += (u * seconds) / metersPerDegLon;
        lat[i] += (v * seconds) / metersPerDegLat;
        if (lon[i] < g.west || lon[i] > g.east || lat[i] < g.south || lat[i] > g.north) {
            respawn(i);
            continue;
        }
        const h = (head[i] + 1) % TRAIL;
        head[i] = h;
        tLon[i * TRAIL + h] = lon[i];
        tLat[i * TRAIL + h] = lat[i];
        if (len[i] < TRAIL) len[i]++;
    }
}

function draw(map: LiveWxMap): void {
    if (!ctx || !canvas) return;
    syncSize(map);
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
    const dpr = canvas.width / cssW;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!grid) return;
    ctx.globalAlpha = Math.max(0.15, opacity);
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.8;

    for (let i = 0; i < PARTICLES; i++) {
        const n = len[i];
        if (n < 2) continue;
        const band = bandIndex(speed[i]);
        const rgb = BAND_COLORS[band] || BAND_COLORS[0];
        const h = head[i];
        ctx.beginPath();
        let started = false;
        let prevX = 0;
        let prevY = 0;
        for (let k = n - 1; k >= 0; k--) {
            const idx = ((h - k) % TRAIL + TRAIL) % TRAIL;
            const p = projectPoint(map, tLon[i * TRAIL + idx], tLat[i * TRAIL + idx]);
            if (!p) {
                started = false;
                continue;
            }
            // Drop segments that jump across the screen (antimeridian / wrap).
            if (started && (Math.abs(p.x - prevX) > cssW * 0.35 || Math.abs(p.y - prevY) > cssH * 0.35)) {
                started = false;
            }
            if (!started) {
                ctx.moveTo(p.x, p.y);
                started = true;
            } else {
                ctx.lineTo(p.x, p.y);
            }
            prevX = p.x;
            prevY = p.y;
        }
        if (!started) continue;
        const alpha = 0.55 + 0.45 * Math.min(1, speed[i] / 8);
        ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function tick(): void {
    if (!running) return;
    const map = mapOf();
    if (map) {
        ensureCanvas(map);
        if (grid) {
            step(map);
            draw(map);
        }
    }
    tickTimer = setTimeout(tick, TICK_MS);
}

function onRender(): void {
    if (!running || !grid) return;
    const map = mapOf();
    if (map) draw(map);
}

async function loadGrid(force = false): Promise<void> {
    if (!running) return;
    if (!force && Date.now() < backoffUntil) {
        statusText = 'Rate limited — retrying soon';
        return;
    }
    const map = mapOf();
    const b = map?.getBounds?.();
    if (b && !force) {
        try {
            const west = b.getWest?.();
            const east = b.getEast?.();
            const south = b.getSouth?.();
            const north = b.getNorth?.();
            if ([west, east, south, north].every((n) => typeof n === 'number')) {
                const key = boundsKey({
                    west: west as number,
                    east: east as number,
                    south: south as number,
                    north: north as number,
                });
                if (key === lastBoundsKey && grid) return;
                lastBoundsKey = key;
            }
        } catch { /* fetch anyway */ }
    }
    abort?.abort();
    abort = new AbortController();
    statusText = 'Loading…';
    try {
        const next = await fetchWindGrid(abort.signal);
        if (!running) return;
        if (!next) {
            statusText = 'Waiting for map view…';
            return;
        }
        grid = next;
        for (let i = 0; i < PARTICLES; i++) respawn(i);
        statusText = `10 m · ${next.model}`;
        if (map) {
            ensureCanvas(map);
            draw(map);
        }
        refreshStatus('surface_wind');
    } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Wind failed';
        if (/429|Too Many Requests/i.test(msg)) {
            backoffUntil = Date.now() + 60_000;
            statusText = 'Rate limited — wait ~1 min';
        } else {
            statusText = msg;
        }
        refreshStatus('surface_wind');
    }
}

function onMoveEnd(): void {
    if (!running) return;
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
        void loadGrid();
    }, MOVE_SETTLE_MS);
}

function onResize(): void {
    const map = mapOf();
    if (map) syncSize(map);
}

function attachMap(map: LiveWxMap): void {
    ensureCanvas(map);
    if (attached) return;
    map.on('moveend', onMoveEnd);
    map.on('resize', onResize);
    map.on('render', onRender);
    attached = true;
}

function detachMap(map: LiveWxMap | null): void {
    if (map && attached) {
        try { map.off('moveend', onMoveEnd); } catch { /* ignore */ }
        try { map.off('resize', onResize); } catch { /* ignore */ }
        try { map.off('render', onRender); } catch { /* ignore */ }
    }
    attached = false;
    canvas?.remove();
    canvas = null;
    ctx = null;
}

export function registerWindLayer(): void {
    registerLayer({
        id: 'surface_wind',
        group: 'wind',
        label: 'Surface Wind',
        description: 'Animated 10 m Wind Streaks',
        hosts: ['api.open-meteo.com'],
        sends: 'Wind grid',
        defaultOpacity: 0.85,
        applyOpacity: (n) => {
            opacity = n;
        },
        start: async () => {
            running = true;
            opacity = getLayerOpacity('surface_wind');
            const map = mapOf();
            if (map) attachMap(map);
            await loadGrid(true);
            if (!running) return;
            if (tickTimer) clearTimeout(tickTimer);
            tickTimer = setTimeout(tick, TICK_MS);
            if (refreshTimer) clearInterval(refreshTimer);
            refreshTimer = setInterval(() => {
                void loadGrid();
            }, REFRESH_MS);
        },
        stop: () => {
            running = false;
            if (tickTimer) {
                clearTimeout(tickTimer);
                tickTimer = null;
            }
            if (moveTimer) {
                clearTimeout(moveTimer);
                moveTimer = null;
            }
            if (refreshTimer) {
                clearInterval(refreshTimer);
                refreshTimer = null;
            }
            abort?.abort();
            abort = null;
            grid = null;
            lastBoundsKey = '';
            backoffUntil = 0;
            detachMap(mapOf());
            statusText = 'Off';
        },
        restore: (map) => {
            if (!running) return;
            attachMap(map);
            if (!tickTimer) tickTimer = setTimeout(tick, TICK_MS);
            if (grid) draw(map);
            else void loadGrid(true);
        },
        status: () => (running ? statusText : 'Off'),
    });
}
