<template>
    <div>
        <p class='text-secondary small mb-3'>
            Enable Weather Stations on Layers. Red Flag coloring uses zone criteria when attributes allow.
        </p>
        <p class='small'>
            Query point: {{ state.queryLat }}, {{ state.queryLon }}
        </p>
        <p class='text-secondary small'>
            Favorites use the chrome ★ control. Distance filters and wind barbs render on the map when the station feed returns geometry.
        </p>
        <button
            class='btn btn-sm btn-outline-primary'
            type='button'
            @click='enable'
        >
            Enable stations layer
        </button>
    </div>
</template>

<script setup lang='ts'>
import { state } from '../../core/state.ts';
import { setLayerEnabled } from '../../layers/registry.ts';

function enable(): void {
    void setLayerEnabled('weather_stations', true);
}
</script>
