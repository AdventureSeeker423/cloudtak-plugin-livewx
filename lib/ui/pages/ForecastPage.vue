<template>
    <div>
        <div class='d-flex flex-wrap gap-2 align-items-center mb-3'>
            <label class='form-label mb-0 small'>
                Source
            </label>
            <select
                class='form-select form-select-sm'
                style='max-width: 14rem'
                :value='state.forecastSourceId'
                @change='onSource'
            >
                <option
                    v-for='s in sources'
                    :key='s.sourceId'
                    :value='s.sourceId'
                >
                    {{ s.displayName }}
                </option>
            </select>
            <button
                class='btn btn-sm btn-outline-primary'
                type='button'
                @click='reload'
            >
                Refresh
            </button>
            <span class='text-secondary small'>{{ forecastAge() }}</span>
        </div>
        <p
            v-if='forecast.error'
            class='text-danger small'
        >
            {{ forecast.error }}
        </p>
        <p class='text-secondary small mb-3'>
            {{ forecast.attribution }}
        </p>

        <h4 class='mb-2'>
            Now
        </h4>
        <div class='row g-2 mb-3'>
            <div
                v-for='row in nowRows'
                :key='row.label'
                class='col-6'
            >
                <div class='small text-secondary'>
                    {{ row.label }}
                </div>
                <div class='fw-bold'>
                    {{ row.value }}
                </div>
            </div>
        </div>

        <h4 class='mb-2'>
            Next hours
        </h4>
        <div class='table-responsive mb-3'>
            <table class='table table-sm table-striped'>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Temp</th>
                        <th>Wind</th>
                        <th>PoP</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for='h in hourlyRows'
                        :key='h.t'
                    >
                        <td>{{ h.time }}</td>
                        <td>{{ h.temp }}</td>
                        <td>{{ h.wind }}</td>
                        <td>{{ h.pop }}</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <h4 class='mb-2'>
            Synopsis (AFD)
        </h4>
        <pre
            v-if='forecast.afd'
            class='small livewx-afd'
        >{{ afdPreview }}</pre>
        <p
            v-else
            class='text-secondary small'
        >
            AFD unavailable.
        </p>
    </div>
</template>

<script setup lang='ts'>
import { computed } from 'vue';
import { persist, state } from '../../core/state.ts';
import {
    convertSpeed,
    convertTemp,
    convertLength,
    degToCompass,
} from '../../core/units.ts';
import {
    availableSources,
    forecast,
    forecastAge,
    readingByLabel,
    refreshForecast,
} from '../../forecast/engine.ts';

const sources = availableSources();

const nowRows = computed(() => {
    const u = state.units;
    const rows: Array<{ label: string; value: string }> = [];
    const temp = readingByLabel('temperature', 'temperature_2m');
    if (temp?.current != null) {
        const c = convertTemp(temp.current, u);
        rows.push({ label: 'Temp', value: `${c.value}${c.unit}` });
    }
    const rh = readingByLabel('relativeHumidity', 'relative_humidity', 'RH');
    if (rh?.current != null) rows.push({ label: 'RH', value: `${Math.round(rh.current)}%` });
    const wind = readingByLabel('twentyFootWindSpeed', 'windSpeed', 'wind_speed');
    const wdir = readingByLabel('twentyFootWindDirection', 'windDirection', 'wind_direction');
    if (wind?.current != null) {
        const s = convertSpeed(wind.current, u);
        const dir = wdir?.current != null ? degToCompass(wdir.current) : '';
        rows.push({ label: 'Wind', value: `${s.value} ${s.unit} ${dir}`.trim() });
    }
    const gust = readingByLabel('windGust', 'wind_gusts');
    if (gust?.current != null) {
        const s = convertSpeed(gust.current, u);
        rows.push({ label: 'Gust', value: `${s.value} ${s.unit}` });
    }
    const mix = readingByLabel('mixingHeight');
    if (mix?.current != null) {
        const l = convertLength(mix.current, u);
        rows.push({ label: 'Mixing Height', value: `${l.value} ${l.unit}` });
    }
    const tw = readingByLabel('transportWindSpeed');
    if (tw?.current != null) {
        const s = convertSpeed(tw.current, u);
        rows.push({ label: 'Transport Wind', value: `${s.value} ${s.unit}` });
    }
    const wbgt = readingByLabel('wetBulbGlobeTemperature', 'WBGT');
    if (wbgt?.current != null) {
        const c = convertTemp(wbgt.current, u);
        rows.push({ label: 'WBGT', value: `${c.value}${c.unit}` });
    }
    const pop = readingByLabel('probabilityOfPrecipitation', 'precipitation_probability', 'PoP');
    if (pop?.current != null) rows.push({ label: 'PoP', value: `${Math.round(pop.current)}%` });
    const sky = readingByLabel('skyCover', 'cloud_cover');
    if (sky?.current != null) rows.push({ label: 'Sky', value: `${Math.round(sky.current)}%` });
    return rows;
});

const hourlyRows = computed(() => {
    const temp = readingByLabel('temperature', 'temperature_2m');
    const wind = readingByLabel('windSpeed', 'wind_speed', 'twentyFootWindSpeed');
    const pop = readingByLabel('probabilityOfPrecipitation', 'precipitation_probability');
    const times = temp?.series?.slice(0, 36) ?? [];
    return times.map((pt, i) => {
        const t = convertTemp(pt.v ?? 0, state.units);
        const w = wind?.series?.[i]?.v;
        const ws = w != null ? convertSpeed(w, state.units) : null;
        const p = pop?.series?.[i]?.v;
        return {
            t: pt.t,
            time: new Date(pt.t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric' }),
            temp: pt.v != null ? `${t.value}${t.unit}` : '—',
            wind: ws ? `${ws.value}` : '—',
            pop: p != null ? `${Math.round(p)}%` : '—',
        };
    });
});

const afdPreview = computed(() => {
    const t = forecast.afd || '';
    return t.length > 4000 ? `${t.slice(0, 4000)}…` : t;
});

function onSource(e: Event): void {
    state.forecastSourceId = (e.target as HTMLSelectElement).value;
    persist();
    void refreshForecast();
}

function reload(): void {
    void refreshForecast();
}
</script>

<style scoped>
.livewx-afd {
    white-space: pre-wrap;
    max-height: 16rem;
    overflow: auto;
    background: transparent;
    color: inherit;
}
</style>
