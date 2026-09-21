# LiveWX Radar

CloudTAK plugin that overlays live NEXRAD imagery, nationwide NWS watches/warnings, and live lightning on the map.

Requires CloudTAK **13.45** or newer.

## What it does

- Radar overlay **off by default**. Toggle it on from the plugin pane.
- **CONUS mosaic** is the default site (Iowa Mesonet `nexrad-n0q` tiles).
- Pick a WSR-88D or TDWR site for single-radar RIDGE products (default Level 3 **N0B** reflectivity).
- Level 2 names (REF, VEL, …) map to the closest IEM Level 3 image for this version.
- Transparency and a min-value **filter** slider (hide weak reflectivity / slow velocity).
- Optional **watches and warnings** from `api.weather.gov` — nationwide, not scoped to the selected radar.
- Optional **lightning** from Blitzortung — off by default; when on, strikes in the current map view show as lightning bolts that fade from white to yellow to orange to dark red over the strike lifetime (default 120s). The public websocket is **live only**; turning Lightning on does not backfill strikes from before that moment.
- Simple last-hour **replay** when IEM has archive frames.

Imagery is pre-rendered IEM tiles (CONUS mosaic and per-site RIDGE). Product names are NWS/IEM Level 2 and Level 3 codes; defaults are N0B reflectivity and N0G velocity.

Lightning is client-side only (no TAK/CoT). Strike locations are filtered to the map bounds, not a picked center. This data is for **entertainment / situational awareness only** — not for life safety or official warning. Blitzortung’s historical archive requires a station login and is not used here.

### Lightning and CloudTAK CSP

Production CloudTAK nginx often sets `Content-Security-Policy` with `connect-src 'self'`. That **blocks** `wss://ws1.blitzortung.org`, `wss://ws7.blitzortung.org`, and `wss://ws8.blitzortung.org`, so the Lightning toggle will fail to connect until those hosts are allowed in CloudTAK’s CSP. This plugin does not patch CloudTAK nginx.

## Install

```bash
git clone https://github.com/AdventureSeeker423/cloudtak-plugin-livewx.git
cd cloudtak-plugin-livewx
./install.sh
```

Or pass the CloudTAK path:

```bash
./install.sh /path/to/CloudTAK
```

The script finds CloudTAK at `$CLOUDTAK`, `~/CloudTAK`, `/home/takwerx/CloudTAK`, or `/home/*/CloudTAK`. Before copying, it fetches the latest `main` from GitHub. If you run it from a marketplace copy (no plugin `.git`), it clones GitHub into a temp dir so the install is not stuck on stale files. Then it copies into `api/web/plugins/livewx-radar/` and rebuilds the API image. After it finishes: **Settings → Refresh App**. A normal browser refresh is not enough.

Because `index.ts` is at the repository root, you can also bake it in with CloudTAK’s `WEB_PLUGINS` build arg.

```bash
./install.sh --remove
```

### Local development

Symlink this checkout to `CloudTAK/api/web/plugins/livewx-radar`, run `npm install` here (with `@tak-ps/cloudtak` pointing at your CloudTAK web package), and restart `npm run serve` in `api/web`.

## Attribution

- Radar tiles: [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu/ogc/)
- Watches and warnings: [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
- Lightning: [Blitzortung.org](https://www.blitzortung.org/) and contributors. Lightning overlay adapted from [cmlaird/CloudTAK-Plugin-Lightning](https://github.com/cmlaird/CloudTAK-Plugin-Lightning) (MIT).
- Site list and product taxonomy adapted from [Supercell Wx](https://github.com/dpaulat/supercell-wx) (MIT)
