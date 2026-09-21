<template>
    <div class='livewx-pane'>
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
                Radar Overlay
            </label>
        </div>

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
                Watches &amp; Warnings
            </label>
        </div>
        <p
            v-if='state.alertsEnabled'
            class='text-secondary small mb-3'
        >
            {{ state.alertCount }} Active Nationwide (Not Limited To The Selected Radar).
        </p>

        <div class='form-check form-switch mb-3'>
            <input
                id='livewx-lightning'
                class='form-check-input'
                type='checkbox'
                :checked='state.lightningEnabled'
                @change='onLightningToggle'
            >
            <label
                class='form-check-label'
                for='livewx-lightning'
            >
                Lightning
            </label>
        </div>
        <template v-if='state.lightningEnabled'>
            <label
                class='form-label mb-1'
                for='livewx-lightning-lifetime'
            >
                Strike Lifetime {{ state.lightningStaleSec }}s
            </label>
            <input
                id='livewx-lightning-lifetime'
                class='form-range mb-2'
                type='range'
                min='15'
                max='600'
                step='15'
                :value='state.lightningStaleSec'
                @input='onLightningLifetime'
                @wheel.prevent='onLightningLifetimeWheel'
            >
            <p class='text-secondary small mb-3'>
                {{ lightningStatus }} · {{ lightning.inView.length }} In View
            </p>
        </template>

        <template v-if='state.overlayEnabled'>
            <label
                class='form-label mb-1'
                for='livewx-opacity'
            >
                Opacity {{ Math.round(state.opacity * 100) }}%
            </label>
            <input
                id='livewx-opacity'
                class='form-range mb-3'
                type='range'
                min='0'
                max='100'
                step='1'
                :value='Math.round(state.opacity * 100)'
                @input='onOpacity'
                @wheel.prevent='onOpacityWheel'
            >

            <label
                class='form-label mb-1'
                for='livewx-site-search'
            >
                Radar Site
            </label>
            <div
                ref='siteComboEl'
                class='site-combo mb-3'
            >
                <input
                    id='livewx-site-search'
                    class='form-control form-control-sm'
                    type='search'
                    autocomplete='off'
                    role='combobox'
                    aria-autocomplete='list'
                    aria-controls='livewx-site-list'
                    :aria-expanded='siteOpen ? "true" : "false"'
                    :placeholder='siteOpen ? "Search Site, City, Or State" : selectedSiteLabel'
                    :value='siteOpen ? siteDraft : selectedSiteLabel'
                    @focus='onSiteFocus'
                    @input='onSiteDraft'
                    @keydown='onSiteKey'
                >
                <div
                    v-if='siteOpen'
                    id='livewx-site-list'
                    class='site-menu'
                    role='listbox'
                >
                    <button
                        v-for='(site, idx) in siteMatches'
                        :key='site.id'
                        class='site-option'
                        :class='{ active: idx === siteHighlight }'
                        type='button'
                        role='option'
                        :aria-selected='idx === siteHighlight ? "true" : "false"'
                        @mousedown.prevent='pickSite(site.id)'
                    >
                        {{ siteLabel(site) }}
                    </button>
                    <div
                        v-if='!siteDraft.trim()'
                        class='site-empty'
                    >
                        Type A City, State, Or Site ID
                    </div>
                    <div
                        v-else-if='!siteMatches.length'
                        class='site-empty'
                    >
                        No Matching Sites
                    </div>
                </div>
            </div>

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
                    Show Radar Sites On Map
                </label>
            </div>
            <p
                v-if='state.sitesOnMap'
                class='text-secondary small mb-3'
            >
                WSR-88D In Blue, TDWR In Orange. Click A Site To Select It.
            </p>

            <div class='d-flex gap-2 align-items-end mb-1'>
                <div class='livewx-product'>
                    <label
                        class='form-label mb-1'
                        for='livewx-product'
                    >
                        Data Type
                    </label>
                    <select
                        id='livewx-product'
                        class='form-select form-select-sm'
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
                </div>
                <div
                    v-if='tiltOptions.length > 1'
                    class='livewx-tilt'
                >
                    <label
                        class='form-label mb-1'
                        for='livewx-tilt'
                    >
                        Tilt
                    </label>
                    <select
                        id='livewx-tilt'
                        class='form-select form-select-sm'
                        :value='state.tilt'
                        @change='onTilt'
                    >
                        <option
                            v-for='tilt in tiltOptions'
                            :key='tilt.index'
                            :value='tilt.index'
                        >
                            {{ tilt.label }}
                        </option>
                    </select>
                </div>
            </div>
            <p
                v-if='isMosaic(state.siteId)'
                class='text-secondary small mb-3'
            >
                Mosaic Mode Is Reflectivity, Echo Tops, And Precipitation. Pick A Radar Site For Velocity And Dual-Pol.
            </p>
            <p
                v-else
                class='text-secondary small mb-3'
            >
                Level 2 Names Use The Closest IEM Level 3 Image (REF→N0B, VEL→N0U).
            </p>

            <template v-if='filterAvailable'>
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
                    step='1'
                    :max='filterCeiling'
                    :value='state.filter'
                    @input='onFilter'
                    @wheel.prevent='onFilterWheel'
                >
            </template>

            <template v-if='frames.length'>
                <h4 class='subheader'>
                    Replay
                </h4>
                <div class='d-flex gap-2 mb-2'>
                    <button
                        class='btn btn-sm btn-outline-secondary'
                        type='button'
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
                <div class='replay-wrap mb-3'>
                    <input
                        class='form-range mb-0'
                        type='range'
                        min='0'
                        step='1'
                        :max='replaySliderMax'
                        :value='replaySliderValue'
                        @input='onReplay'
                        @wheel.prevent='onReplayWheel'
                    >
                    <div class='replay-ticks'>
                        <span
                            v-for='tick in replayTicks'
                            :key='tick.key'
                            class='replay-tick'
                            :class='{
                                "replay-tick-start": tick.align === "start",
                                "replay-tick-end": tick.align === "end",
                            }'
                            :style='{ left: tick.pct + "%" }'
                        >
                            {{ tick.label }}
                        </span>
                    </div>
                    <p
                        v-if='isLive'
                        class='small mb-0 mt-2'
                    >
                        Live Image · {{ liveAgeText }}
                    </p>
                    <p
                        v-else
                        class='text-secondary small mb-0 mt-2'
                    >
                        {{ replayCaption }}
                    </p>
                </div>
            </template>
        </template>

        <p
            class='small mb-0'
            :class='state.error ? "text-danger" : "text-secondary"'
        >
            {{ state.error || state.status }}
        </p>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { PluginAPI } from '@tak-ps/cloudtak';
