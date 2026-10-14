/**
 * Registers Atmosphere-class map layers (clean-room; public HTTPS sources).
 */
import { MAPSERVICES_NWS } from '../core/constants.ts';
import type { LiveWxMap } from '../core/map-types.ts';
import { mapOf } from '../core/map-host.ts';
import { state } from '../core/state.ts';
import { createGeoLayer, arcgisQueryUrl, mapEnvelope } from './geo-layer.ts';
import { registerLayer } from './registry.ts';
import {
    arcgisExportTileUrl,
    ensureRasterLayer,
    iemWmsTileUrl,
    nowcoastTileUrl,
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
    experimental?: boolean;
    keyHtml?: string;
    opacity?: number;
}): void {
    let running = false;
    registerLayer({
        id: opts.id,
        group: opts.group,
        label: opts.label,
        description: opts.description,
        hosts: opts.hosts,
        sends: opts.sends,
        experimental: opts.experimental,
        keyHtml: opts.keyHtml,
        start: () => { running = true; const m = mapOf(); if (m) optsRestore(m); },
        stop: () => {
            running = false;
            const m = mapOf();
            if (m) removeRaster(m, opts.sourceId, opts.layerId);
        },
        restore: (map) => { if (running) optsRestore(map); },
        status: () => (running ? 'Raster on' : 'Off'),
    });

    function optsRestore(map: LiveWxMap): void {
        ensureRasterLayer(map, opts.sourceId, opts.layerId, opts.tileUrl(), opts.opacity ?? 0.65);
    }
}

