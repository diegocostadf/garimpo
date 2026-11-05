<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { apiGet, apiPost } from '../utils/api'
import { useDownloadStore } from '../stores/downloadStore'
import { useWizardStore } from '../stores/wizardStore'
import { usePlayerStore } from '../stores/playerStore'
import { useToastStore } from '../stores/toastStore'
import ChannelFader from '../components/ChannelFader.vue'

// Playlist conversion: paste a link from another service (or a list of
// songs), Garimpo reads it, finds each song in the Deezer catalog and queues
// the downloads.
const { t } = useI18n()
const router = useRouter()
const downloadStore = useDownloadStore()
const wizard = useWizardStore()
const player = usePlayerStore()
const toast = useToastStore()

type Service = 'spotify' | 'applemusic' | 'youtubemusic' | 'timmusic' | 'deezer' | 'youtube' | 'text'
interface SourceTrack { title: string; artist: string; album?: string; isrc?: string; durationMs?: number }
interface SourcePlaylist { service: Service; name: string; cover?: string; tracks: SourceTrack[]; truncated?: boolean }
interface Match {
  source: SourceTrack
  deezer: { id: number; title: string; artist: { name: string }; album: { title: string; cover_medium: string }; duration: number; preview: string } | null
  matchType: 'isrc' | 'search' | 'none'
  confidence: number
}

const SOURCES: Array<{ id: Service; label: string; hint: string }> = [
  { id: 'spotify', label: 'Spotify', hint: 'https://open.spotify.com/playlist/…' },
  { id: 'applemusic', label: 'Apple Music', hint: 'https://music.apple.com/br/playlist/…' },
  { id: 'youtubemusic', label: 'YouTube Music', hint: 'https://music.youtube.com/playlist?list=…' },
  { id: 'timmusic', label: 'TIM Music', hint: 'https://www.deezer.com/br/playlist/…' },
  { id: 'deezer', label: 'Deezer', hint: 'https://www.deezer.com/br/playlist/…' },
  { id: 'text', label: '', hint: '' }
]
const serviceName = (s: Service) => SOURCES.find(x => x.id === s)?.label || (s === 'youtube' ? 'YouTube' : t('convert.textSource'))

const mode = ref<Service>('spotify')
const link = ref('')
const pasted = ref('')
const reading = ref(false)
const error = ref('')
const playlist = ref<SourcePlaylist | null>(null)
const results = ref<Match[]>([])
const jobId = ref<string | null>(null)
const matching = ref(false)
const filter = ref<'all' | 'found' | 'missing'>('all')
let poll: ReturnType<typeof setTimeout> | null = null

const placeholder = computed(() => SOURCES.find(s => s.id === mode.value)?.hint || '')
const found = computed(() => results.value.filter(r => r.deezer))
const missing = computed(() => results.value.filter(r => !r.deezer))
const progress = computed(() => playlist.value?.tracks.length ? Math.round((results.value.length / playlist.value.tracks.length) * 100) : 0)
const shown = computed(() => filter.value === 'found' ? found.value : filter.value === 'missing' ? missing.value : results.value)
const needsSpotify = computed(() => error.value === 'E_SPOTIFY')
const errorText = computed(() => /^E_[A-Z]+$/.test(error.value) ? t(`convert.errors.${error.value}`) : error.value)

function detect(v: string): Service | null {
  if (/spotify\.com|spotify:|spotify\.link/i.test(v)) return 'spotify'
  if (/music\.apple\.com|apple\.co/i.test(v)) return 'applemusic'
  if (/music\.youtube\.com/i.test(v)) return 'youtubemusic'
  if (/youtube\.com|youtu\.be/i.test(v)) return 'youtube'
  if (/timmusic|tim\.com\.br/i.test(v)) return 'timmusic'
  if (/deezer/i.test(v)) return 'deezer'
  return null
}
function onLinkInput() {
  const s = detect(link.value)
  if (s && s !== 'youtube') mode.value = s
}

