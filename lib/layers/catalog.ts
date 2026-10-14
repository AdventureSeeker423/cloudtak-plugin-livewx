/**
 * Registers map layers kept for the master pane (priority + pruned More).
 */
import { MAPSERVICES_NWS } from '../core/constants.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { state } from '../core/state.ts';
import { createGeoLayer, arcgisQueryUrl, mapEnvelope } from './geo-layer.ts';
import { getLayerOpacity, registerLayer } from './registry.ts';
import {
    arcgisExportTileUrl,
    ensureRasterLayer,
    iemWmsTileUrl,
    removeRaster,
} from './wms.ts';

function extentUrl(baseQuery: string): string | null {
    const env = mapEnvelope();
    if (!env) return baseQuery;
    return `${baseQuery}${baseQuery.includes('?') ? '&' : '?'}geometry=${encodeURIComponent(env)}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`;
}

function registerWmsLayer(opts: {
    id: string;
    group: Parameters<typeof registerLayer>[0]['group'];
    label: string;
    description: string;
    hosts: string[];
    sends: string;
    sourceId: string;
    layerId: string;
    tileUrl: () => string;
    opacity?: number;
}): void {
    const defaultOpacity = opts.opacity ?? 0.65;
    let running = false;
    registerLayer({
        id: opts.id,
        group: opts.group,
        label: opts.label,
        description: opts.description,
        hosts: opts.hosts,
        sends: opts.sends,
        defaultOpacity,
        applyOpacity: (opacity) => {
            const m = mapOf();
            if (m?.getLayer(opts.layerId)) {
                m.setPaintProperty?.(opts.layerId, 'raster-opacity', opacity);
            }
        },
        start: () => { running = true; const m = mapOf(); if (m) optsRestore(m); },
        stop: () => {
            running = false;
            const m = mapOf();
            if (m) removeRaster(m, opts.sourceId, opts.layerId);
        },
        restore: (map) => { if (running) optsRestore(map); },
        status: () => (running ? 'On' : 'Off'),
    });

    function optsRestore(map: LiveWxMap): void {
        ensureRasterLayer(
            map,
            opts.sourceId,
            opts.layerId,
            opts.tileUrl(),
            getLayerOpacity(opts.id),
        );
    }
}

