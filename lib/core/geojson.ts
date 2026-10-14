export type Position = number[];

export type Geometry =
    | { type: 'Point'; coordinates: Position }
    | { type: 'MultiPoint'; coordinates: Position[] }
    | { type: 'LineString'; coordinates: Position[] }
    | { type: 'MultiLineString'; coordinates: Position[][] }
    | { type: 'Polygon'; coordinates: Position[][] }
    | { type: 'MultiPolygon'; coordinates: Position[][][] }
    | { type: 'GeometryCollection'; geometries: Geometry[] };

export type Feature<P = Record<string, unknown>> = {
    type: 'Feature';
    geometry: Geometry | null;
    properties: P | null;
    id?: string | number;
};

export type FeatureCollection<P = Record<string, unknown>> = {
    type: 'FeatureCollection';
    features: Feature<P>[];
};

export function emptyFeatureCollection(): FeatureCollection {
    return { type: 'FeatureCollection', features: [] };
}
