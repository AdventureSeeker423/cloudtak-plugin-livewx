import type { FilterKind } from './products.ts';

export interface PaletteStop {
    value: number;
    r: number;
    g: number;
    b: number;
}

/**
 * IEM composite_n0q 256-color LUT (index 0 missing, then −32 dBZ … 95 dBZ at 0.5).
 * https://mesonet.agron.iastate.edu/GIS/rasters.php?rid=2
 */
const N0Q_HEX = [
    '00000085718f85728f86738d87758b87768b887789897987',
    '897a878a7b858b7d848b7e848c7f828d81808d82808e837e',
    '8f847c8f857c90877b918879918979928b77938d75969153',
    '9894579b975b9d9a60a09d64a3a068a5a36da8a671aaa976',
    'adac7ab0af7eb2b283b7b88cbabb90bdbe94bfc199c2c49d',
    'c4c7a2c7caa6cacdaaccd0afd2d4b4cfd2b4c9ccb4c6c9b4',
    'c3c7b4c0c4b4bdc1b4b9beb4b6bbb4b3b9b4b0b6b4adb3b4',
    'aab0b4a4abb4a0a8b49da5b49aa2b497a0b4949db4919ab4',
    '949bb59098b48c95b38892b2808cb07c89af7886ae7483ac',
    '7080ab6c7daa6779a96376a85f73a75b70a6576da44f67a2',
    '4b64a14761a0435e9f415b9e4361a24568a6486faa4a76ae',
    '4d7db24f84b6518bbb5699c3599fc75ba6cb5eadcf60b4d4',
    '62bbd865c2dc67c9e06ad0e46fd6e868d6d759d6b352d6a2',
    '4bd69043d67e3cd66d35d65b11d51811d11710cd1710c816',
    '10c4160fbc150fb7140eb3140eaf130eab130da6120da212',
    '0d9e110c99110c95100c91100b880f0b840e0a800e0a7c0d',
    '0a770d09730c096f0c096b0b08660b08620a095e09327308',
    '467d085b88076f9207849d0698a806adb205c1bd05d6c704',
    'ead204ffe200ffd800ffd300ffce00ffc900ffc400ffc000',
    'ffbb00ffb600ffb100ffac00ffa700ffa200ff9900ff9400',
    'ff8f00ff8a00ff8500ff8000ff0000f80000f10000ea0000',
    'e30000d50000cd0000c60000bf0000b80000b10000aa0000',
    'a300009b00009400008d00007f0000780000710000ffffff',
    'fff5ffffeaffffdfffffd4ffffc9ffffbeffffb3ffff9dff',
    'ff92ffff75fffc6bfdf960faf656f7f34bf4f040f1ed36ef',
    'ea2bece720e9e10be3b200ffac00fca400f79b00f49300ef',
    '8800ea8300e87900e27200dd6900db05ecf005ebf005eaf0',
    '05dde005dce005dbe005cdd005ccd004bdc004bcc004bbc0',
    '04aeb004adb0049ea0049da0049ca0038e90038d90038c90',
    '037e80037d80036f70036e70036d70025f60025e60024f50',
    '024e50024d50023f40023e40023d40013030012f30012020',
    '011f20011e203a67b53a66b53a65b53a64b53a63b53a62b5',
].join('');

/** IEM N0R / classic NWS 5 dBZ web colors (RIDGE tiles still use these). */
const N0R_STOPS: PaletteStop[] = [
    { value: 0, r: 0, g: 236, b: 236 },
    { value: 5, r: 1, g: 160, b: 246 },
    { value: 10, r: 0, g: 0, b: 246 },
    { value: 15, r: 0, g: 255, b: 0 },
    { value: 20, r: 0, g: 200, b: 0 },
    { value: 25, r: 0, g: 144, b: 0 },
    { value: 30, r: 255, g: 255, b: 0 },
    { value: 35, r: 231, g: 192, b: 0 },
    { value: 40, r: 255, g: 144, b: 0 },
    { value: 45, r: 255, g: 0, b: 0 },
    { value: 50, r: 214, g: 0, b: 0 },
    { value: 55, r: 192, g: 0, b: 0 },
    { value: 60, r: 255, g: 0, b: 255 },
    { value: 65, r: 153, g: 85, b: 201 },
    { value: 70, r: 255, g: 255, b: 255 },
];

