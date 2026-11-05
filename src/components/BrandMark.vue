<script setup lang="ts">
// The Garimpo mark: a gold nugget and a spark resting in a prospector's pan.
// Tile and pan swap with light/dark mode; the gold stays the same everywhere.
</script>

<template>
  <svg viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="9" style="fill: rgb(var(--fg-default))" />
    <path d="M10.6 16 L12.6 10.6 L17.4 8.6 L21.6 11.2 L21 16 Z" fill="#E5B04A" />
    <path d="M12.6 10.6 L16.6 13.2 L21.6 11.2 M16.6 13.2 L16 16" fill="none" stroke="#C48A1E" stroke-width="0.55" stroke-linejoin="round" stroke-linecap="round" />
    <path d="M24.4 4.4 L25.1 6.5 L27.2 7.2 L25.1 7.9 L24.4 10 L23.7 7.9 L21.6 7.2 L23.7 6.5 Z" fill="#E5B04A" />
    <path d="M5 16 H27 C26 23 21.4 26.8 16 26.8 C10.6 26.8 6 23 5 16 Z" style="fill: rgb(var(--bg-main))" />
  </svg>
</template>
