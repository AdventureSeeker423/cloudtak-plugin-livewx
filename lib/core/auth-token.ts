/**
 * CloudTAK session token for same-origin /api/* calls.
 * Auth requires Authorization: Bearer or ?token= (see api/common/auth.ts).
 */

let cached: string | undefined;
let lastRefresh = 0;
const REFRESH_MS = 30_000;

type PrefsPlugin = {
    get: (opts: { key: string }) => Promise<{ value: string | null }>;
};

function capacitorPreferences(): PrefsPlugin | null {
    try {
        const Cap = (globalThis as { Capacitor?: { Plugins?: { Preferences?: PrefsPlugin } } }).Capacitor;
        return Cap?.Plugins?.Preferences ?? null;
    } catch {
        return null;
    }
}

function fromLocalStorage(): string | undefined {
    try {
        // Capacitor Preferences web default group prefix is "CapacitorStorage."
        for (const key of ['CapacitorStorage.token', 'token', '_cap_token']) {
            const v = localStorage.getItem(key);
            if (v) return v;
        }
    } catch {
        /* ignore */
    }
    return undefined;
}

async function readToken(): Promise<string | undefined> {
    const prefs = capacitorPreferences();
    if (prefs) {
        try {
            const { value } = await prefs.get({ key: 'token' });
            if (value) return value;
        } catch {
            /* fall through */
        }
    }
    return fromLocalStorage();
}

/** Refresh the cached token (call on plugin init and before layer starts). */
export async function refreshAuthToken(): Promise<string | undefined> {
    cached = await readToken();
    lastRefresh = Date.now();
    return cached;
}

/** Sync accessor for MapLibre tile URL builders. */
export function authToken(): string | undefined {
    if (!cached || Date.now() - lastRefresh > REFRESH_MS) {
        // Kick a background refresh; return last known value for this paint.
        void refreshAuthToken();
    }
    return cached;
}

/** Attach Bearer header when we have a token. */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const t = authToken();
    const out: Record<string, string> = { ...extra };
    if (t && !out.Authorization) out.Authorization = `Bearer ${t}`;
    return out;
}

/**
 * Append ?token= / &token= for MapLibre tile requests (CloudTAK fonts use the same pattern).
 * Prefer Authorization headers for fetch(); use this when the browser cannot set headers.
 */
export function withAuthQuery(url: string): string {
    const t = authToken();
    if (!t) return url;
    if (/[?&]token=/.test(url)) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`;
}
