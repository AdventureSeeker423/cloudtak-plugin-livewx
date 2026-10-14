<template>
    <div class='livewx-app'>
        <div class='livewx-chrome mb-3'>
            <div class='d-flex flex-wrap gap-2 align-items-center mb-2'>
                <select
                    class='form-select form-select-sm'
                    style='max-width: 9rem'
                    :value='state.pointMode'
                    @change='onPointMode'
                >
                    <option value='self'>
                        My position
                    </option>
                    <option value='center'>
                        Map center
                    </option>
                    <option value='pick'>
                        Pick a point
                    </option>
                    <option value='favorite'>
                        Favorite
                    </option>
                </select>
                <select
                    v-if='state.pointMode === "favorite"'
                    class='form-select form-select-sm'
                    style='max-width: 10rem'
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
                    style='max-width: 7rem'
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
                        Aviation
                    </option>
                </select>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    title='Add map center as favorite'
                    @click='addFav'
                >
                    ★
                </button>
            </div>
            <p
                v-if='state.pointMode === "pick"'
                class='text-secondary small mb-2'
            >
                Tap the map to set the forecast / query point.
            </p>
            <div class='d-flex flex-wrap gap-1 mb-2'>
                <button
                    v-for='p in primaryPages'
                    :key='p'
                    class='btn btn-sm'
                    :class='state.page === p ? "btn-primary" : "btn-outline-secondary"'
                    type='button'
                    @click='setPage(p)'
                >
                    {{ pageLabels[p] }}
                </button>
            </div>
            <select
                class='form-select form-select-sm mb-2'
                :value='state.page'
                @change='onPageSelect'
            >
                <option
                    v-for='(label, id) in pageLabels'
                    :key='id'
                    :value='id'
                >
                    {{ label }}
                </option>
            </select>
            <p class='text-secondary small mb-0'>
                <span v-if='state.placeName'>{{ state.placeName }} · </span>
                <span v-if='state.queryLat != null'>
                    {{ state.queryLat }}, {{ state.queryLon }}
                </span>
            </p>
        </div>

        <ForecastPage v-if='state.page === "forecast"' />
        <LayersPage v-else-if='state.page === "layers"' />
        <RadarContainer
            v-else-if='state.page === "radar"'
            :api='api'
        />
        <SpotPage v-else-if='state.page === "spot"' />
        <ZonesPage v-else-if='state.page === "zones"' />
        <SawtiPage v-else-if='state.page === "sawti"' />
        <FireDangerPage v-else-if='state.page === "fire_danger"' />
        <StationsPage v-else-if='state.page === "stations"' />
        <GaugesPage v-else-if='state.page === "gauges"' />
        <BuoysPage v-else-if='state.page === "buoys"' />
        <StormReportsPage v-else-if='state.page === "storm_reports"' />
        <RainGaugesPage v-else-if='state.page === "rain_gauges"' />
    </div>
</template>

<script setup lang='ts'>
import type { PluginAPI } from '@tak-ps/cloudtak';
import { PAGE_LABELS, PRIMARY_PAGES, type AppPageId } from '../core/constants.ts';
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
import BuoysPage from './pages/BuoysPage.vue';
import FireDangerPage from './pages/FireDangerPage.vue';
import ForecastPage from './pages/ForecastPage.vue';
import GaugesPage from './pages/GaugesPage.vue';
import LayersPage from './pages/LayersPage.vue';
import RainGaugesPage from './pages/RainGaugesPage.vue';
import SawtiPage from './pages/SawtiPage.vue';
import SpotPage from './pages/SpotPage.vue';
import StationsPage from './pages/StationsPage.vue';
import StormReportsPage from './pages/StormReportsPage.vue';
import ZonesPage from './pages/ZonesPage.vue';

defineProps<{ api: PluginAPI }>();

const primaryPages = PRIMARY_PAGES;
const pageLabels = PAGE_LABELS;

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

function onPageSelect(e: Event): void {
    setPage((e.target as HTMLSelectElement).value as AppPageId);
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
    padding-bottom: 0.75rem;
}
</style>
