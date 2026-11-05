<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useDjStore, harmonicOrder, isCompatible, type LibTrack } from '../stores/djStore'
import { useSettingsStore } from '../stores/settingsStore'
import { usePlayerStore } from '../stores/playerStore'
import { useToastStore } from '../stores/toastStore'
import ChannelFader from '../components/ChannelFader.vue'

// DJ studio: analyse the local library (BPM, Camelot key, energy), build
// playlists with harmonic help, and move them in and out of Serato,
// Rekordbox and M3U-based software.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const dj = useDjStore()
const settings = useSettingsStore()
const player = usePlayerStore()
const toast = useToastStore()

type Tab = 'library' | 'playlists' | 'sync'
const tab = computed<Tab>({
  get: () => (['library', 'playlists', 'sync'].includes(String(route.query.tab)) ? route.query.tab : 'library') as Tab,
  set: v => router.replace({ query: { ...route.query, tab: v } })
})

const loadError = ref(false)
onMounted(async () => {
  try { await dj.load() } catch { loadError.value = true }
})

// ---------- library ----------
const q = ref('')
const bpmMin = ref<number | null>(null)
const bpmMax = ref<number | null>(null)
const energyMin = ref(1)
const refKey = ref<string>('')
const onlyPending = ref(false)
const sortBy = ref<'title' | 'bpm' | 'key' | 'energy'>('title')
const selected = ref<Set<string>>(new Set())
const LIMIT = 400

const filtered = computed(() => {
  const term = q.value.trim().toLowerCase()
  let list = dj.tracks.filter(tr => {
    if (term && !`${tr.title} ${tr.artist} ${tr.album || ''} ${tr.genre || ''}`.toLowerCase().includes(term)) return false
    if (bpmMin.value && (!tr.bpm || tr.bpm < bpmMin.value)) return false
    if (bpmMax.value && (!tr.bpm || tr.bpm > bpmMax.value)) return false
    if (energyMin.value > 1 && (tr.energy || 0) < energyMin.value) return false
    if (refKey.value && !isCompatible(refKey.value, tr.camelot)) return false
    if (onlyPending.value && tr.analyzedAt) return false
    return true
  })
  const keyNum = (c?: string) => { const m = /^(\d+)([AB])$/.exec(c || ''); return m ? Number(m[1]) * 2 + (m[2] === 'B' ? 1 : 0) : 99 }
  list = list.slice().sort((a, b) =>
    sortBy.value === 'bpm' ? (a.bpm || 999) - (b.bpm || 999)
      : sortBy.value === 'key' ? keyNum(a.camelot) - keyNum(b.camelot)
        : sortBy.value === 'energy' ? (b.energy || 0) - (a.energy || 0)
          : `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`))
  return list
})
const visible = computed(() => filtered.value.slice(0, LIMIT))
const allChecked = computed(() => visible.value.length > 0 && visible.value.every(tr => selected.value.has(tr.path)))
function toggleAll() {
  const s = new Set(selected.value)
  if (allChecked.value) visible.value.forEach(tr => s.delete(tr.path))
  else visible.value.forEach(tr => s.add(tr.path))
  selected.value = s
}
function toggle(p: string) {
  const s = new Set(selected.value)
  s.has(p) ? s.delete(p) : s.add(p)
  selected.value = s
}

const progress = computed(() => dj.queueTotal ? Math.round((dj.queueDone / dj.queueTotal) * 100) : 0)
const currentName = computed(() => dj.current ? dj.byPath.get(dj.current)?.title || dj.current.split(/[\\/]/).pop() : '')

async function addFolder(path?: string | null) {
  const folder = path ?? (window.electronAPI ? await window.electronAPI.selectFolder(settings.settings.downloadPath) : null)
  if (!folder) return
  try { await dj.addFolder(folder) } catch { toast.error(t('dj.scanError')) }
}

function analyzePending() { dj.analyze(dj.unanalyzed.map(tr => tr.path)) }
function analyzeSelected() { dj.analyze([...selected.value]) }