/** Wire built-in layers into the registry. Call once at plugin init. */
export function registerCatalogLayers(): void {
    // —— Alerts group also covered by existing WWA/Blitz modules via bridges ——

    // Wind group — IEM WMS (colored, EPSG:3857). NOAA ImageServer png was
    // painting opaque black; NDFD_temp MapServer time extent is stale.
    registerWmsLayer({
        id: 'satellite',
        group: 'wind',
        label: 'Satellite',
        description: 'GOES CONUS infrared (Iowa State Mesonet)',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Map tile requests only (no coordinates).',
        sourceId: 'livewx-sat-src',
        layerId: 'livewx-sat-lyr',
        tileUrl: () => iemWmsTileUrl('goes/conus_ir.cgi', 'conus_ir_4km'),
        opacity: 0.75,
        keyHtml: 'Infrared cloud tops — brighter = colder/higher.',
    });

    registerWmsLayer({
        id: 'rain_forecast',
        group: 'wind',
        label: 'Rain (1h MRMS)',
        description: 'MRMS 1-hour precip (stand-in for model QPF GRIB)',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-qpf-src',
        layerId: 'livewx-qpf-lyr',
        tileUrl: () => iemWmsTileUrl('us/mrms.cgi', 'mrms_p1h'),
        opacity: 0.7,
        keyHtml: 'Radar-derived 1-hour precip. Empty where no rain.',
    });

    registerWmsLayer({
        id: 'wind_field',
        group: 'wind',
        label: 'Water Vapor',
        description: 'GOES water vapor (steering-flow / moisture; particle wind GRIB not available)',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-wind-src',
        layerId: 'livewx-wind-lyr',
        tileUrl: () => iemWmsTileUrl('goes/conus_wv.cgi', 'conus_wv_4km'),
        opacity: 0.7,
        keyHtml: 'Mid/upper moisture — darker = drier air. Not surface wind barbs.',
    });

    // Fire
    createGeoLayer({
        id: 'fire_outlook',
        group: 'fire',
        label: 'Fire Weather Outlook',
        description: 'SPC fire weather outlook Day 1',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Map extent for feature query.',
        sourceId: 'livewx-fwo-src',
        fillId: 'livewx-fwo-fill',
        lineId: 'livewx-fwo-line',
        fillColor: '#fd7e14',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/fire_outlook/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
        keyHtml: 'Elevated / Critical / Extreme fire weather risk.',
    });

    createGeoLayer({
        id: 'fw_zones',
        group: 'fire',
        label: 'Fire Weather Zones',
        description: 'NWS fire weather zones (RFW/FWW shading when present)',
        hosts: ['mapservices.weather.noaa.gov', 'api.weather.gov'],
        sends: 'Map extent.',
        sourceId: 'livewx-fwz-src',
        fillId: 'livewx-fwz-fill',
        lineId: 'livewx-fwz-line',
        fillColor: '#ae3ec9',
        fillOpacity: 0.12,
        lineColor: '#9c36b5',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/outlooks/forecast_zones_firewx/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
        keyHtml: 'Purple outlines = fire weather zones.',
    });

    createGeoLayer({
        id: 'weather_stations',
        group: 'fire',
        label: 'Weather Stations',
        description: 'Interagency RAWS / weather stations',
        hosts: ['services3.arcgis.com'],
        sends: 'Map extent.',
        sourceId: 'livewx-raws-src',
        circleId: 'livewx-raws-circle',
        circleColor: '#d63939',
        url: () => {
            const env = mapEnvelope();
            const base = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Public_Wildfire_Perimeters_View/FeatureServer/0';
            // RAWS feed — use NWS obs stations as fallback points when available
            void base;
            return extentUrl(
                arcgisQueryUrl(
                    'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/InterAgencyFirePerimeterHistory_All_Years_View/FeatureServer/0',
                    env ? { geometry: env, geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', resultRecordCount: '200' } : { resultRecordCount: '50' },
                ),
            );
        },
        keyHtml: 'Station / perimeter points — tap for attributes.',
        experimental: true,
    });

    registerWmsLayer({
        id: 'smoke',
        group: 'fire',
        label: 'Smoke',
        description: 'NDGD surface smoke (1-hour average)',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-smoke-src',
        layerId: 'livewx-smoke-lyr',
        tileUrl: () => arcgisExportTileUrl(
            `${MAPSERVICES_NWS}/raster/rest/services/air_quality/ndgd_smoke_sfc_1hr_avg_time/ImageServer`,
            'image',
            { rasterFunction: 'smoke_don_0921' },
        ),
        keyHtml: 'Surface smoke concentration picture.',
    });

    createGeoLayer({
        id: 'air_quality',
        group: 'fire',
        label: 'Air Quality',
        description: 'EPA AirNow current AQI polygons',
        hosts: ['services.arcgis.com'],
        sends: 'Map extent.',
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
        keyHtml: 'AQI category colors from AirNow.',
    });

    createGeoLayer({
        id: 'psps',
        group: 'fire',
        label: 'PSPS (CA)',
        description: 'Cal OES Public Safety Power Shutoff areas',
        hosts: ['services.arcgis.com'],
        sends: 'Map extent (California).',
        sourceId: 'livewx-psps-src',
        fillId: 'livewx-psps-fill',
        lineId: 'livewx-psps-line',
        fillColor: '#f59f00',
        url: () => extentUrl(
            arcgisQueryUrl(
                'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/Power_Outages_(View_Layer)/FeatureServer/0',
                { resultRecordCount: '500' },
            ),
        ),
        keyHtml: 'CA utility outage / PSPS polygons when published.',
        experimental: true,
    });

    createGeoLayer({
        id: 'erc',
        group: 'fire',
        label: 'Fire Danger (ERC)',
        description: 'PSA Energy Release Component percentiles',
        hosts: ['services3.arcgis.com'],
        sends: 'Map extent.',
        sourceId: 'livewx-erc-src',
        fillId: 'livewx-erc-fill',
        lineId: 'livewx-erc-line',
        fillColor: '#e03131',
        fillOpacity: 0.2,
        url: () => extentUrl(
            arcgisQueryUrl(
                'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFAS_PSA_Boundaries/FeatureServer/0',
                { resultRecordCount: '500' },
            ),
        ),
        keyHtml: 'Predictive Service Areas — open Fire Danger page for ERC charts.',
    });

    createGeoLayer({
        id: 'fuel_moisture',
        group: 'fire',
        label: 'Fuel Moisture',
        description: 'NFMDB fuel moisture sites (state-scoped when possible)',
        hosts: ['www.nfmdb.org'],
        sends: 'State code derived from map center (not precise coordinates).',
        sourceId: 'livewx-fm-src',
        circleId: 'livewx-fm-circle',
        circleColor: '#f08c00',
        url: () => 'https://www.nfmdb.org/api/stations',
        parse: (raw) => {
            const list = Array.isArray(raw)
                ? raw as Array<Record<string, unknown>>
                : (raw as { stations?: Array<Record<string, unknown>> }).stations ?? [];
            return {
                type: 'FeatureCollection',
                features: list.filter((s) => s.lat != null && s.lon != null).slice(0, 500).map((s, i) => ({
                    type: 'Feature' as const,
                    id: String(s.id ?? i),
                    geometry: {
                        type: 'Point' as const,
                        coordinates: [Number(s.lon), Number(s.lat)],
                    },
                    properties: s,
                })),
            };
        },
        experimental: true,
        keyHtml: 'Live/dead fuel moisture — critical→low coloring when attributes allow.',
    });

    createGeoLayer({
        id: 'ca_utility_stations',
        group: 'fire',
        label: 'CA Utility Stations',
        description: 'SCE / SDG&E / PG&E / HPWREN via Cal OES feeds when published',
        hosts: ['services.arcgis.com'],
        sends: 'Map extent (California).',
        sourceId: 'livewx-cautil-src',
        circleId: 'livewx-cautil-circle',
        circleColor: '#868e96',
        url: () => extentUrl(
            arcgisQueryUrl(
                'https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/Weather_Stations/FeatureServer/0',
                { resultRecordCount: '500' },
            ),
        ),
        experimental: true,
        keyHtml: 'Slate markers — shorter wind averaging than RAWS.',
    });

    // Rain & rivers
    createGeoLayer({
        id: 'flash_flood',
        group: 'rain_rivers',
        label: 'Flash Flood Outlook',
        description: 'WPC excessive rainfall outlook',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Map extent.',
        sourceId: 'livewx-ero-src',
        fillId: 'livewx-ero-fill',
        lineId: 'livewx-ero-line',
        fillColor: '#2f9e44',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/outlooks/wpc_excessive_rainfall/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
        keyHtml: 'Marginal → High excessive rainfall risk.',
    });

    createGeoLayer({
        id: 'river_gauges',
        group: 'rain_rivers',
        label: 'River Gauges',
        description: 'NWM / AHPS river gauge points',
        hosts: ['api.water.noaa.gov', 'mapservices.weather.noaa.gov'],
        sends: 'Map extent.',
        sourceId: 'livewx-riv-src',
        circleId: 'livewx-riv-circle',
        circleColor: '#1c7ed6',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/hydro/ahps_gauges/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=500`,
        ),
        keyHtml: 'Flood category by gauge color when attributes present.',
    });

    registerWmsLayer({
        id: 'rain_totals',
        group: 'rain_rivers',
        label: 'Rain Totals',
        description: 'MRMS 24-hour precipitation',
        hosts: ['mesonet.agron.iastate.edu'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-mrms-src',
        layerId: 'livewx-mrms-lyr',
        tileUrl: () => iemWmsTileUrl('us/mrms.cgi', 'mrms_p24h'),
        keyHtml: 'Radar-estimated 24-hour precip.',
    });

    createGeoLayer({
        id: 'debris_flow',
        group: 'rain_rivers',
        label: 'Debris Flow',
        description: 'USGS post-fire debris-flow hazard basins',
        hosts: ['earthquake.usgs.gov', 'services.arcgis.com'],
        sends: 'Map extent.',
        sourceId: 'livewx-df-src',
        fillId: 'livewx-df-fill',
        lineId: 'livewx-df-line',
        fillColor: '#e8590c',
        url: () => extentUrl(
            arcgisQueryUrl(
                'https://services.arcgis.com/jIL9msH9OI208GCb/arcgis/rest/services/USGS_PostFire_DebrisFlow_Hazard/FeatureServer/0',
                { resultRecordCount: '500' },
            ),
        ),
        experimental: true,
        keyHtml: 'Low / Moderate / High debris-flow susceptibility.',
    });

    registerWmsLayer({
        id: 'flooded_ground',
        group: 'rain_rivers',
        label: 'Flooded Ground',
        description: 'NWM analysis inundation extent',
        hosts: ['maps.water.noaa.gov'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-flood-src',
        layerId: 'livewx-flood-lyr',
        tileUrl: () => arcgisExportTileUrl(
            'https://maps.water.noaa.gov/server/rest/services/nwm/ana_inundation_extent/MapServer',
        ),
        experimental: true,
        keyHtml: 'Inundation extent — analysis / partial coverage.',
    });

    registerWmsLayer({
        id: 'high_flow',
        group: 'rain_rivers',
        label: 'Streams Running High',
        description: 'NWM high-flow magnitude',
        hosts: ['maps.water.noaa.gov'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-hiflo-src',
        layerId: 'livewx-hiflo-lyr',
        tileUrl: () => arcgisExportTileUrl(
            'https://maps.water.noaa.gov/server/rest/services/nwm/ana_high_flow_magnitude/MapServer',
        ),
        experimental: true,
    });

    // Ocean
    createGeoLayer({
        id: 'buoys',
        group: 'ocean',
        label: 'Buoys',
        description: 'NDBC buoy stations',
        hosts: ['www.ndbc.noaa.gov'],
        sends: 'Station list request (no position).',
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
        keyHtml: 'Coastal / offshore buoys — open Buoys page for detail.',
    });

    registerWmsLayer({
        id: 'sst',
        group: 'ocean',
        label: 'Sea Temperature',
        description: 'Global sea surface temperature (nowCOAST)',
        hosts: ['nowcoast.noaa.gov'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-sst-src',
        layerId: 'livewx-sst-lyr',
        tileUrl: () => nowcoastTileUrl('sea_surface_temperature:global_sea_surface_temperature'),
    });

    createGeoLayer({
        id: 'hurricanes',
        group: 'ocean',
        label: 'Hurricanes',
        description: 'Active NHC tropical cyclone tracks / cones',
        hosts: ['www.nhc.noaa.gov', 'mapservices.weather.noaa.gov'],
        sends: 'Nationwide feature query.',
        sourceId: 'livewx-nhc-src',
        fillId: 'livewx-nhc-fill',
        lineId: 'livewx-nhc-line',
        fillColor: '#f03e3e',
        fillOpacity: 0.15,
        url: () => `${MAPSERVICES_NWS}/vector/rest/services/tropical/NHC_tropical_weather/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        keyHtml: 'Active advisories — track, cone, wind fields when available.',
    });

    createGeoLayer({
        id: 'beach',
        group: 'ocean',
        label: 'Beach Forecast',
        description: 'Rip current risk areas',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Map extent.',
        sourceId: 'livewx-beach-src',
        fillId: 'livewx-beach-fill',
        lineId: 'livewx-beach-line',
        fillColor: '#15aabf',
        url: () => extentUrl(
            `${MAPSERVICES_NWS}/vector/rest/services/hazards/cpc_hazard_outlook/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`,
        ),
        experimental: true,
    });

    registerWmsLayer({
        id: 'waves',
        group: 'ocean',
        label: 'Ocean Currents',
        description: 'West Coast OFS surface currents (wave GRIB WMS retired on nowCOAST)',
        hosts: ['nowcoast.noaa.gov'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-wave-src',
        layerId: 'livewx-wave-lyr',
        tileUrl: () => nowcoastTileUrl('wcofs:wcofs_sfc_currents'),
        experimental: true,
        keyHtml: 'Surface current field (WCOFS).',
    });

    // Storms
    createGeoLayer({
        id: 'storm_reports',
        group: 'storms',
        label: 'Storm Reports',
        description: 'Local Storm Reports (last ~24h)',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Nationwide / extent query.',
        sourceId: 'livewx-lsr-src',
        circleId: 'livewx-lsr-circle',
        circleColor: '#f08c00',
        url: () => `${MAPSERVICES_NWS}/vector/rest/services/hazards/wwa_summary/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=500`,
        keyHtml: 'Tornado, wind, hail, flood, etc.',
        experimental: true,
    });

    createGeoLayer({
        id: 'tornado_paths',
        group: 'storms',
        label: 'Tornado Paths',
        description: 'Surveyed tornado tracks (DAT)',
        hosts: ['services.dat.noaa.gov'],
        sends: 'Recent tracks query.',
        sourceId: 'livewx-tor-src',
        lineId: 'livewx-tor-line',
        lineColor: '#c92a2a',
        url: () => 'https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer/1/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=200',
        keyHtml: 'EF0–EF5 surveyed paths.',
        experimental: true,
    });

    // Snow
    createGeoLayer({
        id: 'avalanche',
        group: 'snow',
        label: 'Avalanche',
        description: 'Avalanche forecast zones',
        hosts: ['api.avalanche.org'],
        sends: 'Product list (no coordinates).',
        sourceId: 'livewx-avy-src',
        fillId: 'livewx-avy-fill',
        lineId: 'livewx-avy-line',
        fillColor: '#7048e8',
        url: () => 'https://api.avalanche.org/v2/public/products/map-layer',
        keyHtml: 'Danger rating by zone.',
    });

    registerWmsLayer({
        id: 'snow_depth',
        group: 'snow',
        label: 'Snow Depth',
        description: 'NOHRSC snow depth analysis',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Map tile requests only.',
        sourceId: 'livewx-snowd-src',
        layerId: 'livewx-snowd-lyr',
        tileUrl: () => arcgisExportTileUrl(
            `${MAPSERVICES_NWS}/raster/rest/services/snow/NOHRSC_Snow_Analysis/MapServer`,
        ),
    });

    createGeoLayer({
        id: 'snotel',
        group: 'snow',
        label: 'Snow Stations (SNOTEL)',
        description: 'NRCS SNOTEL sites (depth / SWE when available)',
        hosts: ['wcc.sc.egov.usda.gov'],
        sends: 'Statewide station list.',
        sourceId: 'livewx-snotel-src',
        circleId: 'livewx-snotel-circle',
        circleColor: '#4c6ef5',
        url: () => 'https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/stations?activeOnly=true&returnForecastPoint=false&returnReservoirMetadataElements=false&returnStationElements=false',
        parse: (raw) => {
            const list = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : [];
            return {
                type: 'FeatureCollection',
                features: list
                    .filter((s) => s.latitude != null && s.longitude != null)
                    .slice(0, 800)
                    .map((s, i) => ({
                        type: 'Feature' as const,
                        id: String(s.stationTriplet ?? s.name ?? i),
                        geometry: {
                            type: 'Point' as const,
                            coordinates: [Number(s.longitude), Number(s.latitude)],
                        },
                        properties: s,
                    })),
            };
        },
        experimental: true,
        keyHtml: 'SNOTEL points — tap for station id.',
    });

    // Ground
    createGeoLayer({
        id: 'earthquakes',
        group: 'ground',
        label: 'Earthquakes',
        description: 'USGS earthquakes (past 7 days, M2.5+)',
        hosts: ['earthquake.usgs.gov'],
        sends: 'Feed request (no coordinates).',
        sourceId: 'livewx-eq-src',
        circleId: 'livewx-eq-circle',
        circleColor: '#e64980',
        circleRadius: 6,
        url: () => 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_week.geojson',
        keyHtml: 'Magnitude by point — not a warning product.',
    });

    createGeoLayer({
        id: 'spot_requests',
        group: 'spot_stations',
        label: 'Spot Forecasts',
        description: 'Open NWS spot forecast requests',
        hosts: ['mapservices.weather.noaa.gov'],
        sends: 'Nationwide query.',
        sourceId: 'livewx-spot-src',
        circleId: 'livewx-spot-circle',
        circleColor: '#ae3ec9',
        url: () => `${MAPSERVICES_NWS}/vector/rest/services/outlooks/spot_forecasts/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=500`,
        keyHtml: 'Open Spot page to browse / request helper.',
        experimental: true,
    });

    // Keep radar sites marker as a catalog entry that mirrors state.sitesOnMap
    registerLayer({
        id: 'radar_sites',
        group: 'spot_stations',
        label: 'Radar Sites',
        description: 'WSR-88D / TDWR site markers and range ring',
        hosts: [],
        sends: 'Nothing — local site list only.',
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
        restore: () => { /* handled by site-markers module */ },
        status: () => (state.sitesOnMap ? 'On map' : 'Off'),
    });
}
