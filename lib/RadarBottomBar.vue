<template>
    <div class="d-flex align-items-center justify-content-center px-2 text-white-50 small">
        {{ state.status }}
    </div>
</template>

<script setup lang="ts">
import { state } from './state.ts';
</script>