/** Approximate NWS 8-bit reflectivity ramp used on some RIDGE renders. */
export const REFLECTIVITY_RAMP: PaletteStop[] = [
    { value: 5, r: 4, g: 233, b: 231 },
    { value: 10, r: 1, g: 159, b: 244 },
    { value: 15, r: 3, g: 0, b: 244 },
    { value: 20, r: 2, g: 253, b: 2 },
    { value: 25, r: 1, g: 197, b: 1 },
    { value: 30, r: 0, g: 142, b: 0 },
    { value: 35, r: 253, g: 248, b: 2 },
    { value: 40, r: 229, g: 188, b: 0 },
    { value: 45, r: 253, g: 139, b: 0 },
    { value: 50, r: 253, g: 0, b: 0 },
    { value: 55, r: 212, g: 0, b: 0 },
    { value: 60, r: 188, g: 0, b: 0 },
    { value: 65, r: 248, g: 0, b: 253 },
    { value: 70, r: 153, g: 85, b: 201 },
    { value: 75, r: 253, g: 253, b: 253 },
];

/** Approximate NWS base velocity ramp; value is |knots|. */
export const VELOCITY_RAMP: PaletteStop[] = [
    { value: 0, r: 150, g: 150, b: 150 },
    { value: 5, r: 2, g: 200, b: 2 },
    { value: 10, r: 0, g: 140, b: 0 },
    { value: 15, r: 1, g: 90, b: 1 },
    { value: 20, r: 253, g: 180, b: 180 },
    { value: 25, r: 253, g: 100, b: 100 },
    { value: 30, r: 253, g: 0, b: 0 },
    { value: 40, r: 180, g: 0, b: 0 },
    { value: 50, r: 120, g: 0, b: 0 },
];

const KEEP = 32767;
const MAX_DIST2 = 40 * 40;

function n0qStops(): PaletteStop[] {
    const hex = N0Q_HEX;
    const out: PaletteStop[] = [];
    for (let i = 1; i < 256; i++) {
        const o = i * 6;
        const r = Number.parseInt(hex.slice(o, o + 2), 16);
        const g = Number.parseInt(hex.slice(o + 2, o + 4), 16);
        const b = Number.parseInt(hex.slice(o + 4, o + 6), 16);
        if (r + g + b < 12) continue;
        out.push({
            value: -32 + (i - 1) * 0.5,
            r,
            g,
            b,
        });
    }
    return out;
}

function dist2(r: number, g: number, b: number, stop: PaletteStop): number {
    const dr = r - stop.r;
    const dg = g - stop.g;
    const db = b - stop.b;
    return dr * dr + dg * dg + db * db;
}

function qIndex(r: number, g: number, b: number): number {
    return ((r >> 3) * 1024) + ((g >> 3) * 32) + (b >> 3);
}

function nearestValue(r: number, g: number, b: number, stops: PaletteStop[]): number {
    let best = KEEP;
    let bestD = MAX_DIST2;
    for (const stop of stops) {
        const d = dist2(r, g, b, stop);
        if (d < bestD) {
            bestD = d;
            best = Math.round(stop.value * 2);
        }
    }
    return best;
}

function buildRefCube(): Int16Array {
    const stops = [...n0qStops(), ...N0R_STOPS, ...REFLECTIVITY_RAMP];
    const cube = new Int16Array(32 * 32 * 32);
    cube.fill(KEEP);
    for (const stop of stops) {
        cube[qIndex(stop.r, stop.g, stop.b)] = Math.round(stop.value * 2);
    }
    for (let i = 0; i < cube.length; i++) {
        if (cube[i] !== KEEP) continue;
        const r = ((i >> 10) << 3) + 4;
        const g = (((i >> 5) & 31) << 3) + 4;
        const b = ((i & 31) << 3) + 4;
        if (r + g + b < 24) continue;
        cube[i] = nearestValue(r, g, b, stops);
    }
    return cube;
}

const REF_CUBE = buildRefCube();

function blueNoiseFallback(r: number, g: number, b: number): number {
    // Unmatched muted blues / cyans are almost always 0–15 dBZ clutter.
    if (b > 90 && b >= g && b > r + 15 && g < 210) return 10;
    return Number.POSITIVE_INFINITY;
}

export function estimateValue(r: number, g: number, b: number, kind: FilterKind): number {
    if (kind === 'velocity') {
        let best = VELOCITY_RAMP[0];
        let bestD = Number.POSITIVE_INFINITY;
        for (const stop of VELOCITY_RAMP) {
            const d = dist2(r, g, b, stop);
            if (d < bestD) {
                bestD = d;
                best = stop;
            }
        }
        if (bestD > 90 * 90) return Number.POSITIVE_INFINITY;
        return best.value;
    }
    const packed = REF_CUBE[qIndex(r, g, b)];
    if (packed === KEEP) return blueNoiseFallback(r, g, b);
    return packed / 2;
}

export function filterImageData(
    data: Uint8ClampedArray,
    kind: FilterKind,
    threshold: number,
): void {
    if (threshold <= 0) return;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a < 8) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r + g + b < 12) continue;
        const value = estimateValue(r, g, b, kind);
        if (value < threshold) {
            data[i + 3] = 0;
        }
    }
}