async function read() {
  error.value = ''
  reset(false)
  reading.value = true
  try {
    playlist.value = mode.value === 'text'
      ? await apiPost<SourcePlaylist>('/api/import/read', { text: pasted.value, name: t('convert.pastedName') })
      : await apiPost<SourcePlaylist>('/api/import/read', { url: link.value })
  } catch (e: any) {
    error.value = e?.message || 'E_NETWORK'
  } finally {
    reading.value = false
  }
}

async function match() {
  if (!playlist.value) return
  results.value = []
  matching.value = true
  try {
    const { jobId: id } = await apiPost<{ jobId: string }>('/api/import/match', { tracks: playlist.value.tracks })
    jobId.value = id
    tick()
  } catch (e: any) {
    matching.value = false
    error.value = e?.message || t('convert.matchError')
  }
}

async function tick() {
  if (!jobId.value) return
  try {
    const s = await apiGet<{ finished: boolean; results: Match[] }>(`/api/import/status?id=${jobId.value}&from=${results.value.length}`)
    results.value.push(...s.results)
    if (s.finished) { matching.value = false; jobId.value = null; return }
  } catch { /* keep polling */ }
  poll = setTimeout(tick, 700)
}

async function cancel() {
  if (jobId.value) await apiPost('/api/import/cancel', { id: jobId.value }).catch(() => {})
  matching.value = false
  jobId.value = null
  if (poll) clearTimeout(poll)
}

function reset(clearInput = true) {
  cancel()
  playlist.value = null
  results.value = []
  filter.value = 'all'
  if (clearInput) { link.value = ''; pasted.value = '' }
}

async function downloadAll() {
  if (!playlist.value || !found.value.length) return
  await downloadStore.addBatchDownload({
    trackIds: found.value.map(r => r.deezer!.id),
    playlistName: playlist.value.name,
    title: playlist.value.name,
    cover: playlist.value.cover,
    totalTracks: found.value.length
  })
  toast.success(t('convert.queued', { n: found.value.length }))
}

function preview(r: Match) {
  if (!r.deezer) return
  const asTrack = (m: Match) => ({ ...m.deezer!, album: { ...m.deezer!.album, cover_small: m.deezer!.album.cover_medium } }) as any
  player.play(asTrack(r), found.value.map(asTrack))
}

function searchFor(r: Match) {
  router.push({ path: '/search', query: { q: `${r.source.artist} ${r.source.title}`.trim() } })
}

