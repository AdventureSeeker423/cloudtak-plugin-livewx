<template>
    <div>
        <p class='text-secondary small mb-3'>
            Enable Fire Weather Zones on the Layers page. Starred zones and RFW/FWW shading appear when the feed includes those attributes.
        </p>
        <button
            class='btn btn-sm btn-outline-primary mb-3'
            type='button'
            @click='load'
        >
            Lookup zone at point
        </button>
        <p
            v-if='error'
            class='text-danger small'
        >
            {{ error }}
        </p>
        <div
            v-if='zone'
            class='small'
        >
            <div><strong>{{ zone.name }}</strong> ({{ zone.id }})</div>
            <div class='text-secondary'>
                {{ zone.state }} · WFO {{ zone.wfo }}
            </div>
            <a
                v-if='zone.url'
                :href='zone.url'
                target='_blank'
                rel='noopener'
            >Zone forecast</a>
        </div>
        <h4 class='mt-3 mb-2'>
            Starred
        </h4>
        <ul class='list-unstyled small'>
            <li
                v-for='z in starred'
                :key='z.id'
            >
                {{ z.name }}
                <button
                    class='btn btn-link btn-sm'
                    type='button'
                    @click='unstar(z.id)'
                >
                    Remove
                </button>
            </li>
            <li
                v-if='!starred.length'
                class='text-secondary'
            >
                None — look up a zone and star it.
            </li>
        </ul>
        <button
            v-if='zone'
            class='btn btn-sm btn-outline-secondary'
            type='button'
            @click='star'
        >
            Star this zone
        </button>
    </div>
</template>

<script setup lang='ts'>
import { ref } from 'vue';
import { fetchJson } from '../../core/egress.ts';
import { persist, state } from '../../core/state.ts';

type Zone = { id: string; name: string; state: string; wfo: string; url?: string };

const zone = ref<Zone | null>(null);
const error = ref('');
const starred = ref<Zone[]>(loadStarred());

function loadStarred(): Zone[] {
    try {
        const raw = localStorage.getItem('livewx-starred-zones');
        return raw ? JSON.parse(raw) as Zone[] : [];
    } catch {
        return [];
    }
}

function saveStarred(): void {
    localStorage.setItem('livewx-starred-zones', JSON.stringify(starred.value));
}

async function load(): Promise<void> {
    error.value = '';
    zone.value = null;
    if (state.queryLat == null || state.queryLon == null) {
        error.value = 'No query point';
        return;
    }
    try {
        const pts = await fetchJson(`https://api.weather.gov/points/${state.queryLat},${state.queryLon}`);
        const props = (pts as { properties?: Record<string, string> }).properties || {};
        const fireWx = props.fireWeatherZone;
        if (!fireWx) {
            error.value = 'No fire weather zone for this point';
            return;
        }
        const z = await fetchJson(fireWx);
        const zp = (z as { properties?: Record<string, string>; id?: string }).properties || {};
        zone.value = {
            id: zp.id || (z as { id?: string }).id || fireWx,
            name: zp.name || 'Fire weather zone',
            state: zp.state || '',
            wfo: props.cwa || '',
            url: props.forecastZone || fireWx,
        };
        void persist;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Lookup failed';
    }
}

function star(): void {
    if (!zone.value) return;
    if (starred.value.some((z) => z.id === zone.value!.id)) return;
    starred.value.push(zone.value);
    saveStarred();
}

function unstar(id: string): void {
    starred.value = starred.value.filter((z) => z.id !== id);
    saveStarred();
}
</script>
