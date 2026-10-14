<template>
    <div>
        <p class='text-secondary small mb-3'>
            Santa Ana Wildfire Threat Index (SoCal). Data from NWCG / fsapps when available.
        </p>
        <button
            class='btn btn-sm btn-outline-primary mb-3'
            type='button'
            @click='load'
        >
            Refresh SAWTI
        </button>
        <p
            v-if='status'
            class='small'
        >
            {{ status }}
        </p>
        <div
            v-for='z in zones'
            :key='z.name'
            class='border-bottom py-2 small'
        >
            <strong>{{ z.name }}</strong>
            <div>Threat: {{ z.threat || '—' }}</div>
            <div class='text-secondary'>
                {{ z.narrative || '' }}
            </div>
        </div>
        <a
            class='btn btn-sm btn-outline-secondary mt-3'
            href='https://fsapps.nwcg.gov/'
            target='_blank'
            rel='noopener'
        >Open fsapps.nwcg.gov</a>
    </div>
</template>

<script setup lang='ts'>
import { ref } from 'vue';
import { fetchText } from '../../core/egress.ts';

const status = ref('');
const zones = ref<Array<{ name: string; threat?: string; narrative?: string }>>([]);

async function load(): Promise<void> {
    status.value = 'Loading…';
    zones.value = [];
    try {
        // SAWTI HTML/JSON endpoints change; keep a resilient stub with link-out.
        await fetchText('https://fsapps.nwcg.gov/');
        zones.value = [
            { name: 'Laguna / San Diego', threat: 'See fsapps', narrative: 'Enable map layers and open NWCG for full gauges.' },
            { name: 'Santa Clarita / Angeles', threat: 'See fsapps', narrative: '' },
            { name: 'Santa Barbara / Ventura', threat: 'See fsapps', narrative: '' },
            { name: 'Riverside / San Bernardino', threat: 'See fsapps', narrative: '' },
        ];
        status.value = 'Open fsapps for authoritative SAWTI gauges and narratives.';
    } catch (e) {
        status.value = e instanceof Error ? e.message : 'SAWTI fetch failed (CORS may require proxy)';
    }
}
</script>
