# LiveWX Radar

CloudTAK plugin that overlays live NEXRAD imagery and nationwide NWS watches/warnings on the map.

Requires CloudTAK **13.45** or newer.

## What it does

- Radar overlay **off by default**. Toggle it on from the plugin pane.
- **CONUS mosaic** is the default site (Iowa Mesonet `nexrad-n0q` tiles).
- Pick a WSR-88D or TDWR site for single-radar RIDGE products (default Level 3 **N0B** reflectivity).
- Level 2 names (REF, VEL, …) map to the closest IEM Level 3 image for this version.
- Transparency and a min-value **filter** slider (hide weak reflectivity / slow velocity).
- Optional **watches and warnings** from `api.weather.gov` — nationwide, not scoped to the selected radar.
- Simple last-hour **replay** when IEM has archive frames.

Imagery is pre-rendered IEM tiles (CONUS mosaic and per-site RIDGE). Product names are NWS/IEM Level 2 and Level 3 codes; defaults are N0B reflectivity and N0G velocity.

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
- Site list and product taxonomy adapted from [Supercell Wx](https://github.com/dpaulat/supercell-wx) (MIT)
