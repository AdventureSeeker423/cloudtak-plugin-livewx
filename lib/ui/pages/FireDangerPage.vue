<template>
    <div>
        <p class='text-secondary small mb-3'>
            Enable Fire Danger (ERC) on Layers for PSA polygons. GACC ERC charts open from nifc.gov.
        </p>
        <label class='form-label small'>
            GACC chart
        </label>
        <select
            v-model='gacc'
            class='form-select form-select-sm mb-2'
        >
            <option
                v-for='g in gaccs'
                :key='g.id'
                :value='g.id'
            >
                {{ g.name }}
            </option>
        </select>
        <a
            class='btn btn-sm btn-outline-primary'
            :href='chartUrl'
            target='_blank'
            rel='noopener'
        >Open ERC chart</a>
        <p class='text-secondary small mt-3'>
            Alaska uses a Canadian system and is not ERC-shaded (same as Atmosphere).
        </p>
    </div>
</template>

<script setup lang='ts'>
import { computed, ref } from 'vue';

const gaccs = [
    { id: 'oscc', name: 'Southern California (OSCC)' },
    { id: 'oncc', name: 'Northern California (ONCC)' },
    { id: 'nwcc', name: 'Northwest (NWCC)' },
    { id: 'gbcc', name: 'Great Basin (GBCC)' },
    { id: 'swcc', name: 'Southwest (SWCC)' },
    { id: 'rmcc', name: 'Rocky Mountain (RMCC)' },
    { id: 'sacc', name: 'Southern (SACC)' },
    { id: 'eacc', name: 'Eastern (EACC)' },
];
const gacc = ref('oscc');
const chartUrl = computed(() => `https://gacc.nifc.gov/${gacc.value}/predictive/fuels-fire-danger/`);
</script>
