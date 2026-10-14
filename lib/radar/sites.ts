import rawAliases from '../../data/radar_site_aliases.json';
import rawSites from '../../data/radar_sites.json';
import { CONUS_SITE_ID, TDWR_RANGE_KM, WSR88D_RANGE_KM } from '../core/constants.ts';

export interface RadarSite {
    type: string;
    id: string;
    lat: number;
    lon: number;
    country: string;
    state: string;
    place: string;
    tz: string;
    elevation: number;
}

/** ROC RDA / system names not already in `place` (e.g. Hytop for KHTX). */
const SITE_ALIASES = rawAliases as Record<string, string[]>;

function siteAliases(site: RadarSite): string[] {
    return SITE_ALIASES[site.id] ?? [];
}

/** Place plus RDA aliases, for search and display. */
export function siteNames(site: RadarSite): string[] {
    const names = [site.place, ...siteAliases(site)];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of names) {
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

export const CONUS_SITE: RadarSite = {
    type: 'mosaic',
    id: CONUS_SITE_ID,
    lat: 39.5,
    lon: -98.35,
    country: 'USA',
    state: '',
    place: 'CONUS Mosaic',
    tz: 'UTC',
    elevation: 0,
};

const ALL_SITES = (rawSites as RadarSite[]).filter((s) => (
    (s.type === 'wsr88d' || s.type === 'tdwr') && s.country === 'USA'
));

export function allSites(): RadarSite[] {
    return ALL_SITES;
}

export function findSite(id: string): RadarSite | undefined {
    if (id === CONUS_SITE_ID) return CONUS_SITE;
    return ALL_SITES.find((s) => s.id === id);
}

export function isMosaic(id: string): boolean {
    return id === CONUS_SITE_ID;
}

/** IEM RIDGE / TMS sector id (ILN, not KILN). TDWR keeps the T-prefix code. */
export function toIemId(icao: string): string {
    const id = icao.toUpperCase();
    if (id === CONUS_SITE_ID) return 'USCOMP';
    if (id.startsWith('T') && id.length === 4) return id;
    if (id.length === 4) return id.slice(1);
    return id;
}

export function siteRangeKm(site: RadarSite): number {
    return site.type === 'tdwr' ? TDWR_RANGE_KM : WSR88D_RANGE_KM;
}

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371.0088;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Null when CONUS/mosaic — lightning stays nationwide. */
export function coverageForSiteId(id: string): {
    lat: number;
    lon: number;
    km: number;
    iemId: string;
} | null {
    if (isMosaic(id)) return null;
    const site = findSite(id);
    if (!site || site.type === 'mosaic') return null;
    return {
        lat: site.lat,
        lon: site.lon,
        km: siteRangeKm(site),
        iemId: toIemId(site.id),
    };
}

export function siteLabel(site: RadarSite): string {
    if (site.id === CONUS_SITE_ID) return 'CONUS Mosaic';
    const kind = site.type === 'tdwr' ? 'TDWR' : 'WSR-88D';
    const place = site.place;
    const alias = siteAliases(site).find((a) => {
        const al = a.toLowerCase();
        const pl = place.toLowerCase();
        return al !== pl && !al.includes(pl) && !pl.includes(al);
    });
    const where = alias ? `${place}/${alias}` : place;
    return `${site.id} — ${where}, ${site.state} (${kind})`;
}

export interface SiteGroup {
    state: string;
    sites: RadarSite[];
}

function nameHaystack(site: RadarSite): string {
    return siteNames(site).join('\n').toLowerCase();
}

export function groupedSites(query = ''): SiteGroup[] {
    const q = query.trim().toLowerCase();
    const filtered = ALL_SITES.filter((s) => {
        if (!q) return true;
        return (
            s.id.toLowerCase().includes(q)
            || nameHaystack(s).includes(q)
            || s.state.toLowerCase().includes(q)
            || toIemId(s.id).toLowerCase().includes(q)
        );
    });

    const byState = new Map<string, RadarSite[]>();
    for (const site of filtered) {
        const key = site.state || 'Other';
        const list = byState.get(key) ?? [];
        list.push(site);
        byState.set(key, list);
    }

    return [...byState.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([state, sites]) => ({
            state,
            sites: sites.sort((a, b) => a.place.localeCompare(b.place)),
        }));
}

function siteScore(site: RadarSite, q: string): number | null {
    if (!q) return 50;
    const id = site.id.toLowerCase();
    const iem = toIemId(site.id).toLowerCase();
    const names = siteNames(site).map((n) => n.toLowerCase());
    const st = site.state.toLowerCase();
    if (id === q || iem === q) return 1;
    if (id.startsWith(q) || iem.startsWith(q)) return 2;
    if (names.some((n) => n === q)) return 3;
    if (names.some((n) => n.startsWith(q))) return 4;
    if (names.some((n) => n.includes(q))) return 5;
    if (st === q || st.startsWith(q)) return 6;
    if (id.includes(q) || iem.includes(q) || st.includes(q)) return 7;
    return null;
}

/** Ranked site matches for the combobox. Empty query returns CONUS so mosaic stays one click away. */
export function searchSites(query: string, limit = 20): RadarSite[] {
    const q = query.trim().toLowerCase();
    const ranked: Array<{ site: RadarSite; score: number }> = [];
    const mosaicHit = !q
        || 'conus'.startsWith(q)
        || 'mosaic'.startsWith(q)
        || 'nationwide'.startsWith(q)
        || q === 'us';
    if (mosaicHit) ranked.push({ site: CONUS_SITE, score: 0 });
    if (!q) return ranked.map((r) => r.site);

    for (const site of ALL_SITES) {
        const score = siteScore(site, q);
        if (score == null) continue;
        ranked.push({ site, score });
    }
    ranked.sort((a, b) => a.score - b.score || a.site.place.localeCompare(b.site.place));
    const seen = new Set<string>();
    const out: RadarSite[] = [];
    for (const { site } of ranked) {
        if (seen.has(site.id)) continue;
        seen.add(site.id);
        out.push(site);
        if (out.length >= limit) break;
    }
    return out;
}
