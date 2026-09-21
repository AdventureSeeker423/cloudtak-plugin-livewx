export type StyleLayer = { id: string; type: string };

export type LiveWxMap = {
    getLayer: (id: string) => unknown;
    getSource: (id: string) => unknown;
    addSource: (id: string, source: object) => void;
    addLayer: (layer: object, beforeId?: string) => void;
    removeLayer: (id: string) => void;
    removeSource: (id: string) => void;
    getStyle?: () => { layers?: StyleLayer[] };
    setPaintProperty?: (id: string, name: string, value: unknown) => void;
    on: (type: string, layerOrHandler: unknown, handler?: unknown) => void;
    off: (type: string, layerOrHandler: unknown, handler?: unknown) => void;
    once?: (type: string, handler: () => void) => void;
    isStyleLoaded?: () => boolean;
    queryRenderedFeatures?: (point: unknown, options?: object) => unknown[];
};
