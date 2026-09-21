export const ROUTE_NAME = 'home-menu-plugin-livewx-radar';
export const MENU_KEY = 'livewx-radar';
export const BOTTOM_BAR_KEY = 'livewx-radar-bottom-bar';

export const RADAR_SOURCE_ID = 'livewx-radar-source';
export const RADAR_LAYER_ID = 'livewx-radar-layer';
export const ALERT_SOURCE_ID = 'livewx-alerts-source';
export const ALERT_FILL_ID = 'livewx-alerts-fill';
export const ALERT_LINE_ID = 'livewx-alerts-line';
export const SITES_SOURCE_ID = 'livewx-sites-source';
export const SITES_CIRCLE_ID = 'livewx-sites-circle';
export const SITES_SELECTED_ID = 'livewx-sites-selected';
export const SITES_LABEL_ID = 'livewx-sites-label';

export const CONUS_SITE_ID = 'CONUS';
export const IEM_TMS_BASE = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
export const IEM_JSON_BASE = 'https://mesonet.agron.iastate.edu/json';
export const NWS_ALERTS_URL = 'https://api.weather.gov/alerts/active';

export const STORAGE_KEY = 'livewx-radar-settings';
export const REFRESH_MS = 60_000;
export const ALERT_POLL_MS = 60_000;
export const PROTOCOL_NAME = 'livewx';

export const DEFAULT_OPACITY = 0.7;
export const DEFAULT_FILTER = 0;

/** IEM mosaic tiles get mushy past this; MapLibre overzooms instead of fetching empty high-z tiles. */
export const MOSAIC_MAXZOOM = 8;
/** Single-site RIDGE has more native detail. */
export const RIDGE_MAXZOOM = 10;
/** At this zoom and above, CONUS mosaic switches to the nearest WSR-88D. */
export const MOSAIC_CLOSEUP_ZOOM = 7;
