/* eslint-disable */
/**
 * CloudTAK server routes for LiveWX:
 *  - Blitzortung relay (clients never connect to Blitzortung directly)
 *  - Optional allowlisted HTTPS proxy for CORS-blocked weather hosts
 *
 * Copy to CloudTAK api/stateless/routes/ via install.sh.
 *
 * Export signature must match other plugin routes (e.g. plugin-qpd.ts):
 *   export default async function router(schema, config)
 */
import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Err from '@openaddresses/batch-error';
import Auth from '../../common/auth.js';
import type ConfigStateless from '../config.js';

type Strike = { lat: number; lon: number; timeMs: number };

type WsLike = {
    readyState: number;
    send: (data: string) => void;
    close: () => void;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
};

const WS_SERVERS = [
    'wss://ws1.blitzortung.org',
    'wss://ws7.blitzortung.org',
    'wss://ws8.blitzortung.org',
];

const PROXY_ALLOW = new Set([
    'api.weather.gov',
    'api.open-meteo.com',
    'mapservices.weather.noaa.gov',
    'nowcoast.noaa.gov',
    'services.arcgis.com',
    'services3.arcgis.com',
    'api.water.noaa.gov',
    'www.ndbc.noaa.gov',
    'earthquake.usgs.gov',
    'api.avalanche.org',
    'services.dat.noaa.gov',
    'api.rainviewer.com',
    'tilecache.rainviewer.com',
    'mesonet.agron.iastate.edu',
    'opengeo.ncep.noaa.gov',
    'geo.weather.gc.ca',
    'fsapps.nwcg.gov',
    'www.nfmdb.org',
    'gacc.nifc.gov',
    'maps.water.noaa.gov',
    'www.nhc.noaa.gov',
    'api.tidesandcurrents.noaa.gov',
    'wcc.sc.egov.usda.gov',
    'data.cocorahs.org',
    'waterservices.usgs.gov',
    'spot.weather.gov',
    'geocoding.geo.census.gov',
]);

const MAX_STRIKES = 4000;
const STALE_MS = 10 * 60_000;
const WS_CLOSED = 3;

let strikes: Strike[] = [];
let upstream: WsLike | null = null;
let upstreamIdx = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let connected = false;
let wsCtor: (new (url: string) => WsLike) | null | undefined;
let wsLoadAttempted = false;

function lzwDecode(input: string): string {
    const dict: Record<number, string> = {};
    const data = input.split('');
    let currChar = data[0];
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    let phrase: string;
    for (let i = 1; i < data.length; i++) {
        const currCode = data[i].charCodeAt(0);
        if (currCode < 256) phrase = data[i];
        else phrase = dict[currCode] ? dict[currCode] : (oldPhrase + currChar);
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join('');
}

function prune(): void {
    const cutoff = Date.now() - STALE_MS;
    strikes = strikes.filter((s) => s.timeMs >= cutoff);
}

async function loadWsCtor(): Promise<(new (url: string) => WsLike) | null> {
    if (wsLoadAttempted) return wsCtor ?? null;
    wsLoadAttempted = true;
    // Prefer Node built-in WebSocket (Node 22+) so we do not hard-depend on `ws`.
    const g = globalThis as { WebSocket?: new (url: string) => WsLike };
    if (typeof g.WebSocket === 'function') {
        wsCtor = g.WebSocket;
        return wsCtor;
    }
    try {
        const mod = await import('ws');
        wsCtor = (mod.default || mod) as new (url: string) => WsLike;
        return wsCtor;
    } catch (err) {
        console.error('[livewx] WebSocket client unavailable — lightning relay disabled', err);
        wsCtor = null;
        return null;
    }
}

function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connectUpstream();
    }, 4000);
}

