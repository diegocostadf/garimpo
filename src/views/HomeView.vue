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

const router = useRouter()
const { t } = useI18n()
const searchQuery = ref('')
const linkQuery = ref('')
const { locale } = useI18n()
const today = computed(() => {
  const d = new Date().toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' })
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

function handleLink() {
  if (linkQuery.value.trim()) {
    router.push({ path: '/analyzer', query: { url: linkQuery.value.trim() } })
  }
}

function handleSearch() {
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
    <!-- Hero: greeting, search and paste-a-link -->
    <section class="flex flex-col gap-5 max-w-[1240px]">
      <div class="flex flex-col gap-1.5">
        <p class="text-sm text-foreground-muted">{{ today }}</p>
        <h1 class="text-[40px] leading-[1.1] font-semibold tracking-tight">{{ t('home.welcome') }}</h1>
      </div>

      <form @submit.prevent="handleSearch" class="flex items-center gap-2.5 h-12 px-4 rounded-xl bg-surface border border-line focus-within:border-primary-500 transition-colors">
        <svg class="w-[18px] h-[18px] text-foreground-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input
          v-model="searchQuery"
          type="search"
          :aria-label="t('nav.search')"
          :placeholder="t('home.searchPlaceholder')"
          class="flex-1 min-w-0 bg-transparent border-none outline-none text-[15px] text-foreground placeholder:text-foreground-muted"
          @contextmenu="openSearchMenu"
        />
      </form>

      <form @submit.prevent="handleLink" class="flex flex-wrap items-center gap-2.5 p-2 rounded-2xl bg-surface border border-line">
        <svg class="w-[18px] h-[18px] ml-2.5 text-foreground-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
        <input
          v-model="linkQuery"
          type="url"
          :aria-label="t('nav.linkAnalyzer')"
          :placeholder="t('analyzer.getStarted')"
          class="flex-1 min-w-[200px] h-11 bg-transparent border-none outline-none text-[15px] text-foreground placeholder:text-foreground-muted"
        />
        <button type="submit" class="h-11 px-5 rounded-[10px] bg-foreground text-background-main text-sm font-medium hover:opacity-90 transition-opacity">{{ t('analyzer.analyze') }}</button>
      </form>
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
          <h2 class="text-xl font-semibold tracking-tight">{{ t('home.newReleases') }}</h2>
          <router-link to="/new-releases" class="text-sm text-foreground-muted hover:text-foreground flex items-center gap-1">
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
          <h2 class="text-xl font-semibold tracking-tight">{{ t('home.topTracks') }}</h2>
          <router-link to="/charts?type=tracks" class="text-sm text-foreground-muted hover:text-foreground flex items-center gap-1">
            {{ t('home.seeAll') }}
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
          </router-link>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
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
          <h2 class="text-xl font-semibold tracking-tight">{{ t('home.mostStreamedAlbums') }}</h2>
          <router-link to="/charts?type=albums" class="text-sm text-foreground-muted hover:text-foreground flex items-center gap-1">
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
          <h2 class="text-xl font-semibold tracking-tight">{{ t('home.popularPlaylists') }}</h2>
          <router-link to="/charts?type=playlists" class="text-sm text-foreground-muted hover:text-foreground flex items-center gap-1">
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
