<template>
    <div class='livewx-app'>
        <div class='livewx-chrome mb-2'>
            <div
                v-if='state.page !== "home"'
                class='mb-2'
            >
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    @click='setPage("home")'
                >
                    ← Back
                </button>
            </div>
            <div class='d-flex flex-wrap gap-2 align-items-center'>
                <select
                    class='form-select form-select-sm'
                    style='max-width: 8rem'
                    :value='state.pointMode'
                    @change='onPointMode'
                >
                    <option value='self'>
                        Me
                    </option>
                    <option value='center'>
                        Center
                    </option>
                    <option value='pick'>
                        Pick
                    </option>
                    <option value='favorite'>
                        Favorite
                    </option>
                </select>
                <select
                    v-if='state.pointMode === "favorite"'
                    class='form-select form-select-sm'
                    style='max-width: 9rem'
                    :value='state.favoriteId || ""'
                    @change='onFavorite'
                >
                    <option
                        disabled
                        value=''
                    >
                        Select…
                    </option>
                    <option
                        v-for='f in state.favorites'
                        :key='f.id'
                        :value='f.id'
                    >
                        {{ f.name }}
                    </option>
                </select>
                <select
                    class='form-select form-select-sm'
                    style='max-width: 6rem'
                    :value='state.units'
                    @change='onUnits'
                >
                    <option value='us'>
                        US
                    </option>
                    <option value='metric'>
                        Metric
                    </option>
                    <option value='aviation'>
                        Avn
                    </option>
                </select>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    title='Favorite'
                    @click='addFav'
                >
                    ★
                </button>
                <span class='text-secondary small text-truncate'>
                    <span v-if='state.placeName'>{{ state.placeName }}</span>
                    <span v-else-if='state.queryLat != null'>
                        {{ state.queryLat }}, {{ state.queryLon }}
                    </span>
                </span>
            </div>
        </div>

        <MasterPane v-if='state.page === "home"' />
        <ForecastPage v-else-if='state.page === "forecast"' />
        <RadarContainer
            v-else-if='state.page === "radar"'
            :api='api'
        />
    </div>
</template>

<script setup lang='ts'>
import type { PluginAPI } from '@tak-ps/cloudtak';
import { refreshQueryPoint } from '../core/point.ts';
import {
    addFavorite,
    selectFavorite,
    setPage,
    setPointMode,
    setUnits,
    state,
    type PointMode,
} from '../core/state.ts';
import type { UnitSystem } from '../core/units.ts';
import { refreshForecast } from '../forecast/engine.ts';
import RadarContainer from '../radar/RadarContainer.vue';
import ForecastPage from './pages/ForecastPage.vue';
import MasterPane from './pages/MasterPane.vue';

defineProps<{ api: PluginAPI }>();

async function afterPointChange(): Promise<void> {
    await refreshQueryPoint();
    void refreshForecast();
}

function onPointMode(e: Event): void {
    setPointMode((e.target as HTMLSelectElement).value as PointMode);
    void afterPointChange();
}

function onUnits(e: Event): void {
    setUnits((e.target as HTMLSelectElement).value as UnitSystem);
}

function onFavorite(e: Event): void {
    selectFavorite((e.target as HTMLSelectElement).value);
    void afterPointChange();
}

function addFav(): void {
    if (state.queryLat == null || state.queryLon == null) return;
    const name = window.prompt('Favorite name', state.placeName || 'Favorite');
    if (!name) return;
    addFavorite(name, state.queryLat, state.queryLon);
    void afterPointChange();
}
</script>

<style scoped>
.livewx-app {
    color: inherit;
}
.livewx-chrome {
    border-bottom: 1px solid var(--livewx-border, var(--tblr-border-color, #333));
    padding-bottom: 0.5rem;
}
</style>
