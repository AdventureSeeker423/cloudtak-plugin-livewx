export type ProductGroup = 'L2' | 'L3';
export type FilterKind = 'reflectivity' | 'velocity' | 'other';

export interface RadarProduct {
    id: string;
    group: ProductGroup;
    category: string;
    label: string;
    iemCode: string;
    mosaicLayer?: string;
    filterKind: FilterKind;
    tdwrCode?: string;
    /** IEM tilt family letter(s): N0B/N1B/N2B → "B". */
    tiltFamily?: string;
}

const TILT_LABELS = ['0.5°', '1.5°', '2.4°', '3.4°', '4.3°', '5.3°', '6.2°', '7.5°', '8.7°', '10.0°'];

/** Level 2 names mapped to the closest IEM Level 3 image. */
const LEVEL2: RadarProduct[] = [
    { id: 'L2:REF', group: 'L2', category: 'REF', label: 'Reflectivity', iemCode: 'N0B', mosaicLayer: 'nexrad-n0q', filterKind: 'reflectivity', tdwrCode: 'TZL', tiltFamily: 'B' },
    { id: 'L2:VEL', group: 'L2', category: 'VEL', label: 'Velocity', iemCode: 'N0U', filterKind: 'velocity', tdwrCode: 'TV0', tiltFamily: 'U' },
    { id: 'L2:SW', group: 'L2', category: 'SW', label: 'Spectrum Width', iemCode: 'NSW', filterKind: 'other' },
    { id: 'L2:ZDR', group: 'L2', category: 'ZDR', label: 'Differential Reflectivity', iemCode: 'N0X', filterKind: 'other', tiltFamily: 'X' },
    { id: 'L2:PHI', group: 'L2', category: 'PHI', label: 'Differential Phase', iemCode: 'N0K', filterKind: 'other', tiltFamily: 'K' },
    { id: 'L2:RHO', group: 'L2', category: 'RHO', label: 'Correlation Coefficient', iemCode: 'N0C', filterKind: 'other', tiltFamily: 'C' },
];

/** Level 3 AWIPS ids, limited to IEM RIDGE imagery. */
const LEVEL3: RadarProduct[] = [
    { id: 'L3:N0B', group: 'L3', category: 'REF', label: 'Reflectivity (N0B)', iemCode: 'N0B', mosaicLayer: 'nexrad-n0q', filterKind: 'reflectivity', tdwrCode: 'TZL', tiltFamily: 'B' },
    { id: 'L3:N0Q', group: 'L3', category: 'REF', label: 'Reflectivity (N0Q)', iemCode: 'N0Q', mosaicLayer: 'nexrad-n0q', filterKind: 'reflectivity', tdwrCode: 'TZL', tiltFamily: 'Q' },
    { id: 'L3:N0Z', group: 'L3', category: 'REF', label: 'Long-range Reflectivity (N0Z)', iemCode: 'N0Z', filterKind: 'reflectivity' },
    { id: 'L3:N0G', group: 'L3', category: 'VEL', label: 'Velocity (N0G)', iemCode: 'N0G', filterKind: 'velocity', tdwrCode: 'TV0', tiltFamily: 'G' },
    { id: 'L3:N0U', group: 'L3', category: 'VEL', label: 'Velocity (N0U)', iemCode: 'N0U', filterKind: 'velocity', tdwrCode: 'TV0', tiltFamily: 'U' },
    { id: 'L3:N0S', group: 'L3', category: 'SRM', label: 'Storm Relative Velocity (N0S)', iemCode: 'N0S', filterKind: 'velocity', tiltFamily: 'S' },
    { id: 'L3:NSW', group: 'L3', category: 'SW', label: 'Spectrum Width (NSW)', iemCode: 'NSW', filterKind: 'other' },
    { id: 'L3:N0X', group: 'L3', category: 'ZDR', label: 'Differential Reflectivity (N0X)', iemCode: 'N0X', filterKind: 'other', tiltFamily: 'X' },
    { id: 'L3:N0C', group: 'L3', category: 'CC', label: 'Correlation Coefficient (N0C)', iemCode: 'N0C', filterKind: 'other', tiltFamily: 'C' },
    { id: 'L3:N0K', group: 'L3', category: 'KDP', label: 'Specific Differential Phase (N0K)', iemCode: 'N0K', filterKind: 'other', tiltFamily: 'K' },
    { id: 'L3:N0H', group: 'L3', category: 'HC', label: 'Hydrometeor Classification (N0H)', iemCode: 'N0H', filterKind: 'other', tiltFamily: 'H' },
    { id: 'L3:EET', group: 'L3', category: 'ET', label: 'Enhanced Echo Tops (EET)', iemCode: 'EET', mosaicLayer: 'nexrad-eet', filterKind: 'other' },
    { id: 'L3:NET', group: 'L3', category: 'ET', label: 'Echo Tops (NET)', iemCode: 'NET', mosaicLayer: 'nexrad-eet', filterKind: 'other' },
    { id: 'L3:DAA', group: 'L3', category: 'ACC', label: '1-Hour Precipitation (DAA)', iemCode: 'DAA', mosaicLayer: 'q2-n1p', filterKind: 'other' },
    { id: 'L3:DTA', group: 'L3', category: 'ACC', label: 'Storm Total Precipitation (DTA)', iemCode: 'DTA', filterKind: 'other' },
];

