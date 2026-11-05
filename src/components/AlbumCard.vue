<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDownloadStore } from '../stores/downloadStore'
import { deezerAPI } from '../services/deezerAPI'
import { useContextMenu } from '../composables/useContextMenu'
import ContextMenu from './ContextMenu.vue'
import type { Album } from '../types'

const { t } = useI18n()

const props = withDefaults(defineProps<{
  album: Album
  type?: 'album' | 'playlist'
}>(), {
  type: 'album'
})

const router = useRouter()
const downloadStore = useDownloadStore()
const isDownloading = ref(false)

const candidateUrls = computed(() =>
  [props.album.cover_medium, props.album.cover_big, props.album.cover_small]
    .filter((u): u is string => !!u)
)

const candidateIndex = ref(0)
const allCoversFailed = ref(false)

const coverUrl = computed(() => candidateUrls.value[candidateIndex.value] ?? '')

function handleImageError() {
  if (candidateIndex.value < candidateUrls.value.length - 1) {
    candidateIndex.value++
  } else {
    allCoversFailed.value = true
  }
}

watch(() => props.album.id, () => {
  candidateIndex.value = 0
  allCoversFailed.value = false
})

function navigate(event: Event) {
  event.stopPropagation()
  // Qobuz items load from the Qobuz backend (their id isn't a Deezer id).
  const query = (props.album as any).source === 'qobuz' ? { source: 'qobuz' } : undefined
  if (props.type === 'playlist') {
    router.push({ path: `/playlist/${props.album.id}`, query })
  } else {
    router.push({ path: `/album/${props.album.id}`, query })
  }
}

async function downloadAlbum() {
  if (isDownloading.value) return
  isDownloading.value = true

  try {
    // Qobuz-sourced album/playlist: skip the Deezer track fetch (its id isn't a
    // Deezer id) and route straight to the Qobuz download path, which fetches
    // the tracklist server-side.
    if ((props.album as any).source === 'qobuz') {
      await downloadStore.addAlbumDownload(props.album, [])
      return
    }
    if (props.type === 'playlist') {
      const tracks = await deezerAPI.getPlaylistTracks(props.album.id)
      if (tracks && tracks.length > 0) {
        await downloadStore.addPlaylistDownload({
          id: props.album.id,
          title: props.album.title,
          creator: props.album.artist
            ? { id: Number(props.album.artist.id) || 0, name: props.album.artist.name }
            : { id: 0, name: t('common.unknownArtist') },
          picture_medium: props.album.cover_medium || '',
          picture_big: props.album.cover_big || '',
          nb_tracks: tracks.length
        }, tracks)
      }
    } else {
      const tracks = await deezerAPI.getAlbumTracks(props.album.id)
      if (tracks && tracks.length > 0) {
        await downloadStore.addAlbumDownload(props.album, tracks)
      }
    }
  } catch (error) {
    console.error('Failed to download:', error)
  } finally {
    isDownloading.value = false
  }
}

function navigateToArtist(event: Event) {
  event.stopPropagation()
  const query = (props.album as any).source === 'qobuz' ? { source: 'qobuz' } : undefined
  if (props.type === 'playlist') {
    // Playlist creators are users, not artists — navigate to the playlist instead
    router.push({ path: `/playlist/${props.album.id}`, query })
  } else if (props.album.artist?.id != null && props.album.artist.id !== 0) {
    router.push({ path: `/artist/${props.album.artist.id}`, query })
  }
}

// Context menu
const { menuState, openMenu, closeMenu, copyToClipboard } = useContextMenu()

const contextMenuItems = computed(() => [
  {
    label: t('contextMenu.copyAlbum'),
    icon: 'copy',
    action: () => copyToClipboard(props.album.title, t('contextMenu.album'))
  },
  {
    label: t('contextMenu.copyArtist'),
    icon: 'copy',
    action: () => copyToClipboard(props.album.artist?.name || '', t('contextMenu.artist')),
    disabled: !props.album.artist?.name
  }
])
</script>

<template>
  <div class="album-card group" @contextmenu="openMenu">
    <!-- Album cover — click OPENS the album (matches Spotify/Apple/Deezer);
         the GET button in the hover overlay is the explicit download. -->
    <div
      @click="navigate"
      class="relative aspect-square mb-3 cursor-pointer overflow-hidden rounded-[20px]"
      :class="{ 'opacity-50 pointer-events-none': isDownloading }"
    >
      <!-- Album cover image -->
      <img
        v-if="coverUrl && !allCoversFailed"
        :src="coverUrl"
        :alt="album.title"
        loading="lazy"
        decoding="async"
        class="w-full h-full object-cover rounded-[20px] bg-background-tertiary transition-transform duration-200 group-hover:scale-[1.02]"
        @error="handleImageError"
      />
      <!-- Fallback placeholder when no image or image fails to load -->
      <div
        v-else
        class="w-full h-full rounded-[20px] bg-background-tertiary flex items-center justify-center"
      >
        <svg class="w-12 h-12 text-foreground-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
            d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
        </svg>
      </div>
      <!-- Channel Q source badge — always visible on Qobuz-sourced items -->
      <span
        v-if="(album as any).source === 'qobuz'"
        class="absolute top-2 left-2 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-qobuz-500 text-background-main select-none"
      >Q</span>
      <!-- Qobuz per-album quality ceiling — hi-res in channel cyan, CD muted -->
      <span
        v-if="(album as any).qobuzQuality"
        class="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md font-mono text-[11px] select-none"
        :class="(album as any).qobuzQuality.hires
          ? 'bg-qobuz-500 text-background-main'
          : 'bg-black/70 text-foreground-muted border border-line'"
      >{{ (album as any).qobuzQuality.bitDepth }}/{{ (album as any).qobuzQuality.samplingRate }}</span>
      <!-- Download overlay — the GET button is the explicit download action.
           @click.stop keeps it from also triggering the cover's open-album
           click; clicking the dimmed area (not the button) opens the album. -->
      <div class="absolute inset-0 rounded-[20px] bg-black/25 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity
                  flex items-end justify-end p-3">
        <button
          type="button"
          @click.stop="downloadAlbum"
          :disabled="isDownloading"
          :title="t('albumView.downloadAlbum')"
          :aria-label="t('albumView.downloadAlbum')"
          class="w-11 h-11 rounded-full flex items-center justify-center text-white cursor-pointer
                 shadow-lg transform scale-95 group-hover:scale-100 transition-transform"
          :class="(album as any).source === 'qobuz' ? 'bg-qobuz-600' : 'bg-primary-500'">
          <!-- Download icon -->
          <svg v-if="!isDownloading" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
          <!-- Loading spinner -->
          <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </button>
      </div>
    </div>
    <!-- Title - click to navigate to album details -->
    <h3
      @click="navigate"
      class="text-[15px] font-medium leading-snug line-clamp-2 hover:text-primary-500 transition-colors cursor-pointer"
    >
      {{ album.title }}
    </h3>
    <p class="text-[13px] text-foreground-muted line-clamp-1 mt-0.5"
    >
      <span
        v-if="album.artist?.id != null"
        @click="navigateToArtist"
        class="hover:text-foreground cursor-pointer transition-colors"
      >
        {{ album.artist.name }}
      </span>
      <span v-else>
        {{ album.artist?.name || t('common.variousArtists') }}
      </span>
    </p>
    <p v-if="album.nb_tracks" class="flex items-center gap-1 text-xs text-foreground-muted mt-1">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" /></svg>
      {{ album.nb_tracks }}
    </p>

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