function preview(tr: LibTrack, list: LibTrack[]) {
  const asTrack = (x: LibTrack) => ({ id: x.path, title: x.title, artist: { name: x.artist }, localPath: x.path, bpm: x.bpm, camelot: x.camelot, duration: x.duration || 0 }) as any
  player.play(asTrack(tr), list.slice(0, 300).map(asTrack))
}

const fmtTime = (s?: number) => s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : ''
const fmtBpm = (b?: number) => (b ? (Math.round(b * 10) / 10).toFixed(b % 1 ? 1 : 0) : '—')

// Add selection to a playlist
const pickerOpen = ref(false)
const newName = ref('')
async function addSelectedTo(id: string | null) {
  const paths = [...selected.value]
  if (!paths.length) return
  if (id) {
    const pl = dj.playlists.find(p => p.id === id)!
    await dj.savePlaylist({ id, name: pl.name, paths: [...pl.paths, ...paths] })
    toast.success(t('dj.addedTo', { n: paths.length, name: pl.name }))
  } else {
    const name = newName.value.trim() || t('dj.newPlaylistName')
    const pl = await dj.savePlaylist({ name, paths })
    toast.success(t('dj.addedTo', { n: paths.length, name: pl.name }))
    activeId.value = pl.id
  }
  pickerOpen.value = false
  newName.value = ''
  selected.value = new Set()
}

// ---------- playlists ----------
const activeId = ref<string | null>(null)
watch(() => dj.playlists.length, () => {
  if (!activeId.value || !dj.playlists.some(p => p.id === activeId.value)) activeId.value = dj.playlists[0]?.id || null
}, { immediate: true })
const active = computed(() => dj.playlists.find(p => p.id === activeId.value) || null)
const activeTracks = computed<LibTrack[]>(() => (active.value?.paths || []).map(p => dj.byPath.get(p) || { path: p, title: p.split(/[\\/]/).pop() || p, artist: '' }))
const avgBpm = (paths: string[]) => {
  const b = paths.map(p => dj.byPath.get(p)?.bpm).filter((x): x is number => !!x)
  return b.length ? Math.round(b.reduce((s, x) => s + x, 0) / b.length) : 0
}
const totalTime = computed(() => fmtTime(activeTracks.value.reduce((s, x) => s + (x.duration || 0), 0)))

async function createPlaylist() {
  const pl = await dj.savePlaylist({ name: t('dj.newPlaylistName'), paths: [] })
  activeId.value = pl.id
}
async function rename(e: Event) {
  if (!active.value) return
  const name = (e.target as HTMLInputElement).value.trim()
  if (name && name !== active.value.name) await dj.savePlaylist({ ...active.value, name })
}
async function setOrder(paths: string[]) {
  if (active.value) await dj.savePlaylist({ ...active.value, paths })
}
function move(i: number, d: number) {
  const p = active.value!.paths.slice()
  const j = i + d
  if (j < 0 || j >= p.length) return
  ;[p[i], p[j]] = [p[j], p[i]]
  setOrder(p)
}
function removeAt(i: number) {
  const p = active.value!.paths.slice()
  p.splice(i, 1)
  setOrder(p)
}
function sortHarmonic() { setOrder(harmonicOrder(activeTracks.value).map(x => x.path)) }
function sortBpm() { setOrder(activeTracks.value.slice().sort((a, b) => (a.bpm || 0) - (b.bpm || 0)).map(x => x.path)) }
async function removePlaylist() {
  if (active.value && confirm(t('dj.deleteConfirm', { name: active.value.name }))) await dj.deletePlaylist(active.value.id)
}

