/**
 * Format and hour-boundary helpers in an IANA timezone (forecast / station location).
 */
import { fetchJson, roundCoord, TtlCache } from './egress.ts';

const timeZoneCache = new TtlCache<string>(7 * 24 * 60 * 60_000);

function pathGet(obj: unknown, path: string): unknown {
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

function tzKey(lat: number, lon: number): string {
    return `${roundCoord(lat)}|${roundCoord(lon)}`;
}

/** Store a known IANA timezone for a point (e.g. from an NWS points resolve). */
export function cacheTimeZone(lat: number, lon: number, timeZone: string): void {
    if (timeZone) timeZoneCache.set(tzKey(lat, lon), timeZone);
}

/** IANA timezone for a lat/lon via NWS points (cached). Empty outside coverage. */
export async function timeZoneAt(lat: number, lon: number): Promise<string> {
    const key = tzKey(lat, lon);
    const hit = timeZoneCache.get(key);
    if (hit) return hit;
    try {
        const body = await fetchJson(`https://api.weather.gov/points/${roundCoord(lat)},${roundCoord(lon)}`);
        const tz = pathGet(body, 'properties.timeZone');
        if (typeof tz === 'string' && tz.length > 0) {
            timeZoneCache.set(key, tz);
            return tz;
        }
    } catch {
        /* outside NWS coverage */
    }
    return '';
}

/** Offset of `timeZone` from UTC at `at`, in ms (east of UTC is positive). */
export function tzOffsetMs(timeZone: string, at: number): number {
    const d = new Date(at);
    const local = new Date(d.toLocaleString('en-US', { timeZone }));
    const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
    return local.getTime() - utc.getTime();
}

/** Start of the current clock hour in `timeZone`, as UTC epoch ms. */
export function currentHourStartMs(timeZone: string, now = Date.now()): number {
    const offset = tzOffsetMs(timeZone, now);
    const local = now + offset;
    const startLocal = Math.floor(local / 3_600_000) * 3_600_000;
    return startLocal - offset;
}

export function formatInTimeZone(
    ms: number,
    timeZone: string,
    opts: Intl.DateTimeFormatOptions,
): string {
    try {
        return new Date(ms).toLocaleString(undefined, { ...opts, timeZone });
    } catch {
        return new Date(ms).toLocaleString(undefined, opts);
    }
}

/** e.g. "1:42 PM" in the given timezone. */
export function formatLocalClock(timeZone: string, at = Date.now()): string {
    return formatInTimeZone(at, timeZone, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

/**
 * Observation / report time in the station's local zone.
 * Falls back to UTC with a Z suffix when timezone is unknown.
 */
export function formatStationLocal(ms: number, timeZone: string): string {
    if (!Number.isFinite(ms)) return '—';
    if (!timeZone) {
        return `${new Date(ms).toLocaleString(undefined, {
            timeZone: 'UTC',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        })} UTC`;
    }
    return formatInTimeZone(ms, timeZone, {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZoneName: 'short',
    });
}
