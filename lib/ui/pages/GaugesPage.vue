<template>
    <div>
        <p class='text-secondary small mb-3'>
            River gauges from AHPS / NOAA Water. Enable River Gauges on Layers, then tap a gauge on the map.
        </p>
        <button
            class='btn btn-sm btn-outline-primary me-2'
            type='button'
            @click='enable'
        >
            Enable gauges layer
        </button>
        <a
            class='btn btn-sm btn-outline-secondary'
            href='https://water.noaa.gov/'
            target='_blank'
            rel='noopener'
        >water.noaa.gov</a>
        <p class='text-secondary small mt-3'>
            Hydrographs open from gauge attributes when present (stage / flow / flood stages).
        </p>
    </div>
</template>

<script setup lang='ts'>
import { setLayerEnabled } from '../../layers/registry.ts';

function enable(): void {
    void setLayerEnabled('river_gauges', true);
}
</script>
