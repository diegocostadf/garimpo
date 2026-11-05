<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useDownloadStore } from '../stores/downloadStore'
import { useUpdateStore } from '../stores/updateStore'
import { useQuality, qualityLabel as labelOf } from '../composables/useQuality'

const { t } = useI18n()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const downloadStore = useDownloadStore()
const updateStore = useUpdateStore()
const updateWaiting = computed(() => ['available', 'downloading', 'ready'].includes(updateStore.status.state))
const isMaximized = ref(false)

// Detect platform - check multiple sources for reliability
const detectPlatform = (): boolean => {
  // Check navigator.platform
  const navPlatform = navigator.platform?.toLowerCase() || ''
  if (navPlatform.includes('mac')) return true

  // Check userAgent as fallback
  const userAgent = navigator.userAgent?.toLowerCase() || ''
  if (userAgent.includes('macintosh') || userAgent.includes('mac os')) return true

  return false
}

const isMac = detectPlatform()

// On Linux the window is natively framed (#125, for WM snapping), so the OS
// draws the title bar and window buttons — hide our custom ones to avoid a
// duplicate set. The status bar itself stays.
const detectLinux = (): boolean => {
  const nav = navigator.platform?.toLowerCase() || ''
  const ua = navigator.userAgent?.toLowerCase() || ''
  return (nav.includes('linux') || ua.includes('linux')) && !ua.includes('android')
}
const isLinux = detectLinux()

const { label: qualityLabel, capped: qualityCapped, selected: selectedQuality } = useQuality()

const region = computed(() => authStore.user?.country || '')

const throughput = computed(() => {
  const bps = downloadStore.totalDownloadSpeed
  if (!bps || downloadStore.activeDownloads.length === 0) return ''
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`
  return `${(bps / 1024).toFixed(0)} KB/s`
})

onMounted(async () => {
  if (window.electronAPI) {
    try {
      isMaximized.value = await window.electronAPI.isMaximized()
      window.electronAPI.onMaximizeChange((maximized) => {
        isMaximized.value = maximized
      })
    } catch (error) {
      console.error('Failed to get window state:', error)
    }
  }
})


const minimize = () => window.electronAPI?.minimize()
const maximize = () => window.electronAPI?.maximize()
const close = () => window.electronAPI?.close()
</script>

<template>
  <div
    class="h-10 flex items-center gap-2 bg-background-main border-b border-line drag-region select-none text-xs text-foreground-muted"
    :class="[isMac ? 'pl-20' : 'pl-4', (isMac || isLinux) ? 'pr-3' : '']"
  >
    <!-- Flexible drag space -->
    <div class="flex-1 h-full"></div>

    <!-- Live throughput (only while downloading) -->
    <span v-if="throughput" class="hidden sm:inline font-mono text-primary-400">{{ throughput }}</span>

    <!-- Status pills: account region, Qobuz link and default quality -->
    <span v-if="region" class="hidden md:inline-flex items-center h-6 px-2 rounded-full border border-line">{{ region }}</span>
    <span
      class="hidden sm:inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-line"
      v-tooltip="settingsStore.isQobuzLinked ? t('titleBar.qobuzLinkedTip') : t('titleBar.qobuzOfflineTip')"
    >
      <span class="w-1.5 h-1.5 rounded-full" :class="settingsStore.isQobuzLinked ? 'bg-primary-500' : 'border border-foreground-muted'"></span>
      Qobuz
    </span>
    <!-- New version: stays visible until installed, even after "Depois" -->
    <button
      v-if="updateWaiting"
      type="button"
      @click="updateStore.dialogOpen = true"
      class="no-drag inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-primary-500 text-white"
      data-testid="update-badge"
      :aria-label="t('updates.badgeLabel', { version: updateStore.status.latest || '' })"
    >
      <span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse" aria-hidden="true"></span>
      {{ updateStore.status.state === 'ready' ? t('updates.badgeReady') : t('updates.badge', { version: updateStore.status.latest || '' }) }}
    </button>
    <span
      class="hidden sm:inline-flex items-center gap-1.5 h-6 px-2 rounded-full border border-line text-foreground"
      data-testid="quality-badge"
      v-tooltip="!authStore.isLoggedIn ? t('titleBar.qualityLoggedOut') : qualityCapped ? t('titleBar.qualityCapped', { chosen: labelOf(selectedQuality), quality: qualityLabel }) : t('titleBar.qualityTip', { quality: qualityLabel })"
    >
      <span class="w-1.5 h-1.5 rounded-full" :class="authStore.isLoggedIn ? 'bg-primary-500' : 'border border-foreground-muted'"></span>
      {{ qualityLabel }}<span v-if="qualityCapped" class="text-foreground-muted">*</span>
    </span>

    <!-- Window controls (Windows only: Mac shows native traffic lights, Linux
         is natively framed for WM snapping so the OS draws these). -->
    <div v-if="!isMac && !isLinux" class="flex items-center h-full no-drag ml-2" role="group" :aria-label="t('accessibility.windowControls')">
      <button
        @click="minimize"
        :aria-label="t('accessibility.minimizeWindow')"
        class="w-12 h-full flex items-center justify-center text-foreground hover:bg-hover transition-colors"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M20 12H4" />
        </svg>
      </button>
      <button
        @click="maximize"
        :aria-label="t('accessibility.maximizeWindow')"
        class="w-12 h-full flex items-center justify-center text-foreground hover:bg-hover transition-colors"
      >
        <svg v-if="!isMaximized" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" stroke-width="1.8" />
        </svg>
        <svg v-else class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" stroke-width="1.8" />
          <path stroke-width="1.8" d="M8 6V5a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1h-1" />
        </svg>
      </button>
      <button
        @click="close"
        :aria-label="t('accessibility.closeWindow')"
        class="w-12 h-full flex items-center justify-center text-foreground hover:bg-primary-500 hover:text-white transition-colors"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
