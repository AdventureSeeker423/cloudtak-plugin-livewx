import rawSites from '../data/radar_sites.json';
import { CONUS_SITE_ID } from './constants.ts';

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

export function siteLabel(site: RadarSite): string {
    if (site.id === CONUS_SITE_ID) return 'CONUS Mosaic';
    const kind = site.type === 'tdwr' ? 'TDWR' : 'WSR-88D';
    return `${site.id} — ${site.place}, ${site.state} (${kind})`;
}

export interface SiteGroup {
    state: string;
    sites: RadarSite[];
}

export function groupedSites(query = ''): SiteGroup[] {
    const q = query.trim().toLowerCase();
    const filtered = ALL_SITES.filter((s) => {
        if (!q) return true;
        return (
            s.id.toLowerCase().includes(q)
            || s.place.toLowerCase().includes(q)
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
    const place = site.place.toLowerCase();
    const st = site.state.toLowerCase();
    if (id === q || iem === q) return 1;
    if (id.startsWith(q) || iem.startsWith(q)) return 2;
    if (place.startsWith(q)) return 3;
    if (place.includes(q)) return 4;
    if (st === q || st.startsWith(q)) return 5;
    if (id.includes(q) || iem.includes(q) || st.includes(q)) return 6;
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
