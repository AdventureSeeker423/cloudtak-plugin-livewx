import type { PluginAPI } from '@tak-ps/cloudtak';
import {
    ALERT_FILL_ID,
    ALERT_LINE_ID,
    ALERT_POLL_MS,
    ALERT_SOURCE_ID,
    LIGHTNING_LAYER_ID,
    LIGHTNING_LEGACY_CIRCLE_ID,
    NWS_ALERTS_URL,
    RADAR_LAYER_ID,
    SITES_CIRCLE_ID,
    SITES_LABEL_ID,
    TRACKS_CELL_ID,
    TRACKS_FCST_ID,
    TRACKS_FCST_LINE_ID,
    TRACKS_LABEL_ID,
    TRACKS_LINE_ID,
} from './constants.ts';
import type { LiveWxMap } from './map-types.ts';
import { state } from './state.ts';
import { SURFACE_BG, SURFACE_BORDER, SURFACE_FG, syncSidebarTheme } from './theme.ts';

interface AlertProps {
    event?: string;
    headline?: string;
    instruction?: string;
    description?: string;
    expires?: string;
    severity?: string;
    fill?: string;
}

interface AlertFeature {
    type: 'Feature';
    geometry: {
        type: string;
        coordinates: unknown;
    } | null;
    properties: AlertProps;
}

interface AlertCollection {
    type: 'FeatureCollection';
    features: AlertFeature[];
}

const WATCH_OR_WARNING = /(watch|warning)$/i;

const FILL: Record<string, string> = {
    'Tornado Warning': '#ff0000',
    'Tornado Watch': '#ffff00',
    'Severe Thunderstorm Warning': '#ffa500',
    'Severe Thunderstorm Watch': '#db7093',
    'Flash Flood Warning': '#008000',
    'Flash Flood Watch': '#2e8b57',
    'Flood Warning': '#00ff00',
    'Flood Watch': '#90ee90',
    'Special Marine Warning': '#ffa500',
    'Extreme Wind Warning': '#ff8c00',
    'Blizzard Warning': '#ff4500',
    'Winter Storm Warning': '#ff69b4',
    'Winter Storm Watch': '#ffb6c1',
    'Ice Storm Warning': '#8b008b',
    'Hurricane Warning': '#dc143c',
    'Hurricane Watch': '#ff00ff',
    'Tropical Storm Warning': '#b22222',
    'Tropical Storm Watch': '#f08080',
    'Storm Warning': '#8b0000',
    'Storm Watch': '#cd5c5c',
    'Red Flag Warning': '#ff1493',
    'Fire Weather Watch': '#ffdead',
};

