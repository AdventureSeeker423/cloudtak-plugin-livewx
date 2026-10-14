<template>
    <div>
        <p class='text-secondary small mb-3'>
            NDBC buoys — enable Buoys on Layers. Graded by sea state when wave height is in properties.
        </p>
        <button
            class='btn btn-sm btn-outline-primary me-2'
            type='button'
            @click='enable'
        >
            Enable buoys layer
        </button>
        <a
            class='btn btn-sm btn-outline-secondary'
            href='https://www.ndbc.noaa.gov/'
            target='_blank'
            rel='noopener'
        >ndbc.noaa.gov</a>
    </div>
</template>

<script setup lang='ts'>
import { setLayerEnabled } from '../../layers/registry.ts';

function enable(): void {
    void setLayerEnabled('buoys', true);
}
</script>
