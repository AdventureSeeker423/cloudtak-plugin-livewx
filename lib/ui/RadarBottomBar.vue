<template>
    <div
        v-if='state.overlayEnabled'
        class='livewx-bottom d-flex align-items-center gap-2 px-3 py-2'
    >
        <span class='small text-nowrap'>Opacity {{ Math.round(state.opacity * 100) }}%</span>
        <input
            class='form-range flex-grow-1'
            type='range'
            min='0'
            max='100'
            step='1'
            :value='Math.round(state.opacity * 100)'
            @input='onOpacity'
        >
        <span class='small text-secondary text-nowrap'>{{ state.status }}</span>
    </div>
</template>

<script setup lang='ts'>
import { applyOpacity } from '../radar/radar.ts';
import { setOpacity, state } from '../core/state.ts';

function onOpacity(ev: Event): void {
    setOpacity(Number((ev.target as HTMLInputElement).value) / 100);
    applyOpacity();
}
</script>

<style scoped>
.livewx-bottom {
    min-width: 16rem;
    max-width: 28rem;
    background: var(--livewx-bg, rgba(0, 0, 0, 0.65));
    color: var(--livewx-fg, #fff);
    border-radius: 0.5rem;
}
</style>