function colorForEvent(event: string): string {
    if (FILL[event]) return FILL[event];
    if (/tornado/i.test(event)) return /watch/i.test(event) ? '#ffff00' : '#ff0000';
    if (/thunder/i.test(event)) return /watch/i.test(event) ? '#db7093' : '#ffa500';
    if (/flood/i.test(event)) return /watch/i.test(event) ? '#2e8b57' : '#008000';
    if (/watch/i.test(event)) return '#ffff99';
    return '#ff6347';
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let mapRef: LiveWxMap | null = null;
let popup: { remove: () => void } | null = null;

const POPUP_STYLE_ID = 'livewx-alert-popup-style';

function ensurePopupStyle(): void {
    if (document.getElementById(POPUP_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = POPUP_STYLE_ID;
    el.textContent = `
.livewx-alert-popup .maplibregl-popup-content {
    color: ${SURFACE_FG};
    background: ${SURFACE_BG};
    border: 1px solid ${SURFACE_BORDER};
    padding: 12px 32px 12px 12px;
    border-radius: 8px;
    box-shadow: var(--tblr-box-shadow-lg, 0 4px 18px rgba(0, 0, 0, 0.35));
    font: 13px/1.45 var(--tblr-font-sans-serif, system-ui, Segoe UI, sans-serif);
}
.livewx-alert-popup .maplibregl-popup-close-button {
    color: var(--tblr-secondary, var(--bs-secondary-color, inherit));
    font-size: 18px;
    padding: 4px 8px;
}
.livewx-alert-popup .maplibregl-popup-close-button:hover {
    color: ${SURFACE_FG};
    background: transparent;
}
.livewx-alert-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip {
    border-top-color: ${SURFACE_BG};
}
.livewx-alert-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip {
    border-bottom-color: ${SURFACE_BG};
}
.livewx-alert-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip {
    border-right-color: ${SURFACE_BG};
}
.livewx-alert-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip {
    border-left-color: ${SURFACE_BG};
}
.livewx-alert-card {
    max-width: 400px;
    max-height: 60vh;
    overflow: auto;
}
.livewx-alert-title {
    color: ${SURFACE_FG};
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 8px;
}
.livewx-alert-body {
    color: ${SURFACE_FG};
}
.livewx-alert-body p {
    margin: 0 0 0.7em;
}
.livewx-alert-body p:last-child,
.livewx-alert-list:last-child {
    margin-bottom: 0;
}
.livewx-alert-list {
    margin: 0 0 0.7em;
    padding-left: 1.15em;
}
.livewx-alert-list li {
    margin: 0 0 0.35em;
}
`;
    document.head.appendChild(el);
}

function isWatchOrWarning(event: string): boolean {
    return WATCH_OR_WARNING.test(event.trim());
}

function emptyCollection(): AlertCollection {
    return { type: 'FeatureCollection', features: [] };
}

async function fetchAlerts(): Promise<AlertCollection> {
    const res = await fetch(NWS_ALERTS_URL, {
        headers: { Accept: 'application/geo+json' },
    });
    if (!res.ok) throw new Error(`NWS alerts HTTP ${res.status}`);
    const body = await res.json() as AlertCollection;
    const features = (body.features ?? []).filter((f) => {
        const event = f.properties?.event ?? '';
        if (!isWatchOrWarning(event)) return false;
        if (!f.geometry) return false;
        return f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon';
    }).map((f) => ({
        ...f,
        properties: {
            ...f.properties,
            fill: colorForEvent(f.properties?.event ?? ''),
        },
    }));
    return { type: 'FeatureCollection', features };
}

function firstSymbolLayer(map: LiveWxMap): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    const symbol = layers.find((l) => l.type === 'symbol');
    return symbol?.id;
}

function layerAfter(map: LiveWxMap, id: string): string | undefined {
    const layers = map.getStyle?.()?.layers ?? [];
    const i = layers.findIndex((l) => l.id === id);
    if (i < 0) return firstSymbolLayer(map);
    return layers[i + 1]?.id;
}

/** Fill under radar, outline immediately above radar. */
export function stackAlertLayers(map: LiveWxMap): void {
    if (map.getLayer(ALERT_FILL_ID) && map.getLayer(RADAR_LAYER_ID)) {
        try { map.moveLayer?.(ALERT_FILL_ID, RADAR_LAYER_ID); } catch { /* ignore */ }
    }
    if (map.getLayer(ALERT_LINE_ID) && map.getLayer(RADAR_LAYER_ID)) {
        const after = layerAfter(map, RADAR_LAYER_ID);
        if (after && after !== ALERT_LINE_ID) {
            try { map.moveLayer?.(ALERT_LINE_ID, after); } catch { /* ignore */ }
        } else if (!after) {
            try { map.moveLayer?.(ALERT_LINE_ID); } catch { /* ignore */ }
        }
    }
}

function ensureAlertLayers(map: LiveWxMap): void {
    if (!map.getSource(ALERT_SOURCE_ID)) {
        map.addSource(ALERT_SOURCE_ID, {
            type: 'geojson',
            data: emptyCollection(),
        });
    }
    const underRadar = map.getLayer(RADAR_LAYER_ID) ? RADAR_LAYER_ID : firstSymbolLayer(map);
    if (!map.getLayer(ALERT_FILL_ID)) {
        map.addLayer({
            id: ALERT_FILL_ID,
            type: 'fill',
            source: ALERT_SOURCE_ID,
            paint: {
                'fill-color': ['coalesce', ['get', 'fill'], '#ff0000'],
                'fill-opacity': 0.28,
            },
        }, underRadar);
    }
    if (!map.getLayer(ALERT_LINE_ID)) {
        const aboveRadar = map.getLayer(RADAR_LAYER_ID)
            ? layerAfter(map, RADAR_LAYER_ID)
            : firstSymbolLayer(map);
        map.addLayer({
            id: ALERT_LINE_ID,
            type: 'line',
            source: ALERT_SOURCE_ID,
            paint: {
                'line-color': ['coalesce', ['get', 'fill'], '#ff0000'],
                'line-width': 2,
                'line-opacity': 0.9,
            },
        }, aboveRadar);
    }
    stackAlertLayers(map);
}

function removeAlertLayers(map: LiveWxMap): void {
    try { if (map.getLayer(ALERT_LINE_ID)) map.removeLayer(ALERT_LINE_ID); } catch { /* ignore */ }
    try { if (map.getLayer(ALERT_FILL_ID)) map.removeLayer(ALERT_FILL_ID); } catch { /* ignore */ }
    try { if (map.getSource(ALERT_SOURCE_ID)) map.removeSource(ALERT_SOURCE_ID); } catch { /* ignore */ }
}

type GeoSource = { setData?: (data: unknown) => void };

async function refresh(map: LiveWxMap): Promise<void> {
    try {
        const data = await fetchAlerts();
        const source = map.getSource(ALERT_SOURCE_ID) as GeoSource | undefined;
        source?.setData?.(data);
        state.alertCount = data.features.length;
        state.error = '';
    } catch (err) {
        state.error = err instanceof Error ? err.message : 'Failed to load watches/warnings';
    }
}

function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function textOf(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

const SECTION_LINE = /^(HAZARD|SOURCE|IMPACT|LOCATIONS?|PRECAUTIONARY|AND\/OR|TIME\s+LINE|INSTRUCTIONS?)\b/i;

function unwrapNws(text: string): string[] {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/&&/g, '\n\n').split('\n');
    const paras: string[] = [];
    let buf = '';
    const flush = (): void => {
        const next = buf.replace(/\s+/g, ' ').trim();
        if (next) paras.push(next);
        buf = '';
    };
    for (const raw of lines) {
        const trimmed = raw.trim();
        if (!trimmed) {
            flush();
            continue;
        }
        if (trimmed.startsWith('*')) {
            flush();
            paras.push(trimmed.replace(/^\*+\s*/, '* '));
            continue;
        }
        if (SECTION_LINE.test(trimmed) || /^[A-Z][A-Z0-9 /.&-]{1,48}\.{2,}/.test(trimmed)) {
            flush();
            buf = trimmed;
            continue;
        }
        buf = buf ? `${buf} ${trimmed}` : trimmed;
    }
    flush();
    return paras;
}

function formatNwsText(text: string): string {
    const paras = unwrapNws(text);
    const chunks: string[] = [];
    let list: string[] = [];
    const flushList = (): void => {
        if (!list.length) return;
        chunks.push(`<ul class="livewx-alert-list">${list.map((item) => `<li>${item}</li>`).join('')}</ul>`);
        list = [];
    };
    for (const para of paras) {
        if (para.startsWith('* ')) {
            list.push(escapeHtml(para.slice(2)));
            continue;
        }
        flushList();
        chunks.push(`<p>${escapeHtml(para)}</p>`);
    }
    flushList();
    return chunks.join('');
}

function alertHtml(props: AlertProps): string {
    const headline = textOf(props.headline).replace(/\s+/g, ' ');
    const description = textOf(props.description);
    const instruction = textOf(props.instruction);
    const event = textOf(props.event);
    const parts: string[] = [];
    if (headline) parts.push(`<div class="livewx-alert-title">${escapeHtml(headline)}</div>`);
    else if (event) parts.push(`<div class="livewx-alert-title">${escapeHtml(event)}</div>`);
    if (description) parts.push(`<div class="livewx-alert-body">${formatNwsText(description)}</div>`);
    const descFlat = description.replace(/\s+/g, ' ');
    const instFlat = instruction.replace(/\s+/g, ' ');
    if (instruction && instFlat !== descFlat && !descFlat.includes(instFlat)) {
        parts.push(`<div class="livewx-alert-body">${formatNwsText(instruction)}</div>`);
    }
    return `<div class="livewx-alert-card">${parts.join('')}</div>`;
}

async function showPopup(
    map: LiveWxMap,
    lngLat: { lng: number; lat: number },
    props: AlertProps,
): Promise<void> {
    ensurePopupStyle();
    syncSidebarTheme();
    popup?.remove();
    const html = alertHtml(props);

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
            maxWidth: '420px',
            className: 'livewx-alert-popup',
        })
            .setLngLat(lngLat)
            .setHTML(html)
            .addTo(map);
    } catch {
        /* popup optional */
    }
}