async function connectUpstream(): Promise<void> {
    const Ctor = await loadWsCtor();
    if (!Ctor) {
        connected = false;
        return;
    }
    if (upstream) {
        try { upstream.close(); } catch { /* ignore */ }
        upstream = null;
    }
    const url = WS_SERVERS[upstreamIdx % WS_SERVERS.length];
    upstreamIdx++;
    try {
        upstream = new Ctor(url);
    } catch (err) {
        console.error('[livewx] upstream connect failed', err);
        connected = false;
        scheduleReconnect();
        return;
    }

    // Support both EventTarget (built-in) and EventEmitter (`ws`) styles.
    const sock = upstream as WsLike & {
        addEventListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };

    const onOpen = () => {
        connected = true;
        try { upstream?.send(JSON.stringify({ a: 111 })); } catch { /* ignore */ }
    };
    const onMessage = (...args: unknown[]) => {
        try {
            const data = args[0];
            const raw = typeof data === 'string'
                ? data
                : (data && typeof data === 'object' && 'data' in (data as object)
                    ? String((data as { data: unknown }).data)
                    : String(data));
            const decoded = lzwDecode(raw);
            const rec = JSON.parse(decoded) as { lat?: number; lon?: number; time?: number };
            if (typeof rec.lat !== 'number' || typeof rec.lon !== 'number') return;
            strikes.push({
                lat: rec.lat,
                lon: rec.lon,
                timeMs: rec.time ? Math.round(rec.time / 1e6) : Date.now(),
            });
            if (strikes.length > MAX_STRIKES) strikes = strikes.slice(-MAX_STRIKES + 500);
        } catch {
            /* ignore */
        }
    };
    const onClose = () => {
        connected = false;
        scheduleReconnect();
    };
    const onError = () => {
        connected = false;
        try { upstream?.close(); } catch { /* ignore */ }
    };

    if (typeof sock.on === 'function') {
        sock.on('open', onOpen);
        sock.on('message', onMessage);
        sock.on('close', onClose);
        sock.on('error', onError);
    } else if (typeof sock.addEventListener === 'function') {
        sock.addEventListener('open', onOpen);
        sock.addEventListener('message', onMessage);
        sock.addEventListener('close', onClose);
        sock.addEventListener('error', onError);
    }
}

async function ensureUpstream(): Promise<void> {
    if (!pruneTimer) {
        pruneTimer = setInterval(prune, 5000);
    }
    if (!upstream || upstream.readyState === WS_CLOSED) {
        await connectUpstream();
    }
}

export default async function router(schema: Schema, config: ConfigStateless) {
    // Do NOT connect upstream at boot — lazy on first lightning request.
    // A bad import/connect must never prevent the API from starting.

    await schema.get('/livewx/lightning', {
        name: 'LiveWX Lightning Relay',
        group: 'LiveWX',
        description: 'Recent Blitzortung strikes via CloudTAK relay (CC BY-SA 4.0). Not for warnings.',
        query: Type.Object({
            since: Type.Optional(Type.Integer()),
        }),
        res: Type.Object({
            connected: Type.Boolean(),
            attribution: Type.String(),
            disclaimer: Type.String(),
            strikes: Type.Array(Type.Object({
                lat: Type.Number(),
                lon: Type.Number(),
                timeMs: Type.Integer(),
            })),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            await ensureUpstream();
            prune();
            const since = Number(req.query.since) || 0;
            const out = strikes.filter((s) => s.timeMs > since);
            res.json({
                connected,
                attribution: 'Lightning data © Blitzortung.org & contributors (CC BY-SA 4.0)',
                disclaimer: 'Entertainment / situational awareness only — not for life safety or official warning.',
                strikes: out.slice(-1000),
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/livewx/proxy', {
        name: 'LiveWX Proxy',
        group: 'LiveWX',
        description: 'Allowlisted HTTPS proxy for weather hosts blocked by browser CORS.',
        query: Type.Object({
            url: Type.String(),
        }),
    }, async (req, res) => {
        try {
            await Auth.as_user(config, req);
            let target: URL;
            try {
                target = new URL(String(req.query.url));
            } catch {
                throw new Err(400, null, 'Invalid url');
            }
            if (target.protocol !== 'https:' || !PROXY_ALLOW.has(target.hostname)) {
                throw new Err(403, null, 'Host not allowlisted');
            }
            const upstreamRes = await fetch(target.toString(), {
                headers: {
                    Accept: 'application/geo+json, application/json, image/*, */*',
                    'User-Agent': 'CloudTAK-LiveWX-Relay/2.0',
                },
            });
            const ct = upstreamRes.headers.get('content-type') || 'application/octet-stream';
            res.header('Content-Type', ct);
            res.status(upstreamRes.status);
            const buf = Buffer.from(await upstreamRes.arrayBuffer());
            res.send(buf);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
