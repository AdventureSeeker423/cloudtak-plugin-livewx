/**
 * Format and hour-boundary helpers in an IANA timezone (forecast location).
 */

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