export const ALL_PRODUCTS: RadarProduct[] = [...LEVEL3, ...LEVEL2];

export const MOSAIC_DEFAULT_PRODUCT_ID = 'L3:N0Q';
export const SITE_DEFAULT_PRODUCT_ID = 'L3:N0B';

export function knownProductCodes(): Set<string> {
    const known = new Set<string>();
    for (const product of ALL_PRODUCTS) {
        known.add(product.iemCode);
        if (product.tdwrCode) known.add(product.tdwrCode);
        if (product.tiltFamily) {
            for (let tilt = 0; tilt <= 9; tilt++) {
                known.add(`N${tilt}${product.tiltFamily}`);
            }
        }
    }
    return known;
}

export const FALLBACK_SITE_CODES = [...knownProductCodes()];

export function getProduct(id: string): RadarProduct | undefined {
    return ALL_PRODUCTS.find((p) => p.id === id);
}

export function mosaicProducts(): RadarProduct[] {
    return ALL_PRODUCTS.filter((p) => p.mosaicLayer);
}

export function siteCode(product: RadarProduct, siteType: string, tilt = 0): string {
    if (siteType === 'tdwr' && product.tdwrCode) return product.tdwrCode;
    if (product.tiltFamily && siteType !== 'mosaic') {
        return `N${tilt}${product.tiltFamily}`;
    }
    return product.iemCode;
}

function productCodes(product: RadarProduct, siteType: string): string[] {
    if (siteType === 'tdwr' && product.tdwrCode) return [product.tdwrCode];
    if (product.tiltFamily && siteType !== 'mosaic') {
        const codes: string[] = [];
        for (let tilt = 0; tilt <= 9; tilt++) {
            codes.push(`N${tilt}${product.tiltFamily}`);
        }
        return codes;
    }
    return [product.iemCode];
}

export function productsForSite(
    availableCodes: string[] | null,
    siteType: string,
): RadarProduct[] {
    const codes = availableCodes && availableCodes.length
        ? new Set(availableCodes.map((c) => c.toUpperCase()))
        : null;

    return ALL_PRODUCTS.filter((p) => {
        if (!codes) return true;
        return productCodes(p, siteType).some((code) => codes.has(code));
    });
}

export function availableTilts(
    product: RadarProduct | undefined,
    siteType: string,
    availableCodes: string[] | null,
): number[] {
    if (!product?.tiltFamily || siteType === 'tdwr' || siteType === 'mosaic') return [];
    const family = product.tiltFamily;
    const set = availableCodes && availableCodes.length
        ? new Set(availableCodes.map((c) => c.toUpperCase()))
        : null;
    const tilts: number[] = [];
    const max = set ? 9 : 3;
    for (let tilt = 0; tilt <= max; tilt++) {
        if (!set || set.has(`N${tilt}${family}`)) tilts.push(tilt);
    }
    return tilts;
}

export function tiltLabel(tilt: number): string {
    return TILT_LABELS[tilt] ?? `Tilt ${tilt}`;
}

export function defaultProductId(isMosaic: boolean): string {
    return isMosaic ? MOSAIC_DEFAULT_PRODUCT_ID : SITE_DEFAULT_PRODUCT_ID;
}

export function filterMax(kind: FilterKind): number {
    if (kind === 'velocity') return 50;
    if (kind === 'reflectivity') return 75;
    return 75;
}

export function filterUnit(kind: FilterKind): string {
    if (kind === 'velocity') return 'kts';
    if (kind === 'reflectivity') return 'dBZ';
    return '';
}

export function groupedOptions(products: RadarProduct[]): Array<{ group: string; products: RadarProduct[] }> {
    const l3 = products.filter((p) => p.group === 'L3');
    const l2 = products.filter((p) => p.group === 'L2');
    const out: Array<{ group: string; products: RadarProduct[] }> = [];
    if (l3.length) out.push({ group: 'Level 3', products: l3 });
    if (l2.length) out.push({ group: 'Level 2', products: l2 });
    return out;
}