import {
    currentProduct,
    applyAlerts,
    applyFilter,
    applyLightningToggle,
    applyOpacity,
    applyRadarSettings,
    applySiteMarkers,
    availableCodes,
    goLive,
    liveValidAt,
    replayFramesRef,
    setOverlayEnabled,
    setReplayIndex,
    togglePlay,
    visibleProducts,
} from './radar.ts';
import { lightning } from './lightning.ts';
import { groupedOptions, availableTilts, filterMax, filterUnit, tiltLabel } from './products.ts';
import { findSite, isMosaic, searchSites, siteLabel } from './sites.ts';
import {
    setAlertsEnabled,
    setFilter,
    setLightningEnabled,
    setLightningStaleSec,
    setOpacity,
    setProduct,
    setSite,
    setSitesOnMap,
    setTilt,
    state,
} from './state.ts';
import { ageLabel, shortAgeLabel } from './tiles.ts';

defineProps<{
    api: PluginAPI;
}>();

const siteComboEl = ref<HTMLElement | null>(null);
const siteOpen = ref(false);
const siteDraft = ref('');
const siteHighlight = ref(0);
const selectedSiteLabel = computed(() => {
    const site = findSite(state.siteId);
    return site ? siteLabel(site) : state.siteId;
});
const siteMatches = computed(() => searchSites(siteDraft.value));

const productGroups = computed(() => {
    void availableCodes.value;
    return groupedOptions(visibleProducts());
});
const frames = computed(() => replayFramesRef.value);
const current = computed(() => currentProduct());
const filterAvailable = computed(() => {
    const kind = current.value?.filterKind;
    return kind === 'reflectivity' || kind === 'velocity';
});
const filterCeiling = computed(() => filterMax(current.value?.filterKind ?? 'reflectivity'));
const filterLabel = computed(() => {
    const kind = current.value?.filterKind ?? 'reflectivity';
    if (state.filter <= 0) return 'Off';
    return `≥ ${state.filter} ${filterUnit(kind)}`;
});
const tiltOptions = computed(() => {
    void availableCodes.value;
    const product = current.value;
    if (!product || isMosaic(state.siteId)) return [];
    const site = findSite(state.siteId);
    return availableTilts(product, site?.type ?? 'wsr88d', availableCodes.value).map((index) => ({
        index,
        label: tiltLabel(index),
    }));
});

