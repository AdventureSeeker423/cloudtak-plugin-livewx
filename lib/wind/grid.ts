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
    const dx = g.east - g.west;
    const dy = g.north - g.south;
    if (!(dx > 0) || !(dy > 0) || g.nx < 1 || g.ny < 1) return null;
    const x = ((lon - g.west) / dx) * Math.max(1, g.nx - 1);
    const y = ((lat - g.south) / dy) * Math.max(1, g.ny - 1);
    const x0 = Math.max(0, Math.min(g.nx - 1, Math.floor(x)));
    const y0 = Math.max(0, Math.min(g.ny - 1, Math.floor(y)));
    const x1 = Math.min(g.nx - 1, x0 + 1);
    const y1 = Math.min(g.ny - 1, y0 + 1);
    const tx = g.nx === 1 ? 0 : x - x0;
    const ty = g.ny === 1 ? 0 : y - y0;
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
    // Skip NaN corners so a sparse/partial fill still interpolates.
    const w00 = Number.isFinite(a) ? (1 - tx) * (1 - ty) : 0;
    const w10 = Number.isFinite(b) ? tx * (1 - ty) : 0;
    const w01 = Number.isFinite(c) ? (1 - tx) * ty : 0;
    const w11 = Number.isFinite(d) ? tx * ty : 0;
    const w = w00 + w10 + w01 + w11;
    if (!(w > 0)) return Number.NaN;
    return ((Number.isFinite(a) ? a * w00 : 0)
        + (Number.isFinite(b) ? b * w10 : 0)
        + (Number.isFinite(c) ? c * w01 : 0)
        + (Number.isFinite(d) ? d * w11 : 0)) / w;
}

/** Fill leftover NaNs from the nearest valid sample (keeps streaks alive). */
function fillNaNs(u: Float32Array, v: Float32Array, nx: number, ny: number): number {
    let filled = 0;
    for (let i = 0; i < u.length; i++) {
        if (Number.isFinite(u[i]) && Number.isFinite(v[i])) {
            filled++;
            continue;
        }
        const x0 = i % nx;
        const y0 = Math.floor(i / nx);
        let best = -1;
        let bestD = Number.POSITIVE_INFINITY;
        for (let j = 0; j < u.length; j++) {
            if (!Number.isFinite(u[j]) || !Number.isFinite(v[j])) continue;
            const x1 = j % nx;
            const y1 = Math.floor(j / nx);
            const d = (x1 - x0) ** 2 + (y1 - y0) ** 2;
            if (d < bestD) {
                bestD = d;
                best = j;
            }
        }
        if (best >= 0) {
            u[i] = u[best];
            v[i] = v[best];
            filled++;
        }
    }
    return filled;
}

function readBounds(b: {
    getWest?: () => number;
    getEast?: () => number;
    getSouth?: () => number;
    getNorth?: () => number;
    _sw?: { lng: number; lat: number };
    _ne?: { lng: number; lat: number };
}): { west: number; east: number; south: number; north: number } | null {
    let west: number | undefined;
    let east: number | undefined;
    let south: number | undefined;
    let north: number | undefined;
    try {
        west = typeof b.getWest === 'function' ? b.getWest() : b._sw?.lng;
        east = typeof b.getEast === 'function' ? b.getEast() : b._ne?.lng;
        south = typeof b.getSouth === 'function' ? b.getSouth() : b._sw?.lat;
        north = typeof b.getNorth === 'function' ? b.getNorth() : b._ne?.lat;
    } catch {
        return null;
    }
    if ([west, east, south, north].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
        return null;
    }
    if (!((east as number) > (west as number)) || !((north as number) > (south as number))) {
        return null;
    }
    return {
        west: west as number,
        east: east as number,
        south: south as number,
        north: north as number,
    };
}

function viewBounds(): { west: number; east: number; south: number; north: number } | null {
    const b = mapOf()?.getBounds?.();
    if (!b) return null;
    const raw = readBounds(b);
    if (!raw) return null;
    let { west, east, south, north } = raw;
    // Modest pad — large pads explode the sample mesh on CONUS views.
    const padLon = Math.min(4, (east - west) * 0.12);
    const padLat = Math.min(3, (north - south) * 0.12);
    west = Math.max(-180, west - padLon);
    east = Math.min(180, east + padLon);
    south = Math.max(-85, south - padLat);
    north = Math.min(85, north + padLat);
    if (!(east > west) || !(north > south)) return null;
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
        + '&wind_speed_unit=ms&timezone=UTC&forecast_days=1';
    const body = await fetchJson<OmPoint | OmPoint[]>(url, { signal });
    const rows = Array.isArray(body) ? body : [body];
    const u = new Float32Array(mesh.nx * mesh.ny);
    const v = new Float32Array(mesh.nx * mesh.ny);
    u.fill(Number.NaN);
    v.fill(Number.NaN);
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
    fillNaNs(u, v, mesh.nx, mesh.ny);
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
