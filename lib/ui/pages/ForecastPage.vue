<template>
    <div>
        <div class='mb-3'>
            <div class='d-flex flex-wrap gap-2 align-items-center mb-2'>
                <button
                    class='btn btn-sm'
                    :class='pointUi.picking ? "btn-primary" : "btn-outline-primary"'
                    type='button'
                    @click='onSelectLocation'
                >
                    {{ pointUi.picking ? 'Click map…' : 'Select forecast location' }}
                </button>
                <button
                    v-if='pointUi.picking'
                    class='btn btn-sm btn-outline-secondary'
                    type='button'
                    @click='cancelLocationPick'
                >
                    Cancel
                </button>
            </div>
            <p
                v-if='pointUi.picking'
                class='text-secondary small mb-2'
            >
                Click the map to set the forecast point.
            </p>
            <p class='text-secondary small mb-0'>
                <template v-if='locationLine'>{{ locationLine }}</template>
                <template v-else>No location set</template>
            </p>
        </div>

        <div class='d-flex flex-wrap gap-2 align-items-center mb-3'>
            <label
                class='form-label mb-0 small'
                for='livewx-forecast-units'
            >
                Units
            </label>
            <select
                id='livewx-forecast-units'
                class='form-select form-select-sm'
                style='max-width: 7rem'
                :value='state.units'
                @change='onUnits'
            >
                <option value='us'>
                    US
                </option>
                <option value='metric'>
                    Metric
                </option>
                <option value='aviation'>
                    Avn
                </option>
            </select>
            <label
                class='form-label mb-0 small'
                for='livewx-forecast-source'
            >
                Source
            </label>
            <select
                id='livewx-forecast-source'
                class='form-select form-select-sm'
                style='max-width: 12rem'
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
                class='btn btn-sm btn-outline-secondary'
                type='button'
                :disabled='state.queryLat == null'
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
        <p
            v-if='forecast.attribution'
            class='text-secondary small mb-3'
        >
            {{ forecast.attribution }}
        </p>

        <template v-if='state.queryLat != null'>
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
        </template>
    </div>
</template>

<script setup lang='ts'>
import { computed, onUnmounted } from 'vue';
import {
    beginLocationPick,
    cancelLocationPick,
    pointUi,
} from '../../core/point.ts';
import { persist, setUnits, state } from '../../core/state.ts';
import {
    convertSpeed,
    convertTemp,
    convertLength,
    degToCompass,
    type UnitSystem,
} from '../../core/units.ts';
import {
    availableSources,
    forecast,
    forecastAge,
    readingByLabel,
    refreshForecast,
} from '../../forecast/engine.ts';

const sources = availableSources();

const locationLine = computed(() => {
    if (state.placeName) return state.placeName;
    if (state.queryLat != null && state.queryLon != null) {
        return `${state.queryLat}, ${state.queryLon}`;
    }
    return '';
});

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

onUnmounted(() => {
    if (pointUi.picking) cancelLocationPick();
});

function onSelectLocation(): void {
    if (pointUi.picking) {
        cancelLocationPick();
        return;
    }
    beginLocationPick(() => {
        void refreshForecast();
    });
}

function onUnits(e: Event): void {
    setUnits((e.target as HTMLSelectElement).value as UnitSystem);
}

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
