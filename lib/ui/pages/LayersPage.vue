<template>
    <div>
        <p class='text-secondary small mb-3'>
            Toggle a layer to draw it on the map. Hosts contacted are listed under each row. Overlays are read-only — not CoT.
        </p>

        <div
            v-for='group in groups'
            :key='group'
            class='mb-3'
        >
            <div class='d-flex align-items-center mb-2'>
                <h4 class='mb-0 flex-grow-1'>
                    {{ groupLabels[group] }}
                </h4>
                <button
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    :disabled='groupBusy(group)'
                    @click='onGroup(group, true)'
                >
                    All on
                </button>
                <button
                    class='btn btn-sm btn-outline-secondary ms-1'
                    type='button'
                    :disabled='groupBusy(group)'
                    @click='onGroup(group, false)'
                >
                    All off
                </button>
            </div>
            <div
                v-for='layer in layersInGroup(group)'
                :key='layer.id'
                class='border-bottom py-2'
            >
                <div class='form-check form-switch'>
                    <input
                        :id='`lyr-${layer.id}`'
                        class='form-check-input'
                        type='checkbox'
                        :checked='enabledMap[layer.id]'
                        :disabled='Boolean(layerUi.busy[layer.id])'
                        @change='onToggle(layer.id, ($event.target as HTMLInputElement).checked)'
                    >
                    <label
                        class='form-check-label'
                        :for='`lyr-${layer.id}`'
                    >
                        {{ layer.label }}
                        <span
                            v-if='layer.experimental'
                            class='badge bg-secondary ms-1'
                        >exp</span>
                    </label>
                </div>
                <p class='text-secondary small mb-0 ms-4'>
                    {{ layerUi.status[layer.id] || layer.description }}
                </p>
                <p
                    v-if='layer.hosts.length'
                    class='text-secondary small mb-0 ms-4'
                >
                    Hosts: {{ layer.hosts.join(', ') }}
                </p>
                <p
                    v-if='layer.keyHtml && enabledMap[layer.id]'
                    class='small ms-4 mb-0'
                >
                    Key: {{ layer.keyHtml }}
                </p>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, onMounted } from 'vue';
import { state } from '../../core/state.ts';
import {
    GROUP_LABELS,
    layerUi,
    layersInGroup,
    refreshAllStatuses,
    setGroupEnabled,
    setLayerEnabled,
    type LayerGroupId,
} from '../../layers/registry.ts';

const groups: LayerGroupId[] = [
    'alerts',
    'wind',
    'fire',
    'rain_rivers',
    'ocean',
    'storms',
    'snow',
    'ground',
    'spot_stations',
];
const groupLabels = GROUP_LABELS;

/** Reactive map of id → enabled so switches update when state.layers changes. */
const enabledMap = computed(() => {
    const out: Record<string, boolean> = {};
    for (const g of groups) {
        for (const layer of layersInGroup(g)) {
            out[layer.id] = Boolean(state.layers[layer.id]?.enabled);
        }
    }
    return out;
});

onMounted(() => refreshAllStatuses());

function groupBusy(group: LayerGroupId): boolean {
    return layersInGroup(group).some((l) => layerUi.busy[l.id]);
}

function onToggle(id: string, on: boolean): void {
    void setLayerEnabled(id, on);
}

function onGroup(group: LayerGroupId, on: boolean): void {
    void setGroupEnabled(group, on);
}
</script>
