<template>
    <div class='livewx-pane'>
        <p class='text-secondary small mb-3'>
            Live NEXRAD overlay from Iowa Environmental Mesonet. Watches and warnings from the National Weather Service.
        </p>

        <div class='form-check form-switch mb-3'>
            <input
                id='livewx-overlay'
                class='form-check-input'
                type='checkbox'
                :checked='state.overlayEnabled'
                @change='onOverlayToggle'
            >
            <label
                class='form-check-label'
                for='livewx-overlay'
            >
                Radar overlay
            </label>
        </div>

        <label
            class='form-label mb-1'
            for='livewx-opacity'
        >
            Transparency {{ Math.round((1 - state.opacity) * 100) }}%
        </label>
        <input
            id='livewx-opacity'
            class='form-range mb-3'
            type='range'
            min='0'
            max='100'
            :value='Math.round(state.opacity * 100)'
            @input='onOpacity'
        >

        <label
            class='form-label mb-1'
            for='livewx-site-search'
        >
            Radar site
        </label>
        <input
            id='livewx-site-search'
            v-model='siteQuery'
            class='form-control form-control-sm mb-2'
            type='search'
            placeholder='Search site, city, or state'
        >
        <select
            id='livewx-site'
            class='form-select form-select-sm mb-3'
            :value='state.siteId'
            @change='onSite'
        >
            <option :value='CONUS_SITE_ID'>
                CONUS Mosaic
            </option>
            <optgroup
                v-for='group in siteGroups'
                :key='group.state'
                :label='group.state'
            >
                <option
                    v-for='site in group.sites'
                    :key='site.id'
                    :value='site.id'
                >
                    {{ siteLabel(site) }}
                </option>
            </optgroup>
        </select>

        <div
            class='form-check form-switch'
            :class='state.sitesOnMap ? "mb-1" : "mb-3"'
        >
            <input
                id='livewx-sites'
                class='form-check-input'
                type='checkbox'
                :checked='state.sitesOnMap'
                @change='onSitesToggle'
            >
            <label
                class='form-check-label'
                for='livewx-sites'
            >
                Show radar sites on map
            </label>
        </div>
        <p
            v-if='state.sitesOnMap'
            class='text-secondary small mb-3'
        >
            WSR-88D in blue, TDWR in orange. Click a site to select it.
        </p>

        <label
            class='form-label mb-1'
            for='livewx-product'
        >
            Data type
        </label>
        <select
            id='livewx-product'
            class='form-select form-select-sm mb-1'
            :value='state.productId'
            @change='onProduct'
        >
            <optgroup
                v-for='group in productGroups'
                :key='group.group'
                :label='group.group'
            >
                <option
                    v-for='product in group.products'
                    :key='product.id'
                    :value='product.id'
                >
                    {{ product.label }}
                </option>
            </optgroup>
        </select>
        <p
            v-if='isMosaic(state.siteId)'
            class='text-secondary small mb-3'
        >
            Mosaic mode is reflectivity, echo tops, and precipitation. Pick a radar site for velocity and dual-pol.
        </p>
        <p
            v-else
            class='text-secondary small mb-3'
        >
            Level 2 names use the closest IEM Level 3 image (REF→N0B, VEL→N0U).
        </p>

        <label
            class='form-label mb-1'
            for='livewx-filter'
        >
            Filter {{ filterLabel }}
        </label>
        <input
            id='livewx-filter'
            class='form-range mb-3'
            type='range'
            min='0'
            :max='filterCeiling'
            :value='state.filter'
            :disabled='current?.filterKind === "other"'
            @input='onFilter'
        >

        <div class='form-check form-switch mb-3'>
            <input
                id='livewx-alerts'
                class='form-check-input'
                type='checkbox'
                :checked='state.alertsEnabled'
                @change='onAlertsToggle'
            >
            <label
                class='form-check-label'
                for='livewx-alerts'
            >
                Watches &amp; warnings
            </label>
        </div>
        <p
            v-if='state.alertsEnabled'
            class='text-secondary small mb-3'
        >
            {{ state.alertCount }} active nationwide (not limited to the selected radar).
        </p>
        <p
            v-if='state.selectedAlert'
            class='small mb-3'
        >
            {{ state.selectedAlert }}
        </p>

        <h4 class='subheader'>
            Replay
        </h4>
        <div class='d-flex gap-2 mb-2'>
            <button
                class='btn btn-sm btn-outline-secondary'
                type='button'
                :disabled='!frames.length'
                @click='onPlay'
            >
                {{ state.playing ? 'Pause' : 'Play' }}
            </button>
            <button
                class='btn btn-sm btn-outline-secondary'
                type='button'
                @click='onLive'
            >
                Live
            </button>
        </div>
        <input
            class='form-range mb-1'
            type='range'
            min='-1'
            :max='Math.max(frames.length - 1, 0)'
            :value='state.replayIndex'
            :disabled='!frames.length'
            @input='onReplay'
        >
        <p class='text-secondary small mb-3'>
            {{ frames.length ? (state.replayIndex < 0 ? 'Live' : frames[state.replayIndex]?.label) : 'No archive frames for this product' }}
        </p>

        <p
            class='small mb-0'
            :class='state.error ? "text-danger" : "text-secondary"'
        >
            {{ state.error || state.status }}
        </p>
    </div>
