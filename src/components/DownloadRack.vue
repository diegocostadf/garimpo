<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDownloadStore } from '../stores/downloadStore'
import { useSettingsStore } from '../stores/settingsStore'
import ChannelFader from './ChannelFader.vue'
import type { DownloadItem } from '../types'

// The download desk: always beside the content, so progress never hides
// behind a page change. Up to three items run as mixer channels with faders;
// everything else sits in a short list underneath.
const { t } = useI18n()
const downloadStore = useDownloadStore()
const settingsStore = useSettingsStore()

const COLLAPSED_KEY = 'garimpoRackCollapsed'
const collapsed = ref((() => { try { return localStorage.getItem(COLLAPSED_KEY) === 'true' } catch { return false } })())
function toggle() {
  collapsed.value = !collapsed.value
  try { localStorage.setItem(COLLAPSED_KEY, String(collapsed.value)) } catch { /* private mode */ }
}

const all = computed(() => downloadStore.downloads)
const liveCount = computed(() => all.value.filter(d => d.status === 'downloading').length)
const savedCount = computed(() => all.value.filter(d => d.status === 'completed').length)

const channels = computed(() => {
  const running = all.value.filter(d => d.status === 'downloading')
  const waiting = all.value.filter(d => d.status === 'pending')
  return [...running, ...waiting].slice(0, 3)
})
const channelIds = computed(() => new Set(channels.value.map(c => c.id)))
const rest = computed(() => all.value.filter(d => !channelIds.value.has(d.id)).slice(0, 40))

function artistName(item: DownloadItem): string {
  const a: any = (item as any).artist
  if (!a) return t('common.unknownArtist')
  return typeof a === 'string' ? a : (a.name || t('common.unknownArtist'))
}
function cover(item: DownloadItem): string | undefined {
  const c: any = (item as any).cover
  return typeof c === 'string' ? c : undefined
}
function speed(bps?: number): string {
  if (!bps) return ''
  return bps >= 1048576 ? `${(bps / 1048576).toFixed(1)} MB/S` : `${Math.round(bps / 1024)} KB/S`
}
function channelMeta(item: DownloadItem): string {
  if (item.status === 'pending') return t('rack.queued')
  const parts: string[] = []
  if (item.type === 'album' || item.type === 'playlist') parts.push(`${item.completedTracks || 0}/${item.totalTracks || 0}`)
  if (item.speed) parts.push(speed(item.speed))
  return parts.join(' · ')
}
function state(item: DownloadItem): { label: string; tone: 'ok' | 'bad' | 'wait' | 'live' } {
  if (item.status === 'completed') return { label: t('rack.saved'), tone: 'ok' }
  if (item.status === 'error') return { label: t('rack.failed'), tone: 'bad' }
  if (item.status === 'downloading') return { label: `${item.progress || 0}%`, tone: 'live' }
  return { label: t('rack.queued'), tone: 'wait' }
}
const totalRate = computed(() => speed(downloadStore.totalDownloadSpeed) || '0 KB/S')

async function openFolder() {
  if (window.electronAPI && settingsStore.settings.downloadPath) {
    await window.electronAPI.openPath(settingsStore.settings.downloadPath)
  }
}
function togglePause() {
  if (downloadStore.isPaused) downloadStore.resumeQueue()
  else downloadStore.pauseQueue()
}
</script>