const nowMs = ref(Date.now());
let ageTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    ageTimer = setInterval(() => {
        nowMs.value = Date.now();
    }, 15_000);
    document.addEventListener('mousedown', onSiteDocDown);
});
onUnmounted(() => {
    if (ageTimer) clearInterval(ageTimer);
    document.removeEventListener('mousedown', onSiteDocDown);
});

const isLive = computed(() => state.replayIndex < 0);
const replaySliderMax = computed(() => Math.max(frames.value.length, 0));
const replaySliderValue = computed(() => (
    isLive.value ? replaySliderMax.value : state.replayIndex
));
const liveAgeText = computed(() => {
    void nowMs.value;
    if (liveValidAt.value == null) return 'Age Unknown';
    return ageLabel(liveValidAt.value, nowMs.value);
});
const replayCaption = computed(() => {
    void nowMs.value;
    if (!frames.value.length) return 'No Archive Frames For This Product';
    if (isLive.value) return liveValidAt.value != null
        ? `Live · ${ageLabel(liveValidAt.value, nowMs.value)}`
        : 'Live';
    const frame = frames.value[state.replayIndex];
    return frame ? ageLabel(frame.at, nowMs.value) : 'Replay';
});
const replayTicks = computed(() => {
    const list = frames.value;
    const now = nowMs.value;
    if (!list.length) {
        return [{ key: 'live', pct: 100, label: 'Live', align: 'end' as const }];
    }
    const maxIdx = list.length;
    const ticks: Array<{ key: string; pct: number; label: string; align: 'start' | 'center' | 'end' }> = [];
    const used = new Set<number>();
    const push = (idx: number, label: string, align: 'start' | 'center' | 'end'): void => {
        if (used.has(idx)) return;
        used.add(idx);
        ticks.push({
            key: `${idx}-${label}`,
            pct: (idx / maxIdx) * 100,
            label,
            align,
        });
    };
    push(0, shortAgeLabel(list[0].at, now), 'start');
    for (const target of [45, 30, 15]) {
        let best = -1;
        let bestD = 5;
        for (let i = 1; i < list.length; i++) {
            const d = Math.abs(Math.round((now - list[i].at) / 60_000) - target);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        if (best >= 0) push(best, shortAgeLabel(list[best].at, now), 'center');
    }
    push(maxIdx, 'Live', 'end');
    return ticks;
});

function onOverlayToggle(ev: Event): void {
    const on = (ev.target as HTMLInputElement).checked;
    if (!on) closeSiteMenu();
    void setOverlayEnabled(on);
}

function wheelStep(ev: WheelEvent): number {
    return ev.deltaY < 0 ? 1 : -1;
}

let lastFilterWheel = 0;

function onOpacity(ev: Event): void {
    setOpacity(Number((ev.target as HTMLInputElement).value) / 100);
    applyOpacity();
}

function onOpacityWheel(ev: WheelEvent): void {
    setOpacity((Math.round(state.opacity * 100) + wheelStep(ev)) / 100);
    applyOpacity();
}

function closeSiteMenu(): void {
    siteOpen.value = false;
    siteDraft.value = '';
    siteHighlight.value = 0;
}

function onSiteDocDown(ev: MouseEvent): void {
    const root = siteComboEl.value;
    if (!root || root.contains(ev.target as Node)) return;
    closeSiteMenu();
}

function onSiteFocus(): void {
    siteOpen.value = true;
    siteDraft.value = '';
    siteHighlight.value = 0;
}

function onSiteDraft(ev: Event): void {
    siteOpen.value = true;
    siteDraft.value = (ev.target as HTMLInputElement).value;
    siteHighlight.value = 0;
}

function pickSite(id: string): void {
    setSite(id);
    void applyRadarSettings();
    closeSiteMenu();
}

function onSiteKey(ev: KeyboardEvent): void {
    const matches = siteMatches.value;
    if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        siteOpen.value = true;
        if (!matches.length) return;
        siteHighlight.value = (siteHighlight.value + 1) % matches.length;
        return;
    }
    if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        siteOpen.value = true;
        if (!matches.length) return;
        siteHighlight.value = (siteHighlight.value - 1 + matches.length) % matches.length;
        return;
    }
    if (ev.key === 'Enter') {
        ev.preventDefault();
        const site = matches[siteHighlight.value] ?? matches[0];
        if (site) pickSite(site.id);
        return;
    }
    if (ev.key === 'Escape') {
        ev.preventDefault();
        closeSiteMenu();
    }
}

