import type { PluginAPI } from '@tak-ps/cloudtak';
import { ALERT_FILL_ID, ALERT_LINE_ID, ALERT_POLL_MS, ALERT_SOURCE_ID, NWS_ALERTS_URL } from './constants.ts';
import type { LiveWxMap } from './map-types.ts';
import { state } from './state.ts';

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
    color: var(--tblr-body-color, var(--bs-body-color, inherit));
    background: var(--tblr-bg-surface, var(--bs-tertiary-bg, var(--bs-body-bg, Canvas)));
    border: 1px solid var(--tblr-border-color, var(--bs-border-color, rgba(127, 127, 127, 0.35)));
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
    color: var(--tblr-body-color, var(--bs-body-color, inherit));
    background: transparent;
}
.livewx-alert-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip {
    border-top-color: var(--tblr-bg-surface, var(--bs-tertiary-bg, var(--bs-body-bg, Canvas)));
}
.livewx-alert-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip,
.livewx-alert-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip {
    border-bottom-color: var(--tblr-bg-surface, var(--bs-tertiary-bg, var(--bs-body-bg, Canvas)));
}
.livewx-alert-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip {
    border-right-color: var(--tblr-bg-surface, var(--bs-tertiary-bg, var(--bs-body-bg, Canvas)));
}
.livewx-alert-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip {
    border-left-color: var(--tblr-bg-surface, var(--bs-tertiary-bg, var(--bs-body-bg, Canvas)));
}
.livewx-alert-card {
    max-width: 280px;
}
.livewx-alert-title {
    color: var(--tblr-body-color, var(--bs-body-color, inherit));
    font-size: 15px;
    font-weight: 700;
}
.livewx-alert-body {
    color: var(--tblr-body-color, var(--bs-body-color, inherit));
    margin-top: 6px;
}
.livewx-alert-meta {
    color: var(--tblr-secondary, var(--bs-secondary-color, inherit));
    margin-top: 6px;
    font-size: 12px;
}
.livewx-alert-instruction {
    color: var(--tblr-body-color, var(--bs-body-color, inherit));
    margin-top: 8px;
    white-space: pre-wrap;
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

function ensureAlertLayers(map: LiveWxMap): void {
    if (!map.getSource(ALERT_SOURCE_ID)) {
        map.addSource(ALERT_SOURCE_ID, {
            type: 'geojson',
            data: emptyCollection(),
        });
    }
    if (!map.getLayer(ALERT_FILL_ID)) {
        map.addLayer({
            id: ALERT_FILL_ID,
            type: 'fill',
            source: ALERT_SOURCE_ID,
            paint: {
                'fill-color': ['coalesce', ['get', 'fill'], '#ff0000'],
                'fill-opacity': 0.28,
            },
        }, firstSymbolLayer(map));
    }
    if (!map.getLayer(ALERT_LINE_ID)) {
        map.addLayer({
            id: ALERT_LINE_ID,
            type: 'line',
            source: ALERT_SOURCE_ID,
            paint: {
                'line-color': ['coalesce', ['get', 'fill'], '#ff0000'],
                'line-width': 2,
                'line-opacity': 0.9,
            },
        }, firstSymbolLayer(map));
    }
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

async function showPopup(
    map: LiveWxMap,
    lngLat: { lng: number; lat: number },
    props: AlertProps,
): Promise<void> {
    ensurePopupStyle();
    popup?.remove();
    const event = props.event ?? 'Alert';
    const headline = props.headline ?? '';
    const expires = props.expires ? `Expires ${props.expires}` : '';
    const instruction = props.instruction ?? '';
    const html = `<div class="livewx-alert-card">
        <div class="livewx-alert-title">${escapeHtml(event)}</div>
        ${headline ? `<div class="livewx-alert-body">${escapeHtml(headline)}</div>` : ''}
        ${expires ? `<div class="livewx-alert-meta">${escapeHtml(expires)}</div>` : ''}
        ${instruction ? `<div class="livewx-alert-instruction">${escapeHtml(instruction)}</div>` : ''}
    </div>`;
    state.selectedAlert = [event, headline, expires].filter(Boolean).join(' — ');

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
            maxWidth: '320px',
            className: 'livewx-alert-popup',
        })
            .setLngLat(lngLat)
            .setHTML(html)
            .addTo(map);
    } catch {
        /* pane still shows selectedAlert */
    }
}

function onAlertClick(e: {
    lngLat?: { lng: number; lat: number };
    features?: Array<{ properties?: AlertProps }>;
}): void {
    const map = mapRef;
    if (!map || !e.lngLat) return;
    const props = e.features?.[0]?.properties;
    if (!props) return;
    void showPopup(map, e.lngLat, props);
}

export function startAlerts(api: PluginAPI): void {
    const map = api.map as unknown as LiveWxMap;
    mapRef = map;
    ensureAlertLayers(map);
    map.off('click', ALERT_FILL_ID, onAlertClick);
    map.on('click', ALERT_FILL_ID, onAlertClick);
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
    state.selectedAlert = '';
    if (mapRef) {
        try { mapRef.off('click', ALERT_FILL_ID, onAlertClick); } catch { /* ignore */ }
        removeAlertLayers(mapRef);
    }
    mapRef = null;
}
