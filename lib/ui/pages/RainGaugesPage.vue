<template>
    <div>
        <p class='text-secondary small mb-3'>
            USGS / CoCoRaHS / WFO rainfall reports. Enable Rain Totals on Layers for MRMS imagery.
        </p>
        <button
            class='btn btn-sm btn-outline-primary mb-3'
            type='button'
            @click='load'
        >
            Nearby USGS 24h precip
        </button>
        <p
            v-if='error'
            class='text-danger small'
        >
            {{ error }}
        </p>
        <ul class='list-unstyled small'>
            <li
                v-for='g in gauges'
                :key='g.id'
                class='border-bottom py-2'
            >
                <strong>{{ g.name }}</strong>
                <div class='text-secondary'>
                    {{ g.value }}
                </div>
            </li>
        </ul>
        <a
            class='btn btn-sm btn-outline-secondary mt-2'
            href='https://waterdata.usgs.gov/nwis'
            target='_blank'
            rel='noopener'
        >USGS NWIS</a>
    </div>
</template>

<script setup lang='ts'>
import { ref } from 'vue';
import { fetchJson } from '../../core/egress.ts';
import { state } from '../../core/state.ts';

const gauges = ref<Array<{ id: string; name: string; value: string }>>([]);
const error = ref('');

async function load(): Promise<void> {
    error.value = '';
    gauges.value = [];
    if (state.queryLat == null || state.queryLon == null) {
        error.value = 'No query point';
        return;
    }
    try {
        const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&parameterCd=00045&siteStatus=active&siteType=ST&bBox=${state.queryLon - 0.5},${state.queryLat - 0.5},${state.queryLon + 0.5},${state.queryLat + 0.5}`;
        const body = await fetchJson<{
            value?: { timeSeries?: Array<{
                sourceInfo?: { siteName?: string; siteCode?: Array<{ value?: string }> };
                values?: Array<{ value?: Array<{ value?: string }> }>;
            }> };
        }>(url);
        gauges.value = (body.value?.timeSeries ?? []).slice(0, 40).map((ts, i) => ({
            id: ts.sourceInfo?.siteCode?.[0]?.value || String(i),
            name: ts.sourceInfo?.siteName || 'Gauge',
            value: ts.values?.[0]?.value?.[0]?.value != null
                ? `${ts.values[0].value[0].value} in (precip)`
                : '—',
        }));
        if (!gauges.value.length) error.value = 'No USGS precip sites in bbox';
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Load failed';
    }
}
</script>