/** Wire built-in layers into the registry. Call once at plugin init. */
export function registerCatalogLayers(): void {
    registerWmsLayer({
        id: 'satellite',
        group: 'wind',
        label: 'Satellite',
        description: 'GOES IR',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Tiles',
        sourceId: 'livewx-sat-src',
        layerId: 'livewx-sat-lyr',
        tileUrl: () => iemWmsTileUrl('goes/conus_ir.cgi', 'conus_ir_4km'),
        opacity: 0.75,
    });

    registerWmsLayer({
        id: 'rain_forecast',
        group: 'wind',
        label: 'Rain 1h',
        description: 'MRMS 1h',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Tiles',
        sourceId: 'livewx-qpf-src',
        layerId: 'livewx-qpf-lyr',
        tileUrl: () => iemWmsTileUrl('us/mrms.cgi', 'mrms_p1h'),
        opacity: 0.7,
    });

    registerWmsLayer({
        id: 'wind_field',
        group: 'wind',
        label: 'Water vapor',
        description: 'GOES WV',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Tiles',
        sourceId: 'livewx-wind-src',
        layerId: 'livewx-wind-lyr',
        tileUrl: () => iemWmsTileUrl('goes/conus_wv.cgi', 'conus_wv_4km'),
        opacity: 0.7,
    });

    createGeoLayer({
        id: 'fire_outlook',
        group: 'more',
        label: 'Fire outlook',
        description: 'SPC fire weather Day 1',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Extent query',
        sourceId: 'livewx-fwo-src',
        fillId: 'livewx-fwo-fill',
        lineId: 'livewx-fwo-line',
        fillColor: '#fd7e14',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/fire_outlook/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
    });

    createGeoLayer({
        id: 'fw_zones',
        group: 'more',
        label: 'Fire zones',
        description: 'NWS fire weather zones',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Extent query',
        sourceId: 'livewx-fwz-src',
        fillId: 'livewx-fwz-fill',
        lineId: 'livewx-fwz-line',
        fillColor: '#ae3ec9',
        fillOpacity: 0.12,
        lineColor: '#9c36b5',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/outlooks/forecast_zones_firewx/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
    });

    registerWmsLayer({
        id: 'smoke',
        group: 'more',
        label: 'Smoke',
        description: 'NDGD surface smoke',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Tiles',
        sourceId: 'livewx-smoke-src',
        layerId: 'livewx-smoke-lyr',
        tileUrl: () => arcgisExportTileUrl(
            `${MAPSERVICES_NWS}/raster/rest/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer`,
            'image',
            { rasterFunction: 'smoke_don_0921' },
        ),
    });

    createGeoLayer({
        id: 'air_quality',
        group: 'more',
        label: 'Air quality',
        description: 'AirNow AQI',
        hosts: ['services.arcgis.com'],
        sends: 'Extent query',
        sourceId: 'livewx-aqi-src',
        fillId: 'livewx-aqi-fill',
        lineId: 'livewx-aqi-line',
        fillColor: '#74b816',
        url: () => extentUrl(
            arcgisQueryUrl(
                'https://services.arcgis.com/cJ9YCMLtNAtEZIVI/arcgis/rest/services/AirNowLatestContoursCombined/FeatureServer/0',
                { resultRecordCount: '500' },
            ),
        ),
    });

    createGeoLayer({
        id: 'flash_flood',
        group: 'more',
        label: 'Flash flood',
        description: 'WPC ERO',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Extent query',
        sourceId: 'livewx-ero-src',
        fillId: 'livewx-ero-fill',
        lineId: 'livewx-ero-line',
        fillColor: '#2f9e44',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/outlooks/wpc_excessive_rainfall/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
    });

    createGeoLayer({
        id: 'river_gauges',
        group: 'more',
        label: 'River gauges',
        description: 'AHPS gauges',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Extent query',
        sourceId: 'livewx-riv-src',
        circleId: 'livewx-riv-circle',
        circleColor: '#1c7ed6',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/hydro/ahps_gauges/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=500`,
        ),
    });

    registerWmsLayer({
        id: 'rain_totals',
        group: 'more',
        label: 'Rain 24h',
        description: 'MRMS 24h',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Tiles',
        sourceId: 'livewx-mrms-src',
        layerId: 'livewx-mrms-lyr',
        tileUrl: () => iemWmsTileUrl('us/mrms.cgi', 'mrms_p24h'),
    });

    createGeoLayer({
        id: 'buoys',
        group: 'more',
        label: 'Buoys',
        description: 'NDBC buoys',
        hosts: ['www.ndbc.noaa.gov'],
        sends: 'Station list',
        sourceId: 'livewx-buoy-src',
        circleId: 'livewx-buoy-circle',
        circleColor: '#0ca678',
        url: () => 'https://www.ndbc.noaa.gov/ndbcmapstations.json',
        parse: (raw) => {
            const st = (raw as { station?: Array<Record<string, string>> }).station ?? [];
            return {
                type: 'FeatureCollection',
                features: st.filter((s) => s.lat && s.lon).map((s, i) => ({
                    type: 'Feature' as const,
                    id: s.id || i,
                    geometry: {
                        type: 'Point' as const,
                        coordinates: [Number(s.lon), Number(s.lat)],
                    },
                    properties: s,
                })),
            };
        },
    });

    createGeoLayer({
        id: 'hurricanes',
        group: 'more',
        label: 'Hurricanes',
        description: 'NHC tropical',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Feature query',
        sourceId: 'livewx-nhc-src',
        fillId: 'livewx-nhc-fill',
        lineId: 'livewx-nhc-line',
        fillColor: '#f03e3e',
        fillOpacity: 0.15,
        url: () => `${MAPSERVICES_NWS}/vector/rest/services/tropical/NHC_tropical_weather/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
    });

    createGeoLayer({
        id: 'avalanche',
        group: 'more',
        label: 'Avalanche',
        description: 'Avalanche zones',
        hosts: ['api.avalanche.org'],
        sends: 'Map layer',
        sourceId: 'livewx-avy-src',
        fillId: 'livewx-avy-fill',
        lineId: 'livewx-avy-line',
        fillColor: '#7048e8',
        url: () => 'https://api.avalanche.org/v2/public/products/map-layer',
    });

    registerWmsLayer({
        id: 'snow_depth',
        group: 'more',
        label: 'Snow depth',
        description: 'NOHRSC snow',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Tiles',
        sourceId: 'livewx-snowd-src',
        layerId: 'livewx-snowd-lyr',
        tileUrl: () => arcgisExportTileUrl(
            `${MAPSERVICES_NWS}/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer`,
        ),
    });

    createGeoLayer({
        id: 'earthquakes',
        group: 'more',
        label: 'Earthquakes',
        description: 'USGS M2.5+ week',
        hosts: ['earthquake.usgs.gov'],
        sends: 'Feed',
        sourceId: 'livewx-eq-src',
        circleId: 'livewx-eq-circle',
        circleColor: '#e64980',
        circleRadius: 6,
        url: () => 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
    });

    registerLayer({
        id: 'radar_sites',
        group: 'radar',
        label: 'Radar sites',
        description: 'Site markers',
        hosts: [],
        sends: 'Local',
        start: async () => {
            const { setSitesOnMap } = await import('../core/state.ts');
            setSitesOnMap(true);
            const { applySiteMarkers } = await import('../radar/radar.ts');
            applySiteMarkers();
        },
        stop: async () => {
            const { setSitesOnMap } = await import('../core/state.ts');
            setSitesOnMap(false);
            const { applySiteMarkers } = await import('../radar/radar.ts');
            applySiteMarkers();
        },
        restore: () => { /* site-markers module */ },
        status: () => (state.sitesOnMap ? 'On' : 'Off'),
    });
}
