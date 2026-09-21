import type { FilterKind } from './products.ts';

export interface PaletteStop {
    value: number;
    r: number;
    g: number;
    b: number;
}

/** Approximate IEM / NWS 8-bit reflectivity ramp (dBZ). */
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

function dist2(r: number, g: number, b: number, stop: PaletteStop): number {
    const dr = r - stop.r;
    const dg = g - stop.g;
    const db = b - stop.b;
    return dr * dr + dg * dg + db * db;
}

export function estimateValue(r: number, g: number, b: number, kind: FilterKind): number {
    const ramp = kind === 'velocity' ? VELOCITY_RAMP : REFLECTIVITY_RAMP;
    let best = ramp[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const stop of ramp) {
        const d = dist2(r, g, b, stop);
        if (d < bestD) {
            bestD = d;
            best = stop;
        }
    }
    // Far from every ramp color (terrain leftover, labels) — keep the pixel.
    if (bestD > 90 * 90) return Number.POSITIVE_INFINITY;
    return best.value;
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
        const value = estimateValue(data[i], data[i + 1], data[i + 2], kind);
        if (value < threshold) {
            data[i + 3] = 0;
        }
    }
}