// ---------- sync ----------
const busy = ref<string | null>(null)
const lastFiles = ref<string[]>([])
async function run(key: string, fn: () => Promise<string[] | void>) {
  busy.value = key
  lastFiles.value = []
  try {
    const files = await fn()
    if (files) lastFiles.value = files
    toast.success(t('dj.done'))
  } catch (e: any) {
    toast.error(e?.message || t('dj.failed'))
  } finally {
    busy.value = null
  }
}
const exportSerato = () => run('serato-out', async () => (await dj.exportTo('serato')).files)
const exportRekordbox = () => run('rb-out', async () => (await dj.exportTo('rekordbox')).files)
const exportM3u = () => run('m3u-out', async () => (await dj.exportTo('m3u')).files)
const importSerato = () => run('serato-in', async () => { const p = await dj.importFrom('serato'); return p.map(x => x.name) })
async function pick(ext: string[]) { return window.electronAPI ? window.electronAPI.selectFile({ extensions: ext }) : null }
const importRekordbox = () => run('rb-in', async () => { const f = await pick(['xml']); if (!f) return; return (await dj.importFrom('rekordbox', f)).map(x => x.name) })
const importM3u = () => run('m3u-in', async () => { const f = await pick(['m3u', 'm3u8']); if (!f) return; return (await dj.importFrom('m3u', f)).map(x => x.name) })
const seratoToRekordbox = () => run('s2r', async () => { await dj.importFrom('serato'); return (await dj.exportTo('rekordbox')).files })
const rekordboxToSerato = () => run('r2s', async () => { const f = await pick(['xml']); if (!f) return; await dj.importFrom('rekordbox', f); return (await dj.exportTo('serato')).files })
function reveal(file: string) {
  const dir = file.replace(/[\\/][^\\/]*$/, '')
  window.electronAPI?.openPath(/\.\w+$/.test(file) ? dir : file)
}

const CAMELOT = Array.from({ length: 12 }, (_, i) => [`${i + 1}A`, `${i + 1}B`]).flat()
</script>

