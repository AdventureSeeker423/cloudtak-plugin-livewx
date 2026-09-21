/**
 * NEXRAD storm cells and 60-minute forecast tracks from IEM attributes.
 * Client-side map overlay only (no TAK/CoT).
 */
import type { PluginAPI } from '@tak-ps/cloudtak';
import {
    IEM_NEXRAD_ATTR_URL,
    LIGHTNING_LAYER_ID,
    TRACK_POLL_MS,
    TRACKS_CELL_ID,
    TRACKS_FCST_ID,
    TRACKS_FCST_LINE_ID,
    TRACKS_LABEL_ID,
    TRACKS_LINE_ID,
    TRACKS_SOURCE_ID,
} from './constants.ts';
import { raiseLightningLayer } from './lightning.ts';
import type { LiveWxMap } from './map-types.ts';
import { coverageForSiteId, kmBetween } from './sites.ts';
import { state } from './state.ts';
import { SURFACE_BG, SURFACE_BORDER, SURFACE_FG, syncSidebarTheme } from './theme.ts';

interface AttrProps {
    nexrad?: string;
    storm_id?: string;
    tvs?: string;
    meso?: string;
    posh?: number | string;
    poh?: number | string;
    max_size?: number | string;
    vil?: number | string;
    max_dbz?: number | string;
    max_dbz_height?: number | string;
    top?: number | string;
    drct?: number | string;
    sknt?: number | string;
    range?: number | string;
    valid?: string;
}

interface AttrFeature {
    type: 'Feature';
    geometry?: { type: string; coordinates?: number[] } | null;
    properties?: AttrProps;
}

interface AttrCollection {
    type: 'FeatureCollection';
    features?: AttrFeature[];
}

type GeoFeature = {
    type: 'Feature';
    properties: Record<string, string | number>;
    geometry: { type: 'Point' | 'LineString'; coordinates: number[] | number[][] };
};

type GeoCollection = { type: 'FeatureCollection'; features: GeoFeature[] };
type GeoSource = { setData?: (data: unknown) => void };

const EARTH_KM = 6371.0088;
const NM_KM = 1.852;
const FCST_MIN = [15, 30, 45, 60];
const HISTORY_MIN = 60;
const SNAP_STEP_MIN = 5;
const MERGE_KM = 18;
const MERGE_DIR_DEG = 40;
const MERGE_SPEED_KT = 15;
const MAX_ATTR_RANGE_MI = 124;
const MIN_TRACK_KT = 5;
const MAX_TRACK_KT = 80;

type Cell = {
    lon: number;
    lat: number;
    nexrad: string;
    id: string;
    props: AttrProps;
    sknt: number;
    drct: number;
    range: number;
    score: number;
};

const POPUP_STYLE_ID = 'livewx-track-popup-style';

type PathPt = { lon: number; lat: number; at: number };
type Snap = { at: number; cells: Cell[] };

let pollTimer: ReturnType<typeof setInterval> | null = null;
let mapRef: LiveWxMap | null = null;
let popup: { remove: () => void } | null = null;
let snaps: Snap[] = [];
let backfillDone = false;

function num(value: unknown, fallback = 0): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function text(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function emptyCollection(): GeoCollection {
    return { type: 'FeatureCollection', features: [] };
}

const TRACK_COLOR = '#ffffff';
const TICK_HALF_KM = 1.6;

function dest(lon: number, lat: number, bearingDeg: number, km: number): number[] {
    const brng = bearingDeg * Math.PI / 180;
    const lat1 = lat * Math.PI / 180;
    const lon1 = lon * Math.PI / 180;
    const ang = km / EARTH_KM;
    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(ang)
        + Math.cos(lat1) * Math.sin(ang) * Math.cos(brng),
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(brng) * Math.sin(ang) * Math.cos(lat1),
        Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2),
    );
    let degLon = lon2 * 180 / Math.PI;
    if (degLon > 180) degLon -= 360;
    if (degLon < -180) degLon += 360;
    return [degLon, lat2 * 180 / Math.PI];
}