</template>

<script setup lang='ts'>
import { computed } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import { CONUS_SITE_ID } from './constants.ts';
import {
    currentProduct,
    applyAlerts,
    applyFilter,
    applyOpacity,
    applyRadarSettings,
    applySiteMarkers,
    availableCodes,
    goLive,
    replayFramesRef,
    setOverlayEnabled,
    setReplayIndex,
    togglePlay,
    visibleProducts,
} from './radar.ts';
import { groupedOptions, filterMax, filterUnit } from './products.ts';
import { groupedSites, isMosaic, siteLabel } from './sites.ts';
import { setAlertsEnabled, setFilter, setOpacity, setProduct, setSite, setSitesOnMap, siteQuery, state } from './state.ts';

defineProps<{
    api: PluginAPI;
}>();

const siteGroups = computed(() => groupedSites(siteQuery.value));
const productGroups = computed(() => {
    void availableCodes.value;
    return groupedOptions(visibleProducts());
});
const frames = computed(() => replayFramesRef.value);
const current = computed(() => currentProduct());
const filterCeiling = computed(() => filterMax(current.value?.filterKind ?? 'reflectivity'));
const filterLabel = computed(() => {
    const kind = current.value?.filterKind ?? 'reflectivity';
    if (kind === 'other') return 'n/a';
    if (state.filter <= 0) return `off`;
    return `≥ ${state.filter} ${filterUnit(kind)}`;
});

function onOverlayToggle(ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    void setOverlayEnabled(on);
}

function onOpacity(ev: Event): void {
    const n = Number((ev.target as HTMLInputElement).value);
    setOpacity(n / 100);
    applyOpacity();
}

function onSite(ev: Event): void {
    setSite((ev.target as HTMLSelectElement).value);
    void applyRadarSettings();
}

function onSitesToggle(ev: Event): void {
    setSitesOnMap((ev.target as HTMLInputElement).checked);
    applySiteMarkers();
}

function onProduct(ev: Event): void {
    setProduct((ev.target as HTMLSelectElement).value);
    void applyRadarSettings();
}

function onFilter(ev: Event): void {
    setFilter(Number((ev.target as HTMLInputElement).value));
    void applyFilter();
}

function onAlertsToggle(ev: Event): void {
    setAlertsEnabled((ev.target as HTMLInputElement).checked);
    applyAlerts();
}

function onPlay(): void {
    togglePlay();
}

function onLive(): void {
    goLive();
}

function onReplay(ev: Event): void {
    void setReplayIndex(Number((ev.target as HTMLInputElement).value));
}
</script>

<style scoped>
.livewx-pane {
    font-size: 14px;
}
.subheader {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
    margin-bottom: 8px;
}
</style>