const fmt = (ms?: number) => {
  if (!ms) return ''
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

onBeforeUnmount(() => { if (poll) clearTimeout(poll) })
</script>

<template>
  <div class="max-w-[1040px] flex flex-col gap-8">
    <header class="flex flex-col gap-2">
      <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('nav.groups.tools') }}</span>
      <h1 class="font-display">{{ t('convert.title') }}</h1>
      <p class="text-foreground-muted max-w-[620px]">{{ t('convert.subtitle') }}</p>
    </header>

    <!-- Step 1: source -->
    <section v-if="!playlist" class="flex flex-col gap-4">
      <div class="flex flex-wrap gap-2" role="tablist" :aria-label="t('convert.from')">
        <button
          v-for="s in SOURCES"
          :key="s.id"
          type="button"
          role="tab"
          :aria-selected="mode === s.id"
          @click="mode = s.id"
          class="h-10 px-4 rounded-full border font-mono text-[11px] uppercase transition-colors"
          :class="mode === s.id ? 'bg-foreground text-background-main border-foreground' : 'border-line-strong text-foreground-muted hover:text-foreground'"
        >{{ s.label || t('convert.textSource') }}</button>
      </div>

      <form v-if="mode !== 'text'" class="flex items-center gap-2 h-16 pl-6 pr-2 rounded-full bg-surface border border-line" @submit.prevent="read">
        <svg class="w-5 h-5 text-foreground-muted flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>
        <input
          v-model="link"
          @input="onLinkInput"
          type="url"
          :placeholder="placeholder"
          :aria-label="t('convert.linkLabel')"
          class="flex-1 min-w-0 bg-transparent outline-none text-[15px] placeholder:text-foreground-muted"
        />
        <button type="submit" :disabled="!link.trim() || reading" class="h-12 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">
          {{ reading ? t('convert.reading') : t('convert.read') }}
        </button>
      </form>

      <form v-else class="flex flex-col gap-3" @submit.prevent="read">
        <textarea
          v-model="pasted"
          rows="9"
          :placeholder="t('convert.textPlaceholder')"
          :aria-label="t('convert.textSource')"
          class="w-full p-5 rounded-[24px] bg-surface border border-line outline-none font-mono text-[13px] leading-relaxed placeholder:text-foreground-muted resize-y"
        />
        <div class="flex items-center justify-between gap-3">
          <p class="text-xs text-foreground-muted">{{ t('convert.textHint') }}</p>
          <button type="submit" :disabled="!pasted.trim() || reading" class="h-12 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">
            {{ reading ? t('convert.reading') : t('convert.read') }}
          </button>
        </div>
      </form>

      <div v-if="error" class="flex flex-wrap items-center gap-3 p-4 rounded-[20px] border border-primary-500/50 text-sm">
        <span class="w-2 h-2 rounded-full bg-primary-500" aria-hidden="true" />
        <span class="flex-1">{{ errorText }}</span>
        <button v-if="needsSpotify" type="button" @click="wizard.openSpotify()" class="h-9 px-4 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('convert.connectSpotify') }}</button>
      </div>

      <ol class="grid sm:grid-cols-3 gap-3 pt-2">
        <li v-for="n in 3" :key="n" class="p-5 rounded-[20px] bg-surface border border-line flex flex-col gap-2">
          <span class="font-display text-[28px] leading-none text-primary-400">0{{ n }}</span>
          <span class="text-sm font-semibold">{{ t(`convert.step${n}Title`) }}</span>
          <span class="text-xs text-foreground-muted leading-relaxed">{{ t(`convert.step${n}Body`) }}</span>
        </li>
      </ol>
    </section>

    <!-- Step 2: playlist read, matching -->
    <section v-else class="flex flex-col gap-6">
      <div class="flex flex-wrap items-center gap-5 p-5 rounded-[28px] bg-surface border border-line">
        <img v-if="playlist.cover" :src="playlist.cover" alt="" class="w-24 h-24 rounded-[20px] object-cover" />
        <span v-else class="w-24 h-24 rounded-[20px] bg-background-tertiary flex items-center justify-center font-display text-[28px]">{{ playlist.tracks.length }}</span>
        <div class="flex-1 min-w-[200px] flex flex-col gap-1">
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ serviceName(playlist.service) }} · {{ t('convert.trackCount', { n: playlist.tracks.length }) }}</span>
          <h2 class="text-2xl font-semibold leading-tight">{{ playlist.name }}</h2>
          <span v-if="playlist.truncated" class="text-xs text-foreground-muted">{{ t('convert.truncated') }}</span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" @click="reset()" class="h-11 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('convert.another') }}</button>
          <button v-if="!matching && !results.length" type="button" @click="match" class="h-11 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase">{{ t('convert.find') }}</button>
          <button v-else-if="matching" type="button" @click="cancel" class="h-11 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('convert.stop') }}</button>
          <button v-else type="button" @click="downloadAll" :disabled="!found.length" class="h-11 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">{{ t('convert.downloadAll', { n: found.length }) }}</button>
        </div>
      </div>

      <div v-if="matching || results.length" class="flex flex-col gap-3">
        <div class="flex items-end justify-between gap-4">
          <div class="flex items-baseline gap-4">
            <span class="font-display text-[44px] leading-none">{{ progress }}%</span>
            <span class="font-mono text-[11px] uppercase text-foreground-muted">
              {{ t('convert.found', { n: found.length }) }} · {{ t('convert.missing', { n: missing.length }) }}
            </span>
          </div>
          <div class="flex gap-1.5" role="tablist">
            <button
              v-for="f in (['all', 'found', 'missing'] as const)"
              :key="f"
              type="button"
              role="tab"
              :aria-selected="filter === f"
              @click="filter = f"
              class="h-9 px-3.5 rounded-full border font-mono text-[11px] uppercase"
              :class="filter === f ? 'bg-foreground text-background-main border-foreground' : 'border-line-strong text-foreground-muted hover:text-foreground'"
            >{{ t(`convert.filter.${f}`) }}</button>
          </div>
        </div>
        <ChannelFader :value="progress" orientation="horizontal" :label="t('convert.progress')" :active="matching" />
      </div>

      <ul v-if="shown.length" class="flex flex-col gap-1.5">
        <li v-for="(r, i) in shown" :key="i" class="flex items-center gap-4 px-4 py-3 rounded-full bg-surface border border-line">
          <span class="font-mono text-[11px] w-8 text-foreground-muted text-right">{{ String(results.indexOf(r) + 1).padStart(2, '0') }}</span>
          <div class="flex-1 min-w-0 grid grid-cols-2 gap-4 items-center">
            <div class="min-w-0">
              <p class="text-sm truncate">{{ r.source.title }}</p>
              <p class="text-xs text-foreground-muted truncate">{{ r.source.artist || '—' }} <span v-if="r.source.durationMs">· {{ fmt(r.source.durationMs) }}</span></p>
            </div>
            <div v-if="r.deezer" class="min-w-0 flex items-center gap-3">
              <button type="button" @click="preview(r)" :aria-label="t('player.play')" class="relative w-10 h-10 rounded-full overflow-hidden flex-none group">
                <img :src="r.deezer.album.cover_medium" alt="" class="w-full h-full object-cover" loading="lazy" />
                <span class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100" :class="player.isTrackPlaying(r.deezer.id) ? 'opacity-100' : ''">
                  <svg v-if="player.isTrackPlaying(r.deezer.id)" class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
                  <svg v-else class="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z" /></svg>
                </span>
              </button>
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">{{ r.deezer.title }}</p>
                <p class="text-xs text-foreground-muted truncate">{{ r.deezer.artist.name }} · {{ r.deezer.album.title }}</p>
              </div>
            </div>
            <div v-else class="text-sm text-foreground-muted">{{ t('convert.notFound') }}</div>
          </div>
          <span
            v-if="r.deezer"
            class="font-mono text-[10px] uppercase px-2.5 py-1 rounded-full border"
            :class="r.matchType === 'isrc' || r.confidence >= 85 ? 'border-line-strong text-foreground' : 'border-primary-500 text-primary-400'"
            :title="t('convert.confidenceHint')"
          >{{ r.matchType === 'isrc' ? 'ISRC' : r.confidence + '%' }}</span>
          <button v-else type="button" @click="searchFor(r)" class="h-8 px-3 rounded-full border border-line-strong font-mono text-[10px] uppercase hover:bg-hover">{{ t('convert.search') }}</button>
        </li>
      </ul>

      <ul v-else-if="!matching" class="flex flex-col gap-1.5">
        <li v-for="(s, i) in playlist.tracks.slice(0, 200)" :key="i" class="flex items-center gap-4 px-4 py-3 rounded-full bg-surface border border-line">
          <span class="font-mono text-[11px] w-8 text-foreground-muted text-right">{{ String(i + 1).padStart(2, '0') }}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate">{{ s.title }}</p>
            <p class="text-xs text-foreground-muted truncate">{{ s.artist || '—' }}</p>
          </div>
          <span class="font-mono text-[11px] text-foreground-muted">{{ fmt(s.durationMs) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
