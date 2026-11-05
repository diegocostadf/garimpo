<script setup lang="ts">
import { computed } from 'vue'

// A mixer-style channel fader used as a progress indicator: a recessed slot
// with a graduated scale and a fader cap that travels with the value.
// Vertical for the rack's channels, horizontal inside list rows.
const props = withDefaults(defineProps<{
  value: number
  orientation?: 'vertical' | 'horizontal'
  label: string
  active?: boolean
}>(), { orientation: 'vertical', active: true })

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.value || 0))))
const ticks = Array.from({ length: 11 }, (_, i) => ({ at: i * 10, major: i % 5 === 0 }))
const scale = [100, 75, 50, 25, 0]
</script>

<template>
  <div
    role="progressbar"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="pct"
    class="fader select-none"
    :class="orientation === 'vertical' ? 'fader-v' : 'fader-h'"
  >
    <template v-if="orientation === 'vertical'">
      <div class="absolute inset-y-3 left-6 right-0">
        <span
          v-for="tk in ticks"
          :key="tk.at"
          class="absolute inset-x-0 h-px flex justify-between"
          :style="{ bottom: tk.at + '%' }"
        >
          <i class="block h-px bg-line-strong" :class="tk.major ? 'w-3' : 'w-[7px]'" />
          <i class="block h-px bg-line-strong" :class="tk.major ? 'w-3' : 'w-[7px]'" />
        </span>
        <span
          v-for="n in scale"
          :key="n"
          class="absolute -left-1 -translate-x-full translate-y-1/2 font-mono text-[9px] leading-none text-foreground-muted"
          :style="{ bottom: n + '%' }"
        >{{ n }}</span>
        <span class="slot absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-1.5 rounded-full" />
        <span class="absolute left-1/2 -translate-x-1/2 bottom-0 w-0.5 rounded-full transition-[height] duration-500" :class="active ? 'bg-primary-500' : 'bg-line-strong'" :style="{ height: pct + '%' }" />
        <span class="cap absolute left-1/2 w-10 h-[22px] rounded-[4px] flex items-center transition-[bottom] duration-500" :style="{ bottom: pct + '%' }">
          <i class="block w-full h-0.5 cap-line" />
        </span>
      </div>
    </template>
    <template v-else>
      <div class="absolute inset-y-0 left-3 right-3">
        <span
          v-for="tk in ticks"
          :key="tk.at"
          class="absolute inset-y-0 w-px flex flex-col justify-between"
          :style="{ left: tk.at + '%' }"
        >
          <i class="block w-px bg-line-strong" :class="tk.major ? 'h-2' : 'h-[5px]'" />
          <i class="block w-px bg-line-strong" :class="tk.major ? 'h-2' : 'h-[5px]'" />
        </span>
        <span class="slot absolute top-1/2 -translate-y-1/2 left-0 right-0 h-1.5 rounded-full" />
        <span class="absolute top-1/2 -translate-y-1/2 left-0 h-0.5 rounded-full transition-[width] duration-500" :class="active ? 'bg-primary-500' : 'bg-line-strong'" :style="{ width: pct + '%' }" />
        <span class="cap absolute top-1/2 w-3.5 h-[30px] rounded-[3px] flex justify-center transition-[left] duration-500" :style="{ left: pct + '%' }">
          <i class="block h-full w-0.5 cap-line" />
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fader { position: relative; }
.fader-v { width: 72px; height: 200px; }
.fader-h { width: 100%; height: 40px; }
.slot {
  background: rgb(var(--bg-main));
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(var(--line-strong));
}
.cap {
  background: linear-gradient(180deg, #3a3a3a, #232323);
  border: 1px solid #4d4d4d;
  box-shadow: 0 3px 6px rgb(0 0 0 / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.08);
}
.fader-v .cap { transform: translate(-50%, 50%); }
.fader-h .cap { transform: translate(-50%, -50%); }
.cap-line { background: #f2f2f2; }
@media (prefers-reduced-motion: reduce) {
  .cap, .fader span { transition: none !important; }
}
</style>
