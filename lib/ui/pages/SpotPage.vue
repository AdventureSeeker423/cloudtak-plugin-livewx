<template>
    <div>
        <p class='text-secondary small mb-3'>
            Browse open NWS spot forecasts on the map (enable Spot Forecasts layer), or compose a request helper for spot.weather.gov.
        </p>
        <h4 class='mb-2'>
            Request helper
        </h4>
        <p class='small mb-2'>
            Point: {{ state.queryLat }}, {{ state.queryLon }}
        </p>
        <p class='small mb-2'>
            USNG (approx): {{ usng }}
        </p>
        <ol class='small mb-3'>
            <li>Copy the coordinates / USNG below.</li>
            <li>Open spot.weather.gov and paste into the request form.</li>
            <li>Submit from a browser — this plugin does not send the request for you.</li>
        </ol>
        <button
            class='btn btn-sm btn-primary me-2'
            type='button'
            @click='copyCoords'
        >
            Copy lat,lon
        </button>
        <a
            class='btn btn-sm btn-outline-secondary'
            href='https://spot.weather.gov/'
            target='_blank'
            rel='noopener'
        >Open spot.weather.gov</a>
        <div class='mt-3'>
            <label class='form-label small'>
                Address geocode (Census, optional)
            </label>
            <div class='input-group input-group-sm'>
                <input
                    v-model='address'
                    class='form-control'
                    type='text'
                    placeholder='Street, City, State'
                >
                <button
                    class='btn btn-outline-secondary'
                    type='button'
                    @click='geocode'
                >
                    Geocode
                </button>
            </div>
            <p
                v-if='geoMsg'
                class='small mt-1'
            >
                {{ geoMsg }}
            </p>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed, ref } from 'vue';
import { fetchJson } from '../../core/egress.ts';
import { setPickPoint, state } from '../../core/state.ts';
import { refreshForecast } from '../../forecast/engine.ts';
import { refreshQueryPoint } from '../../core/point.ts';

const address = ref('');
const geoMsg = ref('');

/** Coarse USNG-like grid label (not a full MGRS implementation). */
const usng = computed(() => {
    if (state.queryLat == null || state.queryLon == null) return '—';
    return `${state.queryLat.toFixed(3)}N ${Math.abs(state.queryLon).toFixed(3)}W`;
});

function copyCoords(): void {
    if (state.queryLat == null || state.queryLon == null) return;
    void navigator.clipboard?.writeText(`${state.queryLat}, ${state.queryLon}`);
}

async function geocode(): Promise<void> {
    geoMsg.value = '';
    if (!address.value.trim()) return;
    try {
        const url = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address.value)}&benchmark=Public_AR_Current&format=json`;
        const body = await fetchJson<{
            result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> };
        }>(url);
        const m = body.result?.addressMatches?.[0];
        if (!m?.coordinates) {
            geoMsg.value = 'No match';
            return;
        }
        setPickPoint(m.coordinates.y, m.coordinates.x);
        await refreshQueryPoint();
        void refreshForecast();
        geoMsg.value = 'Point updated from address';
    } catch (e) {
        geoMsg.value = e instanceof Error ? e.message : 'Geocode failed';
    }
}
</script>
