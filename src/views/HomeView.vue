<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { deezerAPI } from '../services/deezerAPI'
import TrackCard from '../components/TrackCard.vue'
import AlbumCard from '../components/AlbumCard.vue'
import ErrorState from '../components/ErrorState.vue'
import ContextMenu from '../components/ContextMenu.vue'
import { useContextMenu } from '../composables/useContextMenu'
import type { Track, Album, Playlist } from '../types'
import { useAuthStore } from '../stores/authStore'
import { useFavoritesStore } from '../stores/favoritesStore'

const router = useRouter()
const { t } = useI18n()
const searchQuery = ref('')
const { locale } = useI18n()
const authStore = useAuthStore()
const favoritesStore = useFavoritesStore()
const greeting = computed(() => {
  const h = new Date().getHours()
  const base = h < 12 ? t('home.greetingMorning') : h < 18 ? t('home.greetingAfternoon') : t('home.greetingEvening')
  const name = (authStore.user?.name || '').split(' ')[0]
  return name ? `${base}, ${name}` : base
})
// One box for both jobs: a link goes to the analyzer, anything else is a search.
const looksLikeLink = computed(() => /^(https?:\/\/|spotify:|www\.)|(deezer|spotify|qobuz|apple|youtube|tidal)\.[a-z]+\//i.test(searchQuery.value.trim()))
const today = computed(() => {
  const d = new Date().toLocaleDateString(locale.value, { weekday: 'short', day: '2-digit', month: 'short' })
  return d.charAt(0).toUpperCase() + d.slice(1)
})
const newReleases = ref<Album[]>([])
const topTracks = ref<Track[]>([])
const topAlbums = ref<Album[]>([])
const popularPlaylists = ref<Playlist[]>([])
const isLoading = ref(true)
const hasError = ref(false)

async function loadContent() {
  isLoading.value = true
  hasError.value = false
  try {
    // Load chart data and new releases for all sections
    const [releasesResponse, tracksResponse, albumsResponse, playlistsResponse] = await Promise.all([
      // New releases get a deeper cut than the chart rows — the feed is genuinely
      // dated (newest first) and users want the full recent breadth at a glance.
      deezerAPI.getNewReleases(30),
      deezerAPI.getChart('tracks'),
      deezerAPI.getChart('albums'),
      deezerAPI.getChart('playlists')
    ])
    newReleases.value = releasesResponse.slice(0, 30)
    topTracks.value = tracksResponse.slice(0, 10)
    topAlbums.value = albumsResponse.slice(0, 10)
    popularPlaylists.value = playlistsResponse.slice(0, 10)
  } catch (error) {
    console.error('Failed to load charts:', error)
    hasError.value = true
  } finally {
    isLoading.value = false
  }
}

onMounted(() => {
  loadContent()
})

function handleSearch() {
  if (looksLikeLink.value) {
    router.push({ path: '/analyzer', query: { url: searchQuery.value.trim() } })
    return
  }
  if (searchQuery.value.trim()) {
    router.push({ path: '/search', query: { q: searchQuery.value } })
  }
}

// Context menu for search input
const { menuState, openMenu, closeMenu, copyToClipboard, pasteFromClipboard } = useContextMenu()

function openSearchMenu(e: MouseEvent) {
  openMenu(e)
}

const contextMenuItems = computed(() => [
  {
    label: t('contextMenu.paste'),
    icon: 'paste',
    action: async () => {
      const text = await pasteFromClipboard()
      if (text) {
        searchQuery.value = text
      }
    }
  },
  {
    label: t('contextMenu.copy'),
    icon: 'copy',
    action: () => copyToClipboard(searchQuery.value),
    disabled: !searchQuery.value
  }
])

</script>

<template>
  <div class="space-y-12">
    <!-- Smart field: search or paste a link -->
    <form @submit.prevent="handleSearch" class="flex items-center gap-2.5 h-[52px] pl-5 pr-1.5 rounded-full bg-surface border border-line focus-within:border-line-strong transition-colors max-w-[1240px]">
      <svg class="w-[18px] h-[18px] text-foreground-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input
        v-model="searchQuery"
        type="search"
        :aria-label="t('home.smartPlaceholder')"
        :placeholder="t('home.smartPlaceholder')"
        class="flex-1 min-w-0 bg-transparent border-none outline-none text-[15px] text-foreground placeholder:text-foreground-muted"
        @contextmenu="openSearchMenu"
      />
      <button type="submit" class="h-10 px-5 rounded-full bg-primary-500 text-white font-mono text-[12px] uppercase tracking-[0.12em] hover:bg-primary-600 transition-colors">
        {{ looksLikeLink ? t('analyzer.analyze') : t('home.go') }}
      </button>
    </form>

    <!-- Greeting and collection -->
    <section class="flex flex-wrap items-end justify-between gap-6 max-w-[1240px]">
      <div class="flex flex-col gap-2">
        <p class="font-mono text-[11px] uppercase text-foreground-muted">{{ today }}</p>
        <h1 class="font-display text-[52px] leading-[0.95]">{{ greeting }}</h1>
      </div>
      <div class="flex gap-3" :aria-label="t('home.yourCollection')">
        <router-link to="/favorites" class="w-[124px] h-[124px] rounded-full bg-foreground text-background-main flex flex-col items-center justify-center gap-1 hover:opacity-90 transition-opacity">
          <span class="font-display text-[26px] leading-none">{{ favoritesStore.favoriteTracks.length }}</span>
          <span class="font-mono text-[10px] uppercase">{{ t('home.tileTracks') }}</span>
        </router-link>
        <router-link to="/favorites" class="w-[124px] h-[124px] rounded-[28px] bg-primary-500 text-white flex flex-col items-center justify-center gap-1 hover:bg-primary-600 transition-colors">
          <span class="font-display text-[26px] leading-none">{{ favoritesStore.favoritePlaylists.length }}</span>
          <span class="font-mono text-[10px] uppercase">{{ t('home.tilePlaylists') }}</span>
        </router-link>
      </div>
    </section>

    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center py-20">
      <div class="animate-spin w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full"></div>
    </div>

    <!-- Error State -->
    <ErrorState
      v-else-if="hasError"
      :title="t('errors.loadingFailed')"
      :message="t('errors.tryAgainLater')"
      @retry="loadContent"
    />

    <!-- Content -->
    <template v-else>
      <!-- New Releases -->
      <section v-if="newReleases.length > 0">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-mono text-[12px] uppercase">{{ t('home.newReleases') }}</h2>
          <router-link to="/new-releases" class="font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground flex items-center gap-1">
            {{ t('home.seeAll') }}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
          <AlbumCard
            v-for="album in newReleases"
            :key="album.id"
            :album="album"
          />
        </div>
      </section>

      <!-- Top Tracks -->
      <section v-if="topTracks.length > 0">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-mono text-[12px] uppercase">{{ t('home.topTracks') }}</h2>
          <router-link to="/charts?type=tracks" class="font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground flex items-center gap-1">
            {{ t('home.seeAll') }}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-2 gap-1.5">
          <TrackCard
            v-for="track in topTracks"
            :key="track.id"
            :track="track"
          />
        </div>
      </section>

      <!-- Most Streamed Albums -->
      <section v-if="topAlbums.length > 0">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-mono text-[12px] uppercase">{{ t('home.mostStreamedAlbums') }}</h2>
          <router-link to="/charts?type=albums" class="font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground flex items-center gap-1">
            {{ t('home.seeAll') }}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
          <AlbumCard
            v-for="album in topAlbums"
            :key="album.id"
            :album="album"
          />
        </div>
      </section>

      <!-- Popular Playlists -->
      <section v-if="popularPlaylists.length > 0">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-mono text-[12px] uppercase">{{ t('home.popularPlaylists') }}</h2>
          <router-link to="/charts?type=playlists" class="font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground flex items-center gap-1">
            {{ t('home.seeAll') }}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-6">
          <AlbumCard
            v-for="playlist in popularPlaylists"
            :key="playlist.id"
            :album="{
              id: playlist.id,
              title: playlist.title,
              cover_medium: playlist.picture_medium,
              artist: { id: 0, name: playlist.creator?.name || (playlist as any).user?.name || 'Deezer' },
              nb_tracks: playlist.nb_tracks
            }"
            type="playlist"
          />
        </div>
      </section>
    </template>

    <!-- Empty State -->
    <div v-if="!isLoading && !hasError && newReleases.length === 0 && topTracks.length === 0 && topAlbums.length === 0 && popularPlaylists.length === 0" class="text-center py-20">
      <svg class="w-16 h-16 mx-auto text-foreground-muted mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
          d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
      <p class="text-foreground-muted">{{ t('home.searchToStart') }}</p>
    </div>

    <!-- Context Menu -->
    <ContextMenu
      :show="menuState.show"
      :x="menuState.x"
      :y="menuState.y"
      :items="contextMenuItems"
      @close="closeMenu"
    />
  </div>
</template>