<template>
  <aside
    :aria-label="t('rack.title')"
    class="flex-shrink-0 bg-background-secondary border-l border-line flex flex-col transition-[width] duration-300"
    :class="collapsed ? 'w-[60px]' : 'w-[340px]'"
  >
    <!-- Collapsed strip -->
    <button
      v-if="collapsed"
      type="button"
      @click="toggle"
      :aria-label="t('rack.expand')"
      :title="t('rack.expand')"
      class="flex-1 flex flex-col items-center gap-4 py-5 text-foreground-muted hover:text-foreground"
    >
      <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      <span class="font-display text-[22px] text-foreground">{{ liveCount }}</span>
      <span v-if="liveCount" class="w-2 h-2 rounded-full bg-primary-500 animate-pulse" aria-hidden="true" />
    </button>

    <template v-else>
      <header class="px-5 pt-5 pb-4 flex flex-col gap-3.5 border-b border-line">
        <div class="flex items-start justify-between gap-3">
          <div class="flex flex-col gap-1">
            <h2 class="font-display text-[20px] leading-none">{{ t('rack.title') }}</h2>
            <span class="font-mono text-[11px] uppercase text-foreground-muted">
              {{ t('rack.live', { n: liveCount }) }} · {{ t('rack.stored', { n: savedCount }) }}
            </span>
          </div>
          <button type="button" @click="toggle" :aria-label="t('rack.collapse')" :title="t('rack.collapse')" class="w-9 h-9 -mr-2 rounded-full flex items-center justify-center text-foreground-muted hover:bg-hover hover:text-foreground">
            <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <button type="button" @click="openFolder" class="h-9 px-3.5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('rack.folder') }}</button>
          <button type="button" @click="togglePause" :disabled="!all.length" class="h-9 px-3.5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover disabled:opacity-40">{{ downloadStore.isPaused ? t('rack.resume') : t('rack.pause') }}</button>
          <button type="button" @click="downloadStore.clearCompleted()" :disabled="!savedCount" class="h-9 px-3.5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover disabled:opacity-40">{{ t('rack.clear') }}</button>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto">
        <p v-if="!all.length" class="m-5 p-5 rounded-[20px] border border-dashed border-line-strong text-sm leading-relaxed text-foreground-muted">{{ t('rack.empty') }}</p>

        <section v-if="channels.length" class="px-4 pt-4 pb-3 grid grid-cols-3 gap-2 border-b border-line">
          <div v-for="(ch, i) in channels" :key="ch.id" class="flex flex-col items-center gap-2 px-1 py-3 rounded-[18px] bg-surface min-w-0">
            <span class="font-mono text-[10px] uppercase" :class="ch.status === 'downloading' ? 'text-primary-400' : 'text-foreground-muted'">{{ t('rack.channel', { n: i + 1 }) }}</span>
            <ChannelFader :value="ch.status === 'downloading' ? ch.progress || 0 : 0" :label="ch.title" :active="ch.status === 'downloading'" />
            <span class="font-display text-[20px] leading-none">{{ ch.status === 'downloading' ? (ch.progress || 0) + '%' : '—' }}</span>
            <span class="w-full text-center text-xs font-medium leading-snug line-clamp-2 px-1" :title="ch.title">{{ ch.title }}</span>
            <span class="font-mono text-[10px] text-foreground-muted text-center">{{ channelMeta(ch) }}</span>
          </div>
        </section>

        <ul v-if="rest.length" class="px-3 py-2 flex flex-col gap-0.5">
          <li v-for="item in rest" :key="item.id" class="flex items-center gap-3 px-2 py-2 rounded-[14px] hover:bg-hover">
            <img v-if="cover(item)" :src="cover(item)" alt="" class="w-10 h-10 rounded-lg object-cover flex-none" loading="lazy" />
            <span v-else class="w-10 h-10 rounded-lg bg-surface flex-none" />
            <span class="flex-1 min-w-0 flex flex-col">
              <span class="text-[13px] font-medium truncate">{{ item.title }}</span>
              <span class="text-xs text-foreground-muted truncate">{{ artistName(item) }}</span>
            </span>
            <span
              class="font-mono text-[10px] uppercase px-2 py-1 rounded-full border"
              :class="{
                'border-line-strong text-foreground': state(item).tone === 'ok',
                'border-primary-500 bg-primary-500 text-white': state(item).tone === 'bad',
                'border-line-strong text-foreground-muted': state(item).tone === 'wait',
                'border-primary-500 text-primary-400': state(item).tone === 'live'
              }"
            >{{ state(item).label }}</span>
          </li>
        </ul>
      </div>

      <footer class="px-5 py-4 border-t border-line flex items-end justify-between gap-3">
        <span class="font-mono text-[10px] uppercase text-foreground-muted">{{ t('rack.totalRate') }}</span>
        <span class="font-display text-[26px] leading-none text-primary-400">{{ totalRate }}</span>
      </footer>
    </template>
  </aside>
</template>
