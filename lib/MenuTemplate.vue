<template>
    <div
        class="position-absolute start-0 top-0 bottom-0 end-0"
        :style="`z-index: ${zindex}`"
    >
        <div
            class="card h-100"
            :class="{ 'border-0': !border }"
        >
            <div class="card-header d-flex align-items-center py-2" v-if="name">
                <h3 class="card-title mb-0">{{ name }}</h3>
                <div class="ms-auto d-flex align-items-center">
                    <slot name="buttons"></slot>
                    <TablerIconButton
                        v-if="backType === 'close'"
                        title="Close"
                        @click="router.push('/')"
                    >
                        <IconCircleX :size="20" stroke="1" />
                    </TablerIconButton>
                    <TablerIconButton
                        v-else-if="backType === 'back'"
                        title="Back"
                        @click="routerBack"
                    >
                        <IconCircleArrowLeft :size="20" stroke="1" />
                    </TablerIconButton>
                </div>
            </div>
            <div class="card-body overflow-auto">
                <TablerLoading v-if="loading" desc="Loading" />
                <TablerNone v-else-if="none" :label="name" />
                <slot v-else></slot>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import {
    TablerNone,
    TablerLoading,
    TablerIconButton,
} from '@tak-ps/vue-tabler';

import {
    IconCircleX,
    IconCircleArrowLeft,
} from '@tabler/icons-vue';

import { useRouter } from 'vue-router';
import { computed } from 'vue';

const router = useRouter();

const props = defineProps({
    name: {
        type: String,
        required: true,
    },
    zindex: {
        type: Number,
        default: 1020,
    },
    border: {
        type: Boolean,
        default: true,
    },
    back: {
        type: Boolean,
        default: true,
    },
    loading: {
        type: Boolean,
        default: false,
    },
    none: {
        type: Boolean,
        default: false,
    },
});

function routerBack() {
    if (!router.options.history.state.back || String(router.options.history.state.back).startsWith('/login')) {
        router.push('/');
    } else {
        router.back();
    }
}

const backType = computed(() => {
    if (!props.back) return 'none';
    if (
        !router.options.history.state.back
        || router.options.history.state.back === '/'
    ) {
        return 'close';
    }
    return 'back';
});
</script>
