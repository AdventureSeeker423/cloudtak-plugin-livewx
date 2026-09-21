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
const HISTORY_MAX = 8;
const MOVE_MIN_KM = 0.4;

const POPUP_STYLE_ID = 'livewx-track-popup-style';

let pollTimer: ReturnType<typeof setInterval> | null = null;
let mapRef: LiveWxMap | null = null;
let popup: { remove: () => void } | null = null;
const history = new Map<string, Array<{ lon: number; lat: number }>>();

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

function stormKey(nexrad: string, id: string): string {
    return `${nexrad}-${id}`;
}

function stormColor(props: AttrProps): string {
    const tvs = text(props.tvs).toUpperCase();
    if (tvs && tvs !== 'NONE' && tvs !== '0') return '#ff1744';
    const meso = text(props.meso).toUpperCase();
    if (meso && meso !== 'NONE' && meso !== '0') return '#ff9100';
    if (num(props.posh) >= 50 || num(props.max_size) >= 1) return '#ffd43b';
    if (num(props.poh) >= 50) return '#fab005';
    return '#66d9e8';
}

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

function remember(key: string, lon: number, lat: number): Array<{ lon: number; lat: number }> {
    const prev = history.get(key) ?? [];
    const last = prev[prev.length - 1];
    if (!last || distKm(last, lon, lat) >= MOVE_MIN_KM) {
        prev.push({ lon, lat });
    } else {
        last.lon = lon;
        last.lat = lat;
    }
    if (prev.length > HISTORY_MAX) prev.splice(0, prev.length - HISTORY_MAX);
    history.set(key, prev);
    return prev;
}

function buildCollection(raw: AttrCollection): GeoCollection {
    const features: GeoFeature[] = [];
    const seen = new Set<string>();
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
        const key = stormKey(nexrad, id);
        seen.add(key);
        const color = stormColor(props);
        const label = `${nexrad} ${id}`;
        const past = remember(key, lon, lat);
        const pastLine = past.map((p) => [p.lon, p.lat]);
        if (pastLine.length > 1) {
            features.push({
                type: 'Feature',
                properties: { kind: 'past', color, label },
                geometry: { type: 'LineString', coordinates: pastLine },
            });
        }
        const sknt = num(props.sknt);
        const drct = num(props.drct);
        const forecast: number[][] = [[lon, lat]];
        if (sknt > 0) {
            for (const min of FCST_MIN) {
                const km = sknt * (min / 60) * NM_KM;
                const pt = dest(lon, lat, drct, km);
                forecast.push(pt);
                features.push({
                    type: 'Feature',
                    properties: { kind: 'fcst', color, label, minutes: min },
                    geometry: { type: 'Point', coordinates: pt },
                });
            }
            features.push({
                type: 'Feature',
                properties: { kind: 'forecast', color, label },
                geometry: { type: 'LineString', coordinates: forecast },
            });
        }
        features.push({
            type: 'Feature',
            properties: {
                kind: 'cell',
                color,
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
                drct,
                sknt,
                valid: text(props.valid),
            },
            geometry: { type: 'Point', coordinates: [lon, lat] },
        });
    }
    for (const key of [...history.keys()]) {
        if (!seen.has(key)) history.delete(key);
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
                'line-color': ['coalesce', ['get', 'color'], '#66d9e8'],
                'line-width': 2,
                'line-opacity': 0.9,
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
                'line-color': ['coalesce', ['get', 'color'], '#66d9e8'],
                'line-width': 2,
                'line-opacity': 0.85,
                'line-dasharray': [3, 2],
            },
        }, before);
    }
    if (!map.getLayer(TRACKS_FCST_ID)) {
        map.addLayer({
            id: TRACKS_FCST_ID,
            type: 'circle',
            source: TRACKS_SOURCE_ID,
            filter: ['==', ['get', 'kind'], 'fcst'],
            paint: {
                'circle-radius': 3,
                'circle-color': ['coalesce', ['get', 'color'], '#66d9e8'],
                'circle-stroke-color': '#000000',
                'circle-stroke-width': 1,
                'circle-opacity': 0.9,
            },
        }, before);
    }
    if (!map.getLayer(TRACKS_CELL_ID)) {
        map.addLayer({
            id: TRACKS_CELL_ID,
            type: 'circle',
            source: TRACKS_SOURCE_ID,
            filter: ['==', ['get', 'kind'], 'cell'],
            paint: {
                'circle-radius': 6,
                'circle-color': ['coalesce', ['get', 'color'], '#66d9e8'],
                'circle-stroke-color': '#000000',
                'circle-stroke-width': 1.25,
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
                'text-offset': [0, 1.05],
                'text-anchor': 'top',
                'text-optional': true,
            },
            paint: {
                'text-color': ['coalesce', ['get', 'color'], '#66d9e8'],
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

async function fetchAttrs(): Promise<AttrCollection> {
    const res = await fetch(IEM_NEXRAD_ATTR_URL, {
        headers: { Accept: 'application/geo+json, application/json' },
    });
    if (!res.ok) throw new Error(`Storm Tracks HTTP ${res.status}`);
    return await res.json() as AttrCollection;
}

async function refresh(map: LiveWxMap): Promise<void> {
    try {
        const data = buildCollection(await fetchAttrs());
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
    history.clear();
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
