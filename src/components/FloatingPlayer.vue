<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '../stores/playerStore'
import { useSettingsStore } from '../stores/settingsStore'

// Floating preview player. Lives in a corner of the content area, can be
// dragged anywhere and snaps to the nearest corner on release. Shows a stereo
// LED VU meter driven by the actual audio, and a scrubber you can drag.
const { t } = useI18n()
const player = usePlayerStore()
const settings = useSettingsStore()

type Corner = 'br' | 'bl' | 'tr' | 'tl'
const CORNER_KEY = 'garimpoPlayerCorner'
const corner = ref<Corner>((() => {
  try { return (localStorage.getItem(CORNER_KEY) as Corner) || 'br' } catch { return 'br' }
})())

const root = ref<HTMLElement | null>(null)
const dragging = ref(false)
const dragPos = ref({ x: 0, y: 0 })
let grab = { dx: 0, dy: 0 }

const visible = computed(() => !!player.currentTrack)
const track = computed(() => player.currentTrack as any)
const cover = computed(() => track.value?.album?.cover_medium || track.value?.album?.cover_small || track.value?.cover || '')
const artist = computed(() => {
  const a = track.value?.artist
  return typeof a === 'string' ? a : a?.name || ''
})

const style = computed(() => {
  if (dragging.value) return { left: dragPos.value.x + 'px', top: dragPos.value.y + 'px' }
  const s: Record<string, string> = {}
  s[corner.value[0] === 'b' ? 'bottom' : 'top'] = '20px'
  s[corner.value[1] === 'r' ? 'right' : 'left'] = '20px'
  return s
})

function onDragStart(e: PointerEvent) {
  if ((e.target as HTMLElement).closest('button, input, [data-no-drag]')) return
  const el = root.value
  const parent = el?.offsetParent as HTMLElement | null
  if (!el || !parent) return
  const r = el.getBoundingClientRect()
  const p = parent.getBoundingClientRect()
  grab = { dx: e.clientX - r.left, dy: e.clientY - r.top }
  dragPos.value = { x: r.left - p.left, y: r.top - p.top }
  dragging.value = true
  el.setPointerCapture(e.pointerId)
}
function onDragMove(e: PointerEvent) {
  if (!dragging.value || !root.value) return
  const parent = root.value.offsetParent as HTMLElement
  const p = parent.getBoundingClientRect()
  const w = root.value.offsetWidth
  const h = root.value.offsetHeight
  dragPos.value = {
    x: Math.max(8, Math.min(p.width - w - 8, e.clientX - p.left - grab.dx)),
    y: Math.max(8, Math.min(p.height - h - 8, e.clientY - p.top - grab.dy))
  }
}
function onDragEnd() {
  if (!dragging.value || !root.value) return
  const parent = root.value.offsetParent as HTMLElement
  const cx = dragPos.value.x + root.value.offsetWidth / 2
  const cy = dragPos.value.y + root.value.offsetHeight / 2
  corner.value = `${cy > parent.clientHeight / 2 ? 'b' : 't'}${cx > parent.clientWidth / 2 ? 'r' : 'l'}` as Corner
  try { localStorage.setItem(CORNER_KEY, corner.value) } catch { /* private mode */ }
  dragging.value = false
}

