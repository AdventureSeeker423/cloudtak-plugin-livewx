/**
 * Atmosphere-style animated wind streaks over MapLibre (screen-space canvas).
 * Particles live in lon/lat and are advected from an Open-Meteo wind grid.
 */
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { getLayerOpacity, registerLayer } from '../layers/registry.ts';
import { boundsKey, fetchWindGrid, sampleGrid, type WindGrid } from './grid.ts';

const PARTICLES = 900;
const TRAIL = 36;
const DRAW_STEP = 3;
const FADES = 8;
const MAX_AGE = 200;
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

function ensureCanvas(map: LiveWxMap): void {
    if (canvas?.parentElement) return;
    const host = map.getCanvasContainer?.() || map.getContainer?.();
    if (!host) return;
    canvas = document.createElement('canvas');
    canvas.className = 'livewx-wind-canvas';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
    host.appendChild(canvas);
    ctx = canvas.getContext('2d');
    syncSize(map);
}

function syncSize(map: LiveWxMap): void {
    if (!canvas) return;
    const host = map.getCanvasContainer?.() || map.getContainer?.() || canvas.parentElement;
    if (!host) return;
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
    }
}

function respawn(i: number): void {
    const g = grid;
    const b = mapOf()?.getBounds?.();
    let w = g?.west ?? -180;
    let e = g?.east ?? 180;
    let s = g?.south ?? -85;
    let n = g?.north ?? 85;
    if (b) {
        w = Math.max(w, b.getWest());
        e = Math.min(e, b.getEast());
        s = Math.max(s, b.getSouth());
        n = Math.min(n, b.getNorth());
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
    len[i] = 0;
    age[i] = Math.floor(Math.random() * (MAX_AGE / 2));
    speed[i] = 0;
}

function metersPerPixel(map: LiveWxMap): number {
    const c = map.getCenter?.();
    const z = map.getZoom?.() ?? 5;
    if (!c) return 100;
    // WebMercator meters/pixel at lat, zoom
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
        if (!s || s.speed < 0.05) {
            respawn(i);
            continue;
        }
        speed[i] = s.speed;
        const metersPerDegLon = metersPerDegLat * Math.cos((lat[i] * Math.PI) / 180);
        lon[i] += (s.u * seconds) / Math.max(1e-6, metersPerDegLon);
        lat[i] += (s.v * seconds) / metersPerDegLat;
        const h = (head[i] + 1) % TRAIL;
        head[i] = h;
        tLon[i * TRAIL + h] = lon[i];
        tLat[i * TRAIL + h] = lat[i];
        if (len[i] < TRAIL) len[i]++;
        if (lon[i] < g.west || lon[i] > g.east || lat[i] < g.south || lat[i] > g.north) {
            respawn(i);
        }
    }
}

function draw(map: LiveWxMap): void {
    if (!ctx || !canvas || !map.project) return;
    syncSize(map);
    const dpr = canvas.width / (canvas.clientWidth || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    ctx.globalAlpha = opacity;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1.9;

    for (let i = 0; i < PARTICLES; i++) {
        const n = len[i];
        if (n < 2) continue;
        const band = bandIndex(speed[i]);
        const rgb = BAND_COLORS[band] || BAND_COLORS[0];
        const h = head[i];
        let prev: { x: number; y: number } | null = null;
        let seg = 0;
        for (let k = n - 1; k >= 0; k -= DRAW_STEP) {
            const idx = ((h - k) % TRAIL + TRAIL) % TRAIL;
            const p = map.project([tLon[i * TRAIL + idx], tLat[i * TRAIL + idx]]);
            if (!prev) {
                prev = p;
                continue;
            }
            const fade = Math.min(FADES - 1, Math.floor(((n - 1 - k) / Math.max(1, n - 1)) * FADES));
            const alpha = Math.round(235 * (((fade + 1) / FADES) ** 1.6));
            if (fade >= FADES / 2) {
                ctx.strokeStyle = `rgba(0,0,0,${(alpha / 255) * 0.55})`;
                ctx.lineWidth = 3.2;
                ctx.beginPath();
                ctx.moveTo(prev.x, prev.y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
            }
            ctx.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha / 255})`;
            ctx.lineWidth = 1.9;
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            prev = p;
            seg++;
            if (seg > 20) break;
        }
    }
    ctx.globalAlpha = 1;
}

function tick(): void {
    if (!running) return;
    const map = mapOf();
    if (map && grid) {
        step(map);
        draw(map);
    }
    tickTimer = setTimeout(tick, TICK_MS);
}

async function loadGrid(force = false): Promise<void> {
    if (!running) return;
    if (!force && Date.now() < backoffUntil) {
        statusText = 'Rate limited — retrying soon';
        return;
    }
    const b = mapOf()?.getBounds?.();
    if (b && !force) {
        const key = boundsKey({
            west: b.getWest(),
            east: b.getEast(),
            south: b.getSouth(),
            north: b.getNorth(),
        });
        // Skip tiny pans/zooms — keeps Open-Meteo under its free-tier budget.
        if (key === lastBoundsKey && grid) return;
        lastBoundsKey = key;
    }
    abort?.abort();
    abort = new AbortController();
    statusText = 'Loading…';
    try {
        const next = await fetchWindGrid(abort.signal);
        if (!running || !next) return;
        grid = next;
        for (let i = 0; i < PARTICLES; i++) respawn(i);
        statusText = `10 m · ${next.model}`;
        const map = mapOf();
        if (map) draw(map);
    } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        const msg = e instanceof Error ? e.message : 'Wind failed';
        if (/429|Too Many Requests/i.test(msg)) {
            backoffUntil = Date.now() + 60_000;
            statusText = 'Rate limited — wait ~1 min';
            return;
        }
        statusText = msg;
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
    attached = true;
}

function detachMap(map: LiveWxMap | null): void {
    if (map && attached) {
        try { map.off('moveend', onMoveEnd); } catch { /* ignore */ }
        try { map.off('resize', onResize); } catch { /* ignore */ }
    }
    attached = false;
    if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
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
            await loadGrid();
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
        },
        status: () => (running ? statusText : 'Off'),
    });
}
