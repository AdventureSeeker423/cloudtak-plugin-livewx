<template>
    <div>
        <p class='text-secondary small mb-3'>
            First enable prompts for consent (hosts + what is sent). Layers are read-only map overlays — not CoT.
        </p>

        <div
            v-if='layerUi.consentOpen'
            class='alert alert-warning'
        >
            <strong>{{ consentDef?.label }}</strong>
            <p class='small mb-2'>
                {{ consentDef?.description }}
            </p>
            <p class='small mb-1'>
                Hosts: {{ consentDef?.hosts.join(', ') || 'none' }}
            </p>
            <p class='small mb-3'>
                Sends: {{ consentDef?.sends }}
            </p>
            <button
                class='btn btn-sm btn-primary me-2'
                type='button'
                @click='confirmConsentAndEnable(layerUi.consentOpen!)'
            >
                Allow
            </button>
            <button
                class='btn btn-sm btn-outline-secondary'
                type='button'
                @click='cancelConsent'
            >
                Cancel
            </button>
        </div>

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
                    @click='toggleGroup(group, true)'
                >
                    All on
                </button>
                <button
                    class='btn btn-sm btn-outline-secondary ms-1'
                    type='button'
                    @click='toggleGroup(group, false)'
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
                        :checked='isEnabled(layer.id)'
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
                    v-if='layer.keyHtml && isEnabled(layer.id)'
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
import {
    GROUP_LABELS,
    cancelConsent,
    confirmConsentAndEnable,
    getLayer,
    isEnabled,
    layerUi,
    layersInGroup,
    refreshAllStatuses,
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

const consentDef = computed(() =>
    layerUi.consentOpen ? getLayer(layerUi.consentOpen) : undefined,
);

onMounted(() => refreshAllStatuses());

function onToggle(id: string, on: boolean): void {
    void setLayerEnabled(id, on);
}

function toggleGroup(group: LayerGroupId, on: boolean): void {
    for (const layer of layersInGroup(group)) {
        void setLayerEnabled(layer.id, on);
    }
}
</script>