function distKm(a: { lon: number; lat: number }, lon: number, lat: number): number {
    const dLat = (lat - a.lat) * Math.PI / 180;
    const dLon = (lon - a.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function angleDiff(a: number, b: number): number {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

function stormQuality(props: AttrProps): number {
    let score = 0;
    const tvs = text(props.tvs).toUpperCase();
    if (tvs && tvs !== 'NONE' && tvs !== '0') score += 1000;
    const meso = text(props.meso);
    const mesoN = Number(meso);
    if (Number.isFinite(mesoN) && mesoN > 0) score += mesoN * 20;
    else if (meso && meso.toUpperCase() !== 'NONE' && meso !== '0') score += 80;
    score += num(props.posh) * 3;
    score += num(props.poh);
    score += num(props.max_size) * 50;
    score += num(props.vil) * 3;
    score += num(props.max_dbz);
    if (num(props.sknt) > 0) score += 25;
    score += Math.max(0, 100 - num(props.range)) * 0.5;
    return score;
}

function sameStorm(a: Cell, b: Cell): boolean {
    if (distKm({ lon: a.lon, lat: a.lat }, b.lon, b.lat) > MERGE_KM) return false;
    if (a.sknt >= 8 && b.sknt >= 8) {
        if (angleDiff(a.drct, b.drct) > MERGE_DIR_DEG) return false;
        if (Math.abs(a.sknt - b.sknt) > MERGE_SPEED_KT) return false;
    }
    return true;
}

function pickBest(cells: Cell[]): Cell[] {
    if (coverageForSiteId(state.siteId)) return cells;
    const sorted = [...cells].sort((a, b) => {
        if (a.range !== b.range) return a.range - b.range;
        return b.score - a.score;
    });
    const kept: Cell[] = [];
    for (const cell of sorted) {
        if (kept.some((other) => sameStorm(other, cell))) continue;
        kept.push(cell);
    }
    return kept;
}

function parseCells(raw: AttrCollection): Cell[] {
    const cov = coverageForSiteId(state.siteId);
    const cells: Cell[] = [];
    for (const f of raw.features ?? []) {
        const coords = f.geometry?.coordinates;
        if (!coords || f.geometry?.type !== 'Point' || coords.length < 2) continue;
        const lon = coords[0];
        const lat = coords[1];
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
        const props = f.properties ?? {};
        const nexrad = text(props.nexrad);
        const id = text(props.storm_id);
        if (!nexrad || !id) continue;
        if (cov && nexrad !== cov.iemId) continue;
        if (cov && kmBetween(cov.lat, cov.lon, lat, lon) > cov.km) continue;
        const range = num(props.range);
        if (range > MAX_ATTR_RANGE_MI) continue;
        cells.push({
            lon,
            lat,
            nexrad,
            id,
            props,
            sknt: num(props.sknt),
            drct: num(props.drct),
            range,
            score: stormQuality(props),
        });
    }
    return cells;
}

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const toRad = (d: number) => d * Math.PI / 180;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2))
        - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function observedMotion(path: PathPt[]): { heading: number; sknt: number } | null {
    if (path.length < 2) return null;
    const end = path[path.length - 1];
    let start: PathPt | null = null;
    let bestDelta = Infinity;
    for (let i = path.length - 2; i >= 0; i--) {
        const dtMin = (end.at - path[i].at) / 60_000;
        if (dtMin < 8 || dtMin > 28) continue;
        const delta = Math.abs(dtMin - 16);
        if (delta < bestDelta) {
            bestDelta = delta;
            start = path[i];
        }
    }
    if (!start) {
        for (let i = path.length - 2; i >= 0; i--) {
            const dtHr = (end.at - path[i].at) / 3_600_000;
            if (dtHr >= 4 / 60 && dtHr <= 0.45) {
                start = path[i];
                break;
            }
        }
    }
    if (!start) return null;
    const dtHr = (end.at - start.at) / 3_600_000;
    if (dtHr < 4 / 60) return null;
    const km = distKm(start, end.lon, end.lat);
    const sknt = (km / NM_KM) / dtHr;
    if (sknt < MIN_TRACK_KT || sknt > MAX_TRACK_KT) return null;
    return { heading: bearingDeg(start.lat, start.lon, end.lat, end.lon), sknt };
}

function tickFeature(label: string, lon: number, lat: number, heading: number): GeoFeature {
    return {
        type: 'Feature',
        properties: { kind: 'tick', label },
        geometry: {
            type: 'LineString',
            coordinates: [
                dest(lon, lat, heading - 90, TICK_HALF_KM),
                dest(lon, lat, heading + 90, TICK_HALF_KM),
            ],
        },
    };
}

function cellKey(cell: Cell): string {
    return `${cell.nexrad}-${cell.id}`;
}

function pathsFromSnaps(): Map<string, PathPt[]> {
    const paths = new Map<string, PathPt[]>();
    const ordered = [...snaps].sort((a, b) => a.at - b.at);
    for (const snap of ordered) {
        for (const cell of snap.cells) {
            const key = cellKey(cell);
            const pts = paths.get(key) ?? [];
            const last = pts[pts.length - 1];
            if (last && snap.at - last.at > 16 * 60_000) pts.length = 0;
            if (!last || distKm(last, cell.lon, cell.lat) >= 0.25 || snap.at - last.at >= 90_000) {
                pts.push({ lon: cell.lon, lat: cell.lat, at: snap.at });
            } else {
                last.lon = cell.lon;
                last.lat = cell.lat;
                last.at = snap.at;
            }
            paths.set(key, pts);
        }
    }
    return paths;
}

function cellValidAt(cell: Cell): number {
    const t = Date.parse(text(cell.props.valid));
    return Number.isFinite(t) ? t : Date.now();
}

function pushSnap(raw: AttrCollection): void {
    const groups = new Map<number, Cell[]>();
    for (const cell of parseCells(raw)) {
        const at = cellValidAt(cell);
        const list = groups.get(at) ?? [];
        list.push(cell);
        groups.set(at, list);
    }
    for (const [at, cells] of groups) {
        const existing = snaps.find((s) => Math.abs(s.at - at) < 90_000);
        if (existing) {
            const byKey = new Map(existing.cells.map((c) => [cellKey(c), c]));
            for (const cell of cells) byKey.set(cellKey(cell), cell);
            existing.cells = [...byKey.values()];
            continue;
        }
        snaps.push({ at, cells });
    }
    const cutoff = Date.now() - (HISTORY_MIN + 5) * 60_000;
    snaps = snaps.filter((s) => s.at >= cutoff);
}

function buildCollection(current: AttrCollection): GeoCollection {
    const features: GeoFeature[] = [];
    const paths = pathsFromSnaps();
    for (const cell of pickBest(parseCells(current))) {
        const { lon, lat, nexrad, id, props } = cell;
        const label = `${nexrad} ${id}`;
        const path = paths.get(cellKey(cell)) ?? [{ lon, lat, at: Date.now() }];
        if (path.length > 1) {
            features.push({
                type: 'Feature',
                properties: { kind: 'past', label },
                geometry: { type: 'LineString', coordinates: path.map((p) => [p.lon, p.lat]) },
            });
        }
        const observed = observedMotion(path);
        const heading = observed?.heading ?? num(props.drct);
        const sknt = observed?.sknt ?? num(props.sknt);
        const forecast: number[][] = [[lon, lat]];
        if (sknt >= MIN_TRACK_KT && sknt <= MAX_TRACK_KT) {
            for (const min of FCST_MIN) {
                const km = sknt * (min / 60) * NM_KM;
                const pt = dest(lon, lat, heading, km);
                forecast.push(pt);
                features.push(tickFeature(label, pt[0], pt[1], heading));
            }
            features.push({
                type: 'Feature',
                properties: { kind: 'forecast', label },
                geometry: { type: 'LineString', coordinates: forecast },
            });
        }
        features.push({
            type: 'Feature',
            properties: {
                kind: 'cell',
                label,
                nexrad,
                storm_id: id,
                tvs: text(props.tvs) || 'NONE',
                meso: text(props.meso) || 'NONE',
                posh: num(props.posh),
                poh: num(props.poh),
                max_size: num(props.max_size),
                vil: num(props.vil),
                max_dbz: num(props.max_dbz),
                max_dbz_height: num(props.max_dbz_height),
                top: num(props.top),
                drct: Math.round(heading),
                sknt: Math.round(sknt),
                valid: text(props.valid),
            },
            geometry: { type: 'Point', coordinates: [lon, lat] },
        });
    }
    return { type: 'FeatureCollection', features };
}

function beforeId(map: LiveWxMap): string | undefined {
    if (map.getLayer(LIGHTNING_LAYER_ID)) return LIGHTNING_LAYER_ID;
    return undefined;
}

function ensureLayers(map: LiveWxMap): void {
    if (!map.getSource(TRACKS_SOURCE_ID)) {
        map.addSource(TRACKS_SOURCE_ID, {
            type: 'geojson',
            data: emptyCollection(),
        });
    }
    const before = beforeId(map);
    if (!map.getLayer(TRACKS_LINE_ID)) {
        map.addLayer({
            id: TRACKS_LINE_ID,
            type: 'line',
            source: TRACKS_SOURCE_ID,
            filter: ['==', ['get', 'kind'], 'past'],
            paint: {
                'line-color': TRACK_COLOR,
                'line-width': 1.75,
                'line-opacity': 0.95,
            },
        }, before);
    }
    if (!map.getLayer(TRACKS_FCST_LINE_ID)) {
        map.addLayer({
            id: TRACKS_FCST_LINE_ID,
            type: 'line',
            source: TRACKS_SOURCE_ID,
            filter: ['==', ['get', 'kind'], 'forecast'],
            paint: {
                'line-color': TRACK_COLOR,
                'line-width': 1.75,
                'line-opacity': 0.95,
            },
        }, before);
    }
    try { if (map.getLayer(TRACKS_FCST_ID)) map.removeLayer(TRACKS_FCST_ID); } catch { /* ignore */ }
    map.addLayer({
        id: TRACKS_FCST_ID,
        type: 'line',
        source: TRACKS_SOURCE_ID,
        filter: ['==', ['get', 'kind'], 'tick'],
        paint: {
            'line-color': TRACK_COLOR,
            'line-width': 1.75,
            'line-opacity': 0.95,
        },
    }, before);
    if (!map.getLayer(TRACKS_CELL_ID)) {
        map.addLayer({
            id: TRACKS_CELL_ID,
            type: 'circle',
            source: TRACKS_SOURCE_ID,
            filter: ['==', ['get', 'kind'], 'cell'],
            paint: {
                'circle-radius': 3.5,
                'circle-color': TRACK_COLOR,
                'circle-stroke-color': '#000000',
                'circle-stroke-width': 1,
            },
        }, before);
    }
    if (!map.getLayer(TRACKS_LABEL_ID)) {
        map.addLayer({
            id: TRACKS_LABEL_ID,
            type: 'symbol',
            source: TRACKS_SOURCE_ID,
            filter: ['==', ['get', 'kind'], 'cell'],
            layout: {
                'text-field': ['get', 'label'],
                'text-size': 11,
                'text-offset': [0, 0.9],
                'text-anchor': 'top',
                'text-optional': true,
            },
            paint: {
                'text-color': TRACK_COLOR,
                'text-halo-color': '#000000',
                'text-halo-width': 1.25,
            },
        }, before);
    }
    raiseLightningLayer();
}

function removeLayers(map: LiveWxMap): void {
    try { if (map.getLayer(TRACKS_LABEL_ID)) map.removeLayer(TRACKS_LABEL_ID); } catch { /* ignore */ }
    try { if (map.getLayer(TRACKS_CELL_ID)) map.removeLayer(TRACKS_CELL_ID); } catch { /* ignore */ }
    try { if (map.getLayer(TRACKS_FCST_ID)) map.removeLayer(TRACKS_FCST_ID); } catch { /* ignore */ }
    try { if (map.getLayer(TRACKS_FCST_LINE_ID)) map.removeLayer(TRACKS_FCST_LINE_ID); } catch { /* ignore */ }
    try { if (map.getLayer(TRACKS_LINE_ID)) map.removeLayer(TRACKS_LINE_ID); } catch { /* ignore */ }
    try { if (map.getSource(TRACKS_SOURCE_ID)) map.removeSource(TRACKS_SOURCE_ID); } catch { /* ignore */ }
}

function attrUrl(atMs?: number): string {
    if (atMs == null) return IEM_NEXRAD_ATTR_URL;
    const valid = new Date(atMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return `${IEM_NEXRAD_ATTR_URL}?valid=${encodeURIComponent(valid)}`;
}

async function fetchAttrs(atMs?: number): Promise<AttrCollection> {
    const res = await fetch(attrUrl(atMs), {
        headers: { Accept: 'application/geo+json, application/json' },
    });
    if (!res.ok) throw new Error(`Storm Tracks HTTP ${res.status}`);
    return await res.json() as AttrCollection;
}

async function backfillHistory(): Promise<void> {
    if (backfillDone) return;
    const offsets: number[] = [];
    for (let min = SNAP_STEP_MIN; min <= HISTORY_MIN; min += SNAP_STEP_MIN) {
        offsets.push(min);
    }
    await Promise.all(offsets.map(async (min) => {
        try {
            pushSnap(await fetchAttrs(Date.now() - min * 60_000));
        } catch {
            /* older scan optional */
        }
    }));
    backfillDone = true;
}

async function refresh(map: LiveWxMap): Promise<void> {
    try {
        const current = await fetchAttrs();
        pushSnap(current);
        if (!backfillDone) await backfillHistory();
        const data = buildCollection(current);
        const src = map.getSource(TRACKS_SOURCE_ID) as GeoSource | undefined;
        src?.setData?.(data);
        state.trackCount = data.features.filter((f) => f.properties.kind === 'cell').length;
    } catch (err) {
        state.error = err instanceof Error ? err.message : 'Failed To Load Storm Tracks';
    }
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function ensurePopupStyle(): void {
    if (document.getElementById(POPUP_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = POPUP_STYLE_ID;
    el.textContent = `
.livewx-track-popup .maplibregl-popup-content {
    color: ${SURFACE_FG};
    background: ${SURFACE_BG};
    border: 1px solid ${SURFACE_BORDER};
    padding: 12px 32px 12px 12px;
    border-radius: 8px;
    box-shadow: var(--tblr-box-shadow-lg, 0 4px 18px rgba(0, 0, 0, 0.35));
    font: 13px/1.45 var(--tblr-font-sans-serif, system-ui, Segoe UI, sans-serif);
}
.livewx-track-popup .maplibregl-popup-close-button {
    color: var(--tblr-secondary, inherit);
    font-size: 18px;
    padding: 4px 8px;
}
.livewx-track-popup .maplibregl-popup-tip { border-top-color: ${SURFACE_BG}; }
.livewx-track-card { max-width: 280px; }
.livewx-track-title { font-size: 15px; font-weight: 700; margin-bottom: 8px; }
.livewx-track-card p { margin: 0 0 0.45em; }
.livewx-track-card p:last-child { margin-bottom: 0; }
`;
    document.head.appendChild(el);
}

function trackHtml(props: Record<string, unknown>): string {
    const label = text(props.label) || `${text(props.nexrad)} ${text(props.storm_id)}`;
    const lines = [
        `Motion ${num(props.drct)}° At ${num(props.sknt)} Kt`,
        `Max ${num(props.max_dbz)} Dbz · Top ${num(props.top)} Kft`,
        `Hail Posh ${num(props.posh)}% Poh ${num(props.poh)}% · ${num(props.max_size)} In`,
        `Tvs ${text(props.tvs) || 'NONE'} · Meso ${text(props.meso) || 'NONE'}`,
    ];
    const valid = text(props.valid);
    if (valid) lines.push(valid.replace('T', ' ').replace('Z', ' UTC'));
    return `<div class="livewx-track-card"><div class="livewx-track-title">${escapeHtml(label)}</div>${
        lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')
    }</div>`;
}

async function showPopup(
    map: LiveWxMap,
    lngLat: { lng: number; lat: number },
    props: Record<string, unknown>,
): Promise<void> {
    ensurePopupStyle();
    syncSidebarTheme();
    popup?.remove();
    try {
        const ml = await import('maplibre-gl') as {
            Popup?: new (opts: object) => {
                setLngLat: (ll: object) => { setHTML: (h: string) => { addTo: (m: unknown) => { remove: () => void } } };
                remove: () => void;
            };
            default?: { Popup?: new (opts: object) => {
                setLngLat: (ll: object) => { setHTML: (h: string) => { addTo: (m: unknown) => { remove: () => void } } };
                remove: () => void;
            } };
        };
        const Popup = ml.Popup ?? ml.default?.Popup;
        if (!Popup) return;
        popup = new Popup({
            closeButton: true,
            maxWidth: '300px',
            className: 'livewx-track-popup',
        })
            .setLngLat(lngLat)
            .setHTML(trackHtml(props))
            .addTo(map);
    } catch {
        /* popup optional */
    }
}

function onTrackClick(e: {
    lngLat?: { lng: number; lat: number };
    features?: Array<{ properties?: Record<string, unknown> }>;
}): void {
    const map = mapRef;
    if (!map || !e.lngLat) return;
    const props = e.features?.[0]?.properties;
    if (!props) return;
    void showPopup(map, e.lngLat, props);
}

export function refreshTracks(): void {
    snaps = [];
    backfillDone = false;
    if (mapRef) void refresh(mapRef);
}

export function startTracks(api: PluginAPI): void {
    const map = api.map as unknown as LiveWxMap;
    mapRef = map;
    try {
        ensureLayers(map);
        map.off('click', TRACKS_CELL_ID, onTrackClick);
        map.on('click', TRACKS_CELL_ID, onTrackClick);
        void refresh(map);
    } catch {
        /* style not ready */
    }
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        if (mapRef) void refresh(mapRef);
    }, TRACK_POLL_MS);
}

export function stopTracks(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    popup?.remove();
    popup = null;
    snaps = [];
    backfillDone = false;
    state.trackCount = 0;
    if (mapRef) {
        try { mapRef.off('click', TRACKS_CELL_ID, onTrackClick); } catch { /* ignore */ }
        removeLayers(mapRef);
    }
    mapRef = null;
}

export function restoreTracks(api: PluginAPI): void {
    if (!state.tracksEnabled) return;
    startTracks(api);
}