// Scrubber
const bar = ref<HTMLElement | null>(null)
const scrubbing = ref(false)
const scrubAt = ref(0)
const shown = computed(() => (scrubbing.value ? scrubAt.value : player.position))
const pct = computed(() => Math.min(100, (shown.value / player.length) * 100))
function fromPointer(e: PointerEvent) {
  const r = bar.value!.getBoundingClientRect()
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * player.length
}
function scrubStart(e: PointerEvent) {
  scrubbing.value = true
  scrubAt.value = fromPointer(e)
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
}
function scrubMove(e: PointerEvent) { if (scrubbing.value) scrubAt.value = fromPointer(e) }
function scrubEnd() {
  if (!scrubbing.value) return
  player.seek(scrubAt.value)
  scrubbing.value = false
}
function scrubKey(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') { player.seek(player.position + 5); e.preventDefault() }
  if (e.key === 'ArrowLeft') { player.seek(player.position - 5); e.preventDefault() }
}
const fmt = (s: number) => {
  const v = Math.max(0, Math.floor(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

// VU meter: 20 LED segments per channel, peak hold with slow fall.
const SEGMENTS = 20
const segs = Array.from({ length: SEGMENTS }, (_, i) => i)
const lit = ref<[number, number]>([0, 0])
const peak = ref<[number, number]>([0, 0])
const peakHold = [0, 0]
let raf = 0
function toSegments(rms: number) {
  if (rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  const norm = (db + 42) / 42 // -42 dBFS .. 0 dBFS
  return Math.max(0, Math.min(SEGMENTS, Math.round(norm * SEGMENTS)))
}
function tick() {
  const [l, r] = player.levels()
  const next: [number, number] = [toSegments(l), toSegments(r)]
  // Ballistics: fast attack, gentle release.
  const cur = lit.value
  const smoothed: [number, number] = [
    next[0] >= cur[0] ? next[0] : Math.max(next[0], cur[0] - 1),
    next[1] >= cur[1] ? next[1] : Math.max(next[1], cur[1] - 1)
  ]
  lit.value = smoothed
  for (const c of [0, 1]) {
    if (smoothed[c] >= peak.value[c]) { peak.value[c] = smoothed[c]; peakHold[c] = 40 }
    else if (peakHold[c] > 0) peakHold[c]--
    else peak.value[c] = Math.max(0, peak.value[c] - 1)
  }
  raf = requestAnimationFrame(tick)
}
watch(visible, v => {
  cancelAnimationFrame(raf)
  if (v) raf = requestAnimationFrame(tick)
}, { immediate: true })
onBeforeUnmount(() => cancelAnimationFrame(raf))

function segClass(ch: 0 | 1, i: number) {
  const on = i < lit.value[ch] || (peak.value[ch] > 0 && i === peak.value[ch] - 1)
  const hot = i >= SEGMENTS - 3
  const warm = i >= SEGMENTS - 7 && !hot
  if (!on) return 'bg-line'
  if (hot) return 'bg-primary-500 shadow-[0_0_6px_rgb(var(--primary-500))]'
  if (warm) return 'bg-foreground'
  return 'bg-foreground-muted'
}

const volume = computed({
  get: () => settings.settings.previewVolume ?? 80,
  set: (v: number) => player.setVolume(v)
})
</script>

<template>
  <transition name="pop">
    <section
      v-if="visible"
      ref="root"
      :aria-label="t('player.title')"
      class="absolute z-40 w-[380px] max-w-[calc(100%-40px)] rounded-[24px] bg-surface/95 backdrop-blur border border-line-strong shadow-[0_20px_50px_rgb(0_0_0/0.45)] select-none"
      :class="dragging ? 'cursor-grabbing transition-none' : 'transition-[top,left,right,bottom] duration-300'"
      :style="style"
      @pointerdown="onDragStart"
      @pointermove="onDragMove"
      @pointerup="onDragEnd"
      @pointercancel="onDragEnd"
    >
      <div class="flex justify-center pt-2 cursor-grab" aria-hidden="true">
        <span class="w-10 h-1 rounded-full bg-line-strong" />
      </div>

      <div class="px-4 pt-2 flex items-center gap-3">
        <img v-if="cover" :src="cover" alt="" class="w-14 h-14 rounded-[14px] object-cover flex-none" draggable="false" />
        <span v-else class="w-14 h-14 rounded-[14px] bg-background-tertiary flex-none" />
        <div class="flex-1 min-w-0">
          <p class="text-sm font-semibold truncate" :title="track?.title">{{ track?.title }}</p>
          <p class="text-xs text-foreground-muted truncate">{{ artist }}</p>
          <p class="mt-1 font-mono text-[10px] uppercase text-foreground-muted">{{ track?.localPath ? t('player.library') : t('player.preview') }}<template v-if="track?.bpm"> · {{ Math.round(track.bpm) }} BPM</template><template v-if="track?.camelot"> · {{ track.camelot }}</template></p>
        </div>
        <button type="button" @click="player.stop()" :aria-label="t('player.close')" :title="t('player.close')" class="w-9 h-9 -mr-1 rounded-full flex items-center justify-center text-foreground-muted hover:bg-hover hover:text-foreground">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>

      <!-- Stereo LED VU meter -->
      <div class="px-4 pt-3 flex flex-col gap-1" role="img" :aria-label="t('player.meters')">
        <div v-for="ch in ([0, 1] as const)" :key="ch" class="flex items-center gap-2">
          <span class="font-mono text-[9px] w-2 text-foreground-muted">{{ ch === 0 ? 'L' : 'R' }}</span>
          <div class="flex-1 grid gap-[3px]" :style="{ gridTemplateColumns: `repeat(${SEGMENTS}, minmax(0, 1fr))` }">
            <span v-for="i in segs" :key="i" class="h-[6px] rounded-[2px] transition-colors duration-75" :class="segClass(ch, i)" />
          </div>
        </div>
        <div class="flex justify-between pl-4 font-mono text-[8px] text-foreground-muted" aria-hidden="true">
          <span>-42</span><span>-24</span><span>-12</span><span>-6</span><span>0 dB</span>
        </div>
      </div>

      <!-- Scrubber -->
      <div class="px-4 pt-3" data-no-drag>
        <div
          ref="bar"
          role="slider"
          tabindex="0"
          :aria-label="t('player.seek')"
          aria-valuemin="0"
          :aria-valuemax="Math.round(player.length)"
          :aria-valuenow="Math.round(shown)"
          :aria-valuetext="fmt(shown)"
          class="group relative h-5 flex items-center cursor-pointer outline-none"
          @pointerdown.stop="scrubStart"
          @pointermove="scrubMove"
          @pointerup="scrubEnd"
          @pointercancel="scrubEnd"
          @keydown="scrubKey"
        >
          <span class="absolute inset-x-0 h-1 rounded-full bg-line-strong" />
          <span class="absolute left-0 h-1 rounded-full bg-foreground group-hover:bg-primary-500" :class="scrubbing ? 'bg-primary-500' : ''" :style="{ width: pct + '%' }" />
          <span
            class="absolute w-3.5 h-3.5 -ml-[7px] rounded-full bg-foreground shadow transition-transform"
            :class="scrubbing ? 'scale-110' : 'scale-0 group-hover:scale-100 group-focus-visible:scale-100'"
            :style="{ left: pct + '%' }"
          />
        </div>
        <div class="flex justify-between font-mono text-[10px] text-foreground-muted">
          <span>{{ fmt(shown) }}</span>
          <span>-{{ fmt(player.length - shown) }}</span>
        </div>
      </div>

      <!-- Transport -->
      <div class="px-4 pt-1 pb-4 flex items-center gap-2" data-no-drag>
        <div class="flex-1 flex items-center gap-2">
          <svg class="w-4 h-4 text-foreground-muted flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5z" /><path v-if="volume > 0" d="M15.5 8.5a5 5 0 0 1 0 7" /></svg>
          <input v-model.number="volume" type="range" min="0" max="100" :aria-label="t('player.volume')" class="player-volume w-20" />
        </div>
        <button type="button" @click="player.prev()" :aria-label="t('player.previous')" :title="t('player.previous')" class="w-10 h-10 rounded-full flex items-center justify-center hover:bg-hover">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 6h2v12H7zM20 6v12l-9-6z" /></svg>
        </button>
        <button
          type="button"
          @click="player.toggle()"
          :aria-label="player.isPlaying ? t('player.pause') : t('player.play')"
          class="w-12 h-12 rounded-full bg-foreground text-background-main flex items-center justify-center hover:scale-105 transition-transform"
        >
          <svg v-if="player.isLoading" class="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9" /></svg>
          <svg v-else-if="player.isPlaying" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
          <svg v-else class="w-5 h-5 ml-0.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" /></svg>
        </button>
        <button type="button" @click="player.next()" :disabled="!player.hasNext" :aria-label="t('player.next')" :title="t('player.next')" class="w-10 h-10 rounded-full flex items-center justify-center hover:bg-hover disabled:opacity-30">
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M15 6h2v12h-2zM4 6v12l9-6z" /></svg>
        </button>
        <div class="flex-1 flex justify-end">
          <span class="font-mono text-[10px] uppercase" :class="player.metersLive && player.isPlaying ? 'text-primary-400' : 'text-foreground-muted'">
            {{ player.isPlaying ? t('player.onAir') : t('player.paused') }}
          </span>
        </div>
      </div>
    </section>
  </transition>
</template>

<style scoped>
.pop-enter-active, .pop-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: translateY(12px) scale(0.98); }
.player-volume { accent-color: rgb(var(--fg-default)); height: 4px; }
@media (prefers-reduced-motion: reduce) {
  .pop-enter-active, .pop-leave-active { transition: none; }
}
</style>