const OVERLAY_HIT_LAYERS = [
    TRACKS_CELL_ID,
    TRACKS_LABEL_ID,
    TRACKS_LINE_ID,
    TRACKS_FCST_LINE_ID,
    TRACKS_FCST_ID,
    LIGHTNING_LAYER_ID,
    LIGHTNING_LEGACY_CIRCLE_ID,
    SITES_CIRCLE_ID,
    SITES_LABEL_ID,
];

function presentLayers(map: LiveWxMap, ids: string[]): string[] {
    return ids.filter((id) => Boolean(map.getLayer(id)));
}

function hitsAt(map: LiveWxMap, point: unknown, ids: string[]): Array<{ properties?: AlertProps }> {
    const layers = presentLayers(map, ids);
    if (!layers.length || !map.queryRenderedFeatures) return [];
    try {
        return map.queryRenderedFeatures(point, { layers }) as Array<{ properties?: AlertProps }>;
    } catch {
        return [];
    }
}

function onAlertClick(e: {
    lngLat?: { lng: number; lat: number };
    point?: unknown;
}): void {
    const map = mapRef;
    if (!map || !e.lngLat || e.point == null) return;
    if (hitsAt(map, e.point, OVERLAY_HIT_LAYERS).length) return;
    const hit = hitsAt(map, e.point, [ALERT_FILL_ID, ALERT_LINE_ID])[0];
    const props = hit?.properties;
    if (!props) return;
    void showPopup(map, e.lngLat, props);
}

export function startAlerts(api: PluginAPI): void {
    const map = api.map as unknown as LiveWxMap;
    mapRef = map;
    ensureAlertLayers(map);
    map.off('click', onAlertClick);
    map.off('click', ALERT_FILL_ID, onAlertClick);
    map.off('click', ALERT_LINE_ID, onAlertClick);
    map.on('click', onAlertClick);
    void refresh(map);
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
        if (mapRef) void refresh(mapRef);
    }, ALERT_POLL_MS);
}

export function stopAlerts(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    popup?.remove();
    popup = null;
    state.alertCount = 0;
    if (mapRef) {
        try { mapRef.off('click', onAlertClick); } catch { /* ignore */ }
        try { mapRef.off('click', ALERT_FILL_ID, onAlertClick); } catch { /* ignore */ }
        try { mapRef.off('click', ALERT_LINE_ID, onAlertClick); } catch { /* ignore */ }
        removeAlertLayers(mapRef);
    }
    mapRef = null;
}
