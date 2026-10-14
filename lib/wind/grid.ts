/**
 * Wind U/V grid over the map view via Open-Meteo (JSON stand-in for Atmosphere's NOMADS GRIB).
 * Kept small (≤20 points) so the free Open-Meteo API does not 429.
 */
import { fetchJson } from '../core/egress.ts';
import { mapOf } from '../core/map-host.ts';

export type WindSample = { u: number; v: number; speed: number };

export type WindGrid = {
    west: number;
    east: number;
    south: number;
    north: number;
    nx: number;
    ny: number;
    u: Float32Array;
    v: Float32Array;
    fetchedAt: number;
    model: string;
};

type OmPoint = {
    latitude?: number;
    longitude?: number;
    current?: {
        wind_speed_10m?: number;
        wind_direction_10m?: number;
    };
};

/** Hard cap — Open-Meteo free tier 429s large multi-location current queries. */
const MAX_POINTS = 20;

/** Meteorological "from" degrees → eastward (u) / northward (v) m/s. */
export function uvFromSpeedDir(speedMs: number, fromDeg: number): { u: number; v: number } {
    const rad = (fromDeg * Math.PI) / 180;
    return {
        u: -speedMs * Math.sin(rad),
        v: -speedMs * Math.cos(rad),
    };
}

export function sampleGrid(g: WindGrid, lon: number, lat: number): WindSample | null {
    if (lon < g.west || lon > g.east || lat < g.south || lat > g.north) return null;
    const x = ((lon - g.west) / (g.east - g.west)) * (g.nx - 1);
    const y = ((lat - g.south) / (g.north - g.south)) * (g.ny - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(g.nx - 1, x0 + 1);
    const y1 = Math.min(g.ny - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const i00 = y0 * g.nx + x0;
    const i10 = y0 * g.nx + x1;
    const i01 = y1 * g.nx + x0;
    const i11 = y1 * g.nx + x1;
    const u = bil(g.u[i00], g.u[i10], g.u[i01], g.u[i11], tx, ty);
    const v = bil(g.v[i00], g.v[i10], g.v[i01], g.v[i11], tx, ty);
    if (!Number.isFinite(u) || !Number.isFinite(v)) return null;
    return { u, v, speed: Math.hypot(u, v) };
}

function bil(a: number, b: number, c: number, d: number, tx: number, ty: number): number {
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

function viewBounds(): { west: number; east: number; south: number; north: number } | null {
    const b = mapOf()?.getBounds?.();
    if (!b) return null;
    let west = b.getWest();
    let east = b.getEast();
    let south = b.getSouth();
    let north = b.getNorth();
    if (!(east > west) || !(north > south)) return null;
    // Modest pad — large pads explode the sample mesh on CONUS views.
    const padLon = Math.min(4, (east - west) * 0.12);
    const padLat = Math.min(3, (north - south) * 0.12);
    west = Math.max(-180, west - padLon);
    east = Math.min(180, east + padLon);
    south = Math.max(-85, south - padLat);
    north = Math.min(85, north + padLat);
    return { west, east, south, north };
}

/** Build a coarse lon/lat mesh (max ~20 points). */
export function buildMesh(
    west: number,
    south: number,
    east: number,
    north: number,
    maxPoints = MAX_POINTS,
): { lats: number[]; lons: number[]; nx: number; ny: number } {
    const spanLon = Math.max(0.05, east - west);
    const spanLat = Math.max(0.05, north - south);
    let nx = Math.round(Math.sqrt(maxPoints * (spanLon / spanLat)));
    let ny = Math.round(maxPoints / Math.max(1, nx));
    nx = Math.max(3, Math.min(5, nx));
    ny = Math.max(3, Math.min(4, ny));
    while (nx * ny > maxPoints && (nx > 3 || ny > 3)) {
        if (nx >= ny && nx > 3) nx--;
        else if (ny > 3) ny--;
        else break;
    }
    const lats: number[] = [];
    const lons: number[] = [];
    for (let j = 0; j < ny; j++) {
        const lat = south + ((north - south) * j) / Math.max(1, ny - 1);
        for (let i = 0; i < nx; i++) {
            const lon = west + ((east - west) * i) / Math.max(1, nx - 1);
            lats.push(Math.round(lat * 100) / 100);
            lons.push(Math.round(lon * 100) / 100);
        }
    }
    return { lats, lons, nx, ny };
}

export function boundsKey(b: { west: number; east: number; south: number; north: number }): string {
    return [
        b.west.toFixed(2),
        b.south.toFixed(2),
        b.east.toFixed(2),
        b.north.toFixed(2),
    ].join('|');
}

export async function fetchWindGrid(signal?: AbortSignal): Promise<WindGrid | null> {
    const bounds = viewBounds();
    if (!bounds) return null;
    const { west, east, south, north } = bounds;
    const mesh = buildMesh(west, south, east, north);
    // forecast_days=1 keeps request weight low on the free tier.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${mesh.lats.join(',')}`
        + `&longitude=${mesh.lons.join(',')}`
        + '&current=wind_speed_10m,wind_direction_10m'
        + '&wind_speed_unit=ms&cell_selection=nearest&timezone=UTC&forecast_days=1';
    const body = await fetchJson<OmPoint | OmPoint[]>(url, { signal });
    const rows = Array.isArray(body) ? body : [body];
    const u = new Float32Array(mesh.nx * mesh.ny);
    const v = new Float32Array(mesh.nx * mesh.ny);
    u.fill(NaN);
    v.fill(NaN);
    let filled = 0;
    for (let i = 0; i < rows.length && i < u.length; i++) {
        const cur = rows[i]?.current;
        const spd = cur?.wind_speed_10m;
        const dir = cur?.wind_direction_10m;
        if (spd == null || dir == null || !Number.isFinite(spd) || !Number.isFinite(dir)) continue;
        const uv = uvFromSpeedDir(spd, dir);
        u[i] = uv.u;
        v[i] = uv.v;
        filled++;
    }
    if (!filled) throw new Error('No wind samples in view');
    return {
        west,
        east,
        south,
        north,
        nx: mesh.nx,
        ny: mesh.ny,
        u,
        v,
        fetchedAt: Date.now(),
        model: 'Open-Meteo',
    };
}