<template>
  <div class="flex flex-col gap-8">
    <header class="flex flex-wrap items-end justify-between gap-6">
      <div class="flex flex-col gap-2">
        <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('nav.groups.tools') }}</span>
        <h1 class="font-display">{{ t('dj.title') }}</h1>
        <p class="text-foreground-muted max-w-[620px]">{{ t('dj.subtitle') }}</p>
      </div>
      <div class="flex gap-1.5 p-1 rounded-full bg-surface border border-line" role="tablist">
        <button
          v-for="tb in (['library', 'playlists', 'sync'] as const)"
          :key="tb"
          type="button"
          role="tab"
          :aria-selected="tab === tb"
          @click="tab = tb"
          class="h-10 px-5 rounded-full font-mono text-[11px] uppercase transition-colors"
          :class="tab === tb ? 'bg-foreground text-background-main' : 'text-foreground-muted hover:text-foreground'"
        >{{ t(`dj.tabs.${tb}`) }}</button>
      </div>
    </header>

    <p v-if="loadError" class="p-5 rounded-[20px] border border-primary-500/50 text-sm">{{ t('dj.loadError') }}</p>

    <!-- ================= LIBRARY ================= -->
    <section v-if="tab === 'library'" class="flex flex-col gap-5">
      <div v-if="dj.loaded && !dj.folders.length" class="p-8 rounded-[28px] bg-surface border border-line flex flex-col items-start gap-4">
        <span class="font-display text-[44px] leading-none text-primary-400">00</span>
        <h2 class="text-xl font-semibold">{{ t('dj.emptyTitle') }}</h2>
        <p class="text-sm text-foreground-muted max-w-[560px] leading-relaxed">{{ t('dj.emptyBody') }}</p>
        <div class="flex flex-wrap gap-2">
          <button v-if="settings.settings.downloadPath" type="button" @click="addFolder(settings.settings.downloadPath)" class="h-11 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase">{{ t('dj.useDownloads') }}</button>
          <button type="button" @click="addFolder()" class="h-11 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('dj.chooseFolder') }}</button>
        </div>
      </div>

      <template v-else>
        <!-- folders + analysis -->
        <div class="flex flex-wrap items-center gap-2">
          <span v-for="f in dj.folders" :key="f" class="h-9 pl-4 pr-1.5 rounded-full border border-line-strong flex items-center gap-2 text-xs max-w-[360px]" :title="f">
            <span class="truncate">{{ f.split(/[\\/]/).slice(-2).join('/') }}</span>
            <button type="button" @click="dj.forgetFolder(f)" :aria-label="t('dj.removeFolder')" class="w-6 h-6 rounded-full hover:bg-hover flex items-center justify-center">
              <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </span>
          <button type="button" @click="addFolder()" class="h-9 px-4 rounded-full border border-dashed border-line-strong font-mono text-[11px] uppercase hover:bg-hover">+ {{ t('dj.addFolder') }}</button>
          <button type="button" @click="dj.rescan()" :disabled="dj.scanning" class="h-9 px-4 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover disabled:opacity-40">{{ dj.scanning ? t('dj.scanning') : t('dj.rescan') }}</button>
        </div>

        <div class="p-5 rounded-[28px] bg-surface border border-line flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-5">
            <div class="flex items-baseline gap-3">
              <span class="font-display text-[44px] leading-none">{{ dj.tracks.length - dj.unanalyzed.length }}</span>
              <span class="font-mono text-[11px] uppercase text-foreground-muted">/ {{ dj.tracks.length }} {{ t('dj.analyzedCount') }}</span>
            </div>
            <label class="flex items-center gap-2 text-sm text-foreground-muted cursor-pointer">
              <input v-model="dj.writeTags" type="checkbox" class="accent-[rgb(var(--primary-500))] w-4 h-4" />
              {{ t('dj.writeTags') }}
            </label>
            <div class="flex-1" />
            <button v-if="dj.analyzing" type="button" @click="dj.stopAnalysis()" class="h-11 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('dj.stop') }}</button>
            <template v-else>
              <button v-if="selected.size" type="button" @click="analyzeSelected" class="h-11 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('dj.analyzeSelected', { n: selected.size }) }}</button>
              <button type="button" @click="analyzePending" :disabled="!dj.unanalyzed.length" class="h-11 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">{{ t('dj.analyzePending', { n: dj.unanalyzed.length }) }}</button>
            </template>
          </div>
          <div v-if="dj.analyzing || dj.queueDone" class="flex flex-col gap-1">
            <ChannelFader :value="progress" orientation="horizontal" :label="t('dj.analysisProgress')" :active="dj.analyzing" />
            <div class="flex justify-between font-mono text-[11px] uppercase text-foreground-muted">
              <span class="truncate">{{ dj.analyzing ? currentName : t('dj.analysisDone') }}</span>
              <span>{{ dj.queueDone }}/{{ dj.queueTotal }}<template v-if="dj.failures.length"> · {{ t('dj.failedCount', { n: dj.failures.length }) }}</template></span>
            </div>
          </div>
        </div>

        <!-- filters -->
        <div class="flex flex-wrap items-center gap-2">
          <div class="flex items-center gap-2 h-11 px-4 rounded-full bg-surface border border-line flex-1 min-w-[220px]">
            <svg class="w-4 h-4 text-foreground-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input v-model="q" type="search" :placeholder="t('dj.searchPlaceholder')" class="flex-1 bg-transparent outline-none text-sm" />
          </div>
          <label class="h-11 px-4 rounded-full bg-surface border border-line flex items-center gap-2 font-mono text-[11px] uppercase text-foreground-muted">
            BPM
            <input v-model.number="bpmMin" type="number" min="40" max="220" :placeholder="t('dj.min')" class="w-12 bg-transparent outline-none text-foreground" />
            –
            <input v-model.number="bpmMax" type="number" min="40" max="220" :placeholder="t('dj.max')" class="w-12 bg-transparent outline-none text-foreground" />
          </label>
          <label class="h-11 px-4 rounded-full bg-surface border border-line flex items-center gap-2 font-mono text-[11px] uppercase text-foreground-muted">
            {{ t('dj.key') }}
            <select v-model="refKey" class="bg-transparent outline-none text-foreground">
              <option value="">{{ t('dj.anyKey') }}</option>
              <option v-for="k in CAMELOT" :key="k" :value="k">{{ t('dj.mixesWith', { key: k }) }}</option>
            </select>
          </label>
          <label class="h-11 px-4 rounded-full bg-surface border border-line flex items-center gap-2 font-mono text-[11px] uppercase text-foreground-muted">
            {{ t('dj.energy') }} ≥ <input v-model.number="energyMin" type="range" min="1" max="10" class="w-20 accent-[rgb(var(--primary-500))]" /> <span class="text-foreground w-4">{{ energyMin }}</span>
          </label>
          <label class="h-11 px-4 rounded-full bg-surface border border-line flex items-center gap-2 font-mono text-[11px] uppercase text-foreground-muted cursor-pointer">
            <input v-model="onlyPending" type="checkbox" class="accent-[rgb(var(--primary-500))]" /> {{ t('dj.onlyPending') }}
          </label>
        </div>

        <!-- selection bar -->
        <div v-if="selected.size" class="sticky top-0 z-10 flex flex-wrap items-center gap-3 p-3 pl-5 rounded-full bg-foreground text-background-main">
          <span class="font-mono text-[11px] uppercase">{{ t('dj.selected', { n: selected.size }) }}</span>
          <div class="flex-1" />
          <div class="relative">
            <button type="button" @click="pickerOpen = !pickerOpen" class="h-9 px-4 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase">{{ t('dj.addToPlaylist') }}</button>
            <div v-if="pickerOpen" class="absolute right-0 top-11 w-72 p-2 rounded-[20px] bg-surface border border-line-strong text-foreground shadow-2xl flex flex-col gap-1 z-20">
              <button v-for="p in dj.playlists" :key="p.id" type="button" @click="addSelectedTo(p.id)" class="text-left px-3 py-2 rounded-full hover:bg-hover text-sm flex justify-between gap-2">
                <span class="truncate">{{ p.name }}</span><span class="font-mono text-[11px] text-foreground-muted">{{ p.paths.length }}</span>
              </button>
              <form class="flex gap-1 p-1 border-t border-line mt-1 pt-2" @submit.prevent="addSelectedTo(null)">
                <input v-model="newName" :placeholder="t('dj.newPlaylistName')" class="flex-1 min-w-0 h-9 px-3 rounded-full bg-background-tertiary outline-none text-sm" />
                <button type="submit" class="h-9 px-3 rounded-full border border-line-strong font-mono text-[11px] uppercase">{{ t('dj.create') }}</button>
              </form>
            </div>
          </div>
          <button type="button" @click="selected = new Set()" class="h-9 px-4 rounded-full border border-background-main/30 font-mono text-[11px] uppercase">{{ t('dj.clearSelection') }}</button>
        </div>

        <!-- table -->
        <div class="rounded-[24px] border border-line overflow-hidden">
          <div class="grid grid-cols-[40px_1fr_84px_70px_120px_64px_44px] items-center gap-2 px-4 h-11 bg-surface font-mono text-[10px] uppercase text-foreground-muted">
            <input type="checkbox" :checked="allChecked" @change="toggleAll" :aria-label="t('dj.selectAll')" class="accent-[rgb(var(--primary-500))] w-4 h-4" />
            <button type="button" class="uppercase text-left" @click="sortBy = 'title'" :class="sortBy === 'title' ? 'text-foreground' : ''">{{ t('dj.colTrack') }}</button>
            <button type="button" class="uppercase text-right" @click="sortBy = 'bpm'" :class="sortBy === 'bpm' ? 'text-foreground' : ''">BPM</button>
            <button type="button" class="uppercase text-center" @click="sortBy = 'key'" :class="sortBy === 'key' ? 'text-foreground' : ''">{{ t('dj.key') }}</button>
            <button type="button" class="uppercase text-left" @click="sortBy = 'energy'" :class="sortBy === 'energy' ? 'text-foreground' : ''">{{ t('dj.energy') }}</button>
            <span class="text-right">{{ t('dj.colTime') }}</span>
            <span />
          </div>
          <div
            v-for="tr in visible"
            :key="tr.path"
            class="grid grid-cols-[40px_1fr_84px_70px_120px_64px_44px] items-center gap-2 px-4 h-14 border-t border-line hover:bg-hover"
            :class="dj.current === tr.path ? 'bg-hover' : ''"
          >
            <input type="checkbox" :checked="selected.has(tr.path)" @change="toggle(tr.path)" :aria-label="tr.title" class="accent-[rgb(var(--primary-500))] w-4 h-4" />
            <div class="min-w-0">
              <p class="text-sm truncate" :title="tr.path">{{ tr.title }}</p>
              <p class="text-xs text-foreground-muted truncate">{{ tr.artist || '—' }}<template v-if="tr.genre"> · {{ tr.genre }}</template></p>
            </div>
            <span class="font-mono text-sm text-right" :class="tr.bpm ? '' : 'text-foreground-muted'">{{ fmtBpm(tr.bpm) }}</span>
            <span class="justify-self-center">
              <button
                v-if="tr.camelot"
                type="button"
                @click="refKey = refKey === tr.camelot ? '' : tr.camelot!"
                :title="t('dj.keyHint', { key: tr.key || tr.camelot })"
                class="font-mono text-[11px] px-2.5 py-1 rounded-full border"
                :class="refKey && isCompatible(refKey, tr.camelot) ? 'border-primary-500 text-primary-400' : 'border-line-strong'"
              >{{ tr.camelot }}</button>
              <span v-else class="text-foreground-muted">—</span>
            </span>
            <span class="flex items-center gap-[3px]" :aria-label="t('dj.energyLabel', { n: tr.energy || 0 })">
              <i v-for="n in 10" :key="n" class="block w-[7px] h-3.5 rounded-[2px]" :class="tr.energy && n <= tr.energy ? (n >= 8 ? 'bg-primary-500' : 'bg-foreground') : 'bg-line-strong'" />
            </span>
            <span class="font-mono text-[11px] text-right text-foreground-muted">{{ fmtTime(tr.duration) }}</span>
            <button type="button" @click="preview(tr, filtered)" :aria-label="t('player.play')" class="w-9 h-9 rounded-full flex items-center justify-center hover:bg-background-tertiary">
              <svg v-if="player.isTrackPlaying(tr.path)" class="w-4 h-4 text-primary-400" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
              <svg v-else class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z" /></svg>
            </button>
          </div>
          <p v-if="!visible.length" class="px-5 py-10 text-center text-sm text-foreground-muted border-t border-line">{{ dj.scanning ? t('dj.scanning') : t('dj.noMatches') }}</p>
          <p v-if="filtered.length > LIMIT" class="px-5 py-3 text-center font-mono text-[11px] uppercase text-foreground-muted border-t border-line">{{ t('dj.moreHidden', { n: filtered.length - LIMIT }) }}</p>
        </div>
      </template>
    </section>

    <!-- ================= PLAYLISTS ================= -->
    <section v-else-if="tab === 'playlists'" class="grid grid-cols-[260px_1fr] gap-5 items-start">
      <aside class="flex flex-col gap-1.5">
        <button type="button" @click="createPlaylist" class="h-11 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase mb-2">+ {{ t('dj.newPlaylist') }}</button>
        <button
          v-for="p in dj.playlists"
          :key="p.id"
          type="button"
          @click="activeId = p.id"
          class="text-left px-4 py-3 rounded-[20px] border transition-colors"
          :class="activeId === p.id ? 'bg-surface border-line-strong' : 'border-transparent hover:bg-hover'"
        >
          <p class="text-sm font-medium truncate">{{ p.name }}</p>
          <p class="font-mono text-[10px] uppercase text-foreground-muted">{{ t('convert.trackCount', { n: p.paths.length }) }}<template v-if="avgBpm(p.paths)"> · ~{{ avgBpm(p.paths) }} BPM</template></p>
        </button>
        <p v-if="!dj.playlists.length" class="text-sm text-foreground-muted px-2">{{ t('dj.noPlaylists') }}</p>
      </aside>

      <div v-if="active" class="flex flex-col gap-4">
        <div class="flex flex-wrap items-center gap-3">
          <input :value="active.name" @change="rename" :aria-label="t('dj.playlistName')" class="flex-1 min-w-[200px] bg-transparent outline-none text-2xl font-semibold border-b border-transparent focus:border-line-strong" />
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('convert.trackCount', { n: active.paths.length }) }} · {{ totalTime }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" @click="sortHarmonic" :disabled="activeTracks.length < 3" class="h-10 px-4 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover disabled:opacity-40" :title="t('dj.harmonicHint')">{{ t('dj.sortHarmonic') }}</button>
          <button type="button" @click="sortBpm" class="h-10 px-4 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('dj.sortBpm') }}</button>
          <button type="button" @click="tab = 'library'" class="h-10 px-4 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">+ {{ t('dj.addTracks') }}</button>
          <div class="flex-1" />
          <button type="button" @click="removePlaylist" class="h-10 px-4 rounded-full border border-primary-500/60 text-primary-400 font-mono text-[11px] uppercase hover:bg-hover">{{ t('dj.deletePlaylist') }}</button>
        </div>

        <!-- energy curve -->
        <div v-if="activeTracks.length" class="p-4 rounded-[24px] bg-surface border border-line">
          <p class="font-mono text-[10px] uppercase text-foreground-muted mb-2">{{ t('dj.energyCurve') }}</p>
          <div class="flex items-end gap-1 h-16">
            <span
              v-for="(tr, i) in activeTracks"
              :key="tr.path + i"
              class="flex-1 rounded-t-[3px]"
              :class="(tr.energy || 0) >= 8 ? 'bg-primary-500' : 'bg-foreground'"
              :style="{ height: ((tr.energy || 0.5) * 10) + '%', opacity: tr.energy ? 1 : 0.25 }"
              :title="`${tr.title} · ${t('dj.energy')} ${tr.energy || '—'}`"
            />
          </div>
        </div>

        <ol class="flex flex-col gap-1.5">
          <li v-for="(tr, i) in activeTracks" :key="tr.path + i" class="flex items-center gap-3 px-4 py-2.5 rounded-full bg-surface border border-line">
            <span class="font-mono text-[11px] w-6 text-right text-foreground-muted">{{ String(i + 1).padStart(2, '0') }}</span>
            <button type="button" @click="preview(tr, activeTracks)" :aria-label="t('player.play')" class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-hover">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z" /></svg>
            </button>
            <div class="flex-1 min-w-0">
              <p class="text-sm truncate">{{ tr.title }}</p>
              <p class="text-xs text-foreground-muted truncate">{{ tr.artist || '—' }}</p>
            </div>
            <span class="font-mono text-xs w-14 text-right">{{ fmtBpm(tr.bpm) }}</span>
            <span
              class="font-mono text-[11px] w-12 text-center px-2 py-0.5 rounded-full border"
              :class="i > 0 && tr.camelot && activeTracks[i - 1].camelot ? (isCompatible(activeTracks[i - 1].camelot, tr.camelot) ? 'border-line-strong' : 'border-primary-500 text-primary-400') : 'border-line-strong'"
              :title="i > 0 && !isCompatible(activeTracks[i - 1].camelot, tr.camelot) ? t('dj.clash') : ''"
            >{{ tr.camelot || '—' }}</span>
            <span class="font-mono text-xs w-6 text-center">{{ tr.energy || '—' }}</span>
            <div class="flex">
              <button type="button" @click="move(i, -1)" :aria-label="t('dj.moveUp')" class="w-8 h-8 rounded-full hover:bg-hover flex items-center justify-center"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 15 6-6 6 6" /></svg></button>
              <button type="button" @click="move(i, 1)" :aria-label="t('dj.moveDown')" class="w-8 h-8 rounded-full hover:bg-hover flex items-center justify-center"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="m6 9 6 6 6-6" /></svg></button>
              <button type="button" @click="removeAt(i)" :aria-label="t('dj.remove')" class="w-8 h-8 rounded-full hover:bg-hover flex items-center justify-center text-foreground-muted"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
            </div>
          </li>
        </ol>
        <p v-if="!activeTracks.length" class="p-6 rounded-[20px] border border-dashed border-line-strong text-sm text-foreground-muted">{{ t('dj.emptyPlaylist') }}</p>
      </div>
    </section>

    <!-- ================= SYNC ================= -->
    <section v-else class="flex flex-col gap-5">
      <div class="grid md:grid-cols-3 gap-4">
        <article class="p-6 rounded-[28px] bg-surface border border-line flex flex-col gap-4">
          <div>
            <h2 class="font-display">Serato</h2>
            <p class="text-sm text-foreground-muted mt-2 leading-relaxed">{{ t('dj.seratoBody') }}</p>
          </div>
          <div class="mt-auto flex flex-col gap-2">
            <button type="button" @click="exportSerato" :disabled="!!busy || !dj.playlists.length" class="h-11 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">{{ t('dj.sendTo', { app: 'Serato' }) }}</button>
            <button type="button" @click="importSerato" :disabled="!!busy || !dj.seratoFolders.length" class="h-11 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover disabled:opacity-40">{{ t('dj.bringFrom', { app: 'Serato' }) }}</button>
            <p v-if="dj.loaded && !dj.seratoFolders.length" class="text-xs text-foreground-muted">{{ t('dj.seratoMissing') }}</p>
          </div>
        </article>

        <article class="p-6 rounded-[28px] bg-surface border border-line flex flex-col gap-4">
          <div>
            <h2 class="font-display">Rekordbox</h2>
            <p class="text-sm text-foreground-muted mt-2 leading-relaxed">{{ t('dj.rekordboxBody') }}</p>
          </div>
          <div class="mt-auto flex flex-col gap-2">
            <button type="button" @click="exportRekordbox" :disabled="!!busy || !dj.playlists.length" class="h-11 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">{{ t('dj.sendTo', { app: 'Rekordbox' }) }}</button>
            <button type="button" @click="importRekordbox" :disabled="!!busy" class="h-11 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover disabled:opacity-40">{{ t('dj.bringFromXml') }}</button>
          </div>
        </article>

        <article class="p-6 rounded-[28px] bg-surface border border-line flex flex-col gap-4">
          <div>
            <h2 class="font-display">M3U</h2>
            <p class="text-sm text-foreground-muted mt-2 leading-relaxed">{{ t('dj.m3uBody') }}</p>
          </div>
          <div class="mt-auto flex flex-col gap-2">
            <button type="button" @click="exportM3u" :disabled="!!busy || !dj.playlists.length" class="h-11 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">{{ t('dj.exportM3u') }}</button>
            <button type="button" @click="importM3u" :disabled="!!busy" class="h-11 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover disabled:opacity-40">{{ t('dj.importM3u') }}</button>
          </div>
        </article>
      </div>

      <div class="p-6 rounded-[28px] border border-line flex flex-col gap-4">
        <div>
          <h2 class="font-display">{{ t('dj.convertTitle') }}</h2>
          <p class="text-sm text-foreground-muted mt-2">{{ t('dj.convertBody') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" @click="seratoToRekordbox" :disabled="!!busy || !dj.seratoFolders.length" class="h-12 px-6 rounded-full bg-foreground text-background-main font-mono text-[11px] uppercase disabled:opacity-40">Serato → Rekordbox</button>
          <button type="button" @click="rekordboxToSerato" :disabled="!!busy" class="h-12 px-6 rounded-full bg-foreground text-background-main font-mono text-[11px] uppercase disabled:opacity-40">Rekordbox → Serato</button>
        </div>
      </div>

      <div v-if="busy" class="font-mono text-[11px] uppercase text-primary-400">{{ t('dj.working') }}</div>
      <div v-if="lastFiles.length" class="p-5 rounded-[24px] bg-surface border border-line flex flex-col gap-2">
        <p class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('dj.result') }}</p>
        <div v-for="f in lastFiles.slice(0, 12)" :key="f" class="flex items-center gap-3 text-sm">
          <span class="flex-1 truncate font-mono text-xs" :title="f">{{ f }}</span>
          <button v-if="/[\\/]/.test(f)" type="button" @click="reveal(f)" class="h-8 px-3 rounded-full border border-line-strong font-mono text-[10px] uppercase hover:bg-hover">{{ t('dj.showFolder') }}</button>
        </div>
      </div>

      <details class="p-5 rounded-[24px] border border-line text-sm text-foreground-muted leading-relaxed">
        <summary class="cursor-pointer font-mono text-[11px] uppercase text-foreground">{{ t('dj.howTitle') }}</summary>
        <ul class="mt-3 flex flex-col gap-2 list-disc pl-5">
          <li>{{ t('dj.howSerato') }}</li>
          <li>{{ t('dj.howRekordbox') }}</li>
          <li>{{ t('dj.howOthers') }}</li>
        </ul>
      </details>
    </section>
  </div>
</template>