function onSitesToggle(ev: Event): void {
    setSitesOnMap((ev.target as HTMLInputElement).checked);
    applySiteMarkers();
}

function onProduct(ev: Event): void {
    setProduct((ev.target as HTMLSelectElement).value);
    void applyRadarSettings();
}

function onTilt(ev: Event): void {
    setTilt(Number((ev.target as HTMLSelectElement).value));
    void applyRadarSettings();
}

function onFilter(ev: Event): void {
    setFilter(Number((ev.target as HTMLInputElement).value));
    applyFilter();
}

function onFilterWheel(ev: WheelEvent): void {
    if (current.value?.filterKind === 'other') return;
    const now = performance.now();
    if (now - lastFilterWheel < 70) return;
    lastFilterWheel = now;
    setFilter(state.filter + wheelStep(ev));
    applyFilter();
}

function onAlertsToggle(ev: Event): void {
    setAlertsEnabled((ev.target as HTMLInputElement).checked);
    applyAlerts();
}

function onLightningToggle(ev: Event): void {
    setLightningEnabled((ev.target as HTMLInputElement).checked);
    applyLightningToggle();
}

function onLightningLifetime(ev: Event): void {
    setLightningStaleSec(Number((ev.target as HTMLInputElement).value));
}

function onLightningLifetimeWheel(ev: WheelEvent): void {
    setLightningStaleSec(state.lightningStaleSec + wheelStep(ev) * 15);
}

const lightningStatus = computed(() => {
    if (lightning.connected) return 'Connected';
    if (lightning.error) return lightning.error;
    return 'Connecting…';
});

function onPlay(): void {
    togglePlay();
}

function onLive(): void {
    goLive();
}

function onReplay(ev: Event): void {
    void setReplayIndex(Number((ev.target as HTMLInputElement).value));
}

function onReplayWheel(ev: WheelEvent): void {
    if (!frames.value.length) return;
    const cur = isLive.value ? frames.value.length : state.replayIndex;
    void setReplayIndex(cur + wheelStep(ev));
}
</script>

<style scoped>
.livewx-pane {
    font-size: 14px;
}
.livewx-product {
    flex: 1 1 auto;
    min-width: 0;
}
.livewx-tilt {
    flex: 0 0 7.25rem;
    width: 7.25rem;
}
.subheader {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.7;
    margin-bottom: 8px;
}
.replay-wrap {
    position: relative;
}
.replay-ticks {
    position: relative;
    height: 16px;
    margin-top: 2px;
}
.replay-tick {
    position: absolute;
    top: 0;
    font-size: 10px;
    line-height: 16px;
    color: var(--tblr-secondary, var(--tblr-navbar-color, inherit));
    transform: translateX(-50%);
    white-space: nowrap;
}
.replay-tick-start {
    transform: translateX(0);
}
.replay-tick-end {
    transform: translateX(-100%);
}
.site-combo {
    position: relative;
}
.site-menu {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 30;
    max-height: 240px;
    overflow-y: auto;
    margin-top: 2px;
    padding: 4px 0;
    color: var(--livewx-fg, var(--cloudtak-surface-color, inherit));
    background: var(--livewx-bg, var(--cloudtak-surface-bg, var(--cloudtak-panel-bg, inherit)));
    border: 1px solid var(--livewx-border, var(--cloudtak-surface-border, var(--tblr-border-color, rgba(127, 127, 127, 0.35))));
    border-radius: 4px;
    box-shadow: var(--tblr-box-shadow-lg, 0 8px 20px rgba(0, 0, 0, 0.35));
}
.site-option {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    font-size: 13px;
    line-height: 1.3;
    padding: 6px 10px;
}
.site-option:hover,
.site-option.active {
    background: var(--cloudtak-hover-bg, var(--cloudtak-active-bg, rgba(127, 127, 127, 0.2)));
    color: var(--cloudtak-active-color, inherit);
}
.site-empty {
    padding: 8px 10px;
    font-size: 12px;
    color: var(--tblr-secondary, inherit);
}
</style>
