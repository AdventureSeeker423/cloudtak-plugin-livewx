<template>
    <div>
        <p class='text-secondary small mb-3'>
            Local Storm Reports — not warnings. Enable Storm Reports on Layers or refresh the list below.
        </p>
        <button
            class='btn btn-sm btn-outline-primary mb-3'
            type='button'
            @click='load'
        >
            Load recent reports
        </button>
        <p
            v-if='error'
            class='text-danger small'
        >
            {{ error }}
        </p>
        <ul class='list-unstyled small'>
            <li
                v-for='r in reports'
                :key='r.id'
                class='border-bottom py-2'
            >
                <strong>{{ r.type }}</strong> — {{ r.place }}
                <div class='text-secondary'>
                    {{ r.time }} · {{ r.mag }}
                </div>
            </li>
        </ul>
    </div>
</template>

<script setup lang='ts'>
import { ref } from 'vue';
import { MAPSERVICES_NWS } from '../../core/constants.ts';
import { fetchJson } from '../../core/egress.ts';
import type { FeatureCollection } from '../../core/geojson.ts';

const reports = ref<Array<{ id: string; type: string; place: string; time: string; mag: string }>>([]);
const error = ref('');

async function load(): Promise<void> {
    error.value = '';
    reports.value = [];
    try {
        const url = `${MAPSERVICES_NWS}/vector/rest/services/hazards/wwa_summary/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=100`;
        const fc = await fetchJson<FeatureCollection>(url);
        reports.value = (fc.features || []).slice(0, 50).map((f, i) => {
            const p = f.properties || {};
            return {
                id: String(f.id ?? i),
                type: String(p.event || p.phenom || p.type || 'Report'),
                place: String(p.location || p.name || p.county || ''),
                time: String(p.issuance || p.updated || p.begintime || ''),
                mag: String(p.magnitude || p.hailsize || p.windspeed || ''),
            };
        });
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Load failed';
    }
}
</script>
