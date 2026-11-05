<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDownloadStore } from '../stores/downloadStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import LoginModal from './LoginModal.vue'
import BrandMark from './BrandMark.vue'

const route = useRoute()
const { t } = useI18n()
const downloadStore = useDownloadStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

const showLoginModal = ref(false)
const activeDownloadsCount = computed(() => downloadStore.activeDownloads.length)

const isSlim = computed(() => settingsStore.settings.appearance?.slimSidebar ?? false)
const showSearchButton = computed(() => settingsStore.settings.appearance?.showSearchButton ?? true)

// One stroke icon per route, drawn on a 24px grid with round caps.
const icons: Record<string, string> = {
  home: 'M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-3.5-3.5',
  chart: 'M5 20V11M12 20V5M19 20v-6',
  genres: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  sync: 'M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3M18 3v4h-4M6 21v-4h4',
  tag: 'M5 4v16M10 4v16M15 5l4 15',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM5 20a7 7 0 0 1 14 0'
}

const navItems = computed(() => {
  const items = [
    { path: '/', icon: 'home', label: t('nav.home') },
    { path: '/search', icon: 'search', label: t('nav.search'), hidden: !showSearchButton.value },
    { path: '/charts', icon: 'chart', label: t('nav.charts') },
    { path: '/genres', icon: 'genres', label: t('nav.genres') },
    // Brand name, not translated.
    { path: '/qobuz', icon: 'qobuz', label: 'Qobuz', hidden: !settingsStore.isQobuzConnected },
    { path: '/favorites', icon: 'heart', label: t('nav.favorites') },
    { path: '/downloads', icon: 'download', label: t('nav.downloads'), badge: activeDownloadsCount },
    { path: '/analyzer', icon: 'link', label: t('nav.linkAnalyzer') },
    { path: '/sync', icon: 'sync', label: t('nav.playlistSync') },
    { path: '/retag', icon: 'tag', label: t('nav.retag') },
    { path: '/settings', icon: 'settings', label: t('nav.settings') }
  ]
  return items.filter(item => !item.hidden)
})

const isActive = (path: string) => {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}

function handleAuthClick() {
  if (authStore.isLoggedIn) {
    authStore.logout()
  } else {
    showLoginModal.value = true
  }
}
</script>

<template>
  <nav
    role="navigation"
    :aria-label="t('accessibility.mainNavigation')"
    class="bg-background-secondary border-r border-line flex flex-col transition-all duration-300"
    :class="isSlim ? 'w-[72px]' : 'w-60'"
  >
    <!-- Brand -->
    <router-link
      to="/"
      class="flex items-center gap-2.5 pt-5 pb-6"
      :class="isSlim ? 'justify-center px-2' : 'px-5'"
      :aria-label="t('sidebar.appName')"
    >
      <BrandMark class="w-8 h-8 flex-shrink-0" />
      <span v-if="!isSlim" class="text-[17px] font-semibold tracking-tight truncate">{{ t('sidebar.appName') }}</span>
    </router-link>

    <!-- Navigation -->
    <div class="flex-1 overflow-y-auto" :class="isSlim ? 'px-3' : 'px-3'">
      <div class="flex flex-col gap-0.5">
        <router-link
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          :aria-label="item.label"
          :aria-current="isActive(item.path) ? 'page' : undefined"
          class="relative flex items-center min-h-[44px] rounded-[10px] text-sm transition-colors duration-150"
          :class="[
            isSlim ? 'justify-center' : 'gap-3 px-3',
            isActive(item.path)
              ? 'bg-hover text-foreground font-semibold'
              : 'text-foreground-muted hover:text-foreground hover:bg-hover/60'
          ]"
          :title="isSlim ? item.label : ''"
        >
          <span
            v-if="item.icon === 'qobuz'"
            class="w-[18px] h-[18px] flex-shrink-0 flex items-center justify-center rounded-[5px] border border-current text-[10px] font-bold leading-none"
            aria-hidden="true"
          >Q</span>
          <svg
            v-else
            class="w-[18px] h-[18px] flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          ><path :d="icons[item.icon]" /></svg>

          <span v-if="!isSlim" class="flex-1 truncate">{{ item.label }}</span>

          <span
            v-if="item.badge && item.badge.value > 0"
            class="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-xs"
            :class="isSlim ? 'absolute top-0.5 right-0.5' : ''"
          >{{ item.badge.value }}</span>
        </router-link>
      </div>
    </div>

    <!-- Accounts -->
    <div class="p-3 flex flex-col gap-2">
      <div
        v-if="!isSlim"
        class="flex flex-col gap-3 p-3.5 rounded-[14px] bg-surface border border-line"
      >
        <template v-if="authStore.isLoggedIn">
          <div class="flex items-center gap-3 min-w-0">
            <img
              v-if="authStore.user?.picture"
              :src="authStore.user.picture"
              :alt="authStore.user.name"
              class="w-9 h-9 rounded-full object-cover flex-shrink-0"
            />
            <span v-else class="w-9 h-9 rounded-full bg-hover flex items-center justify-center flex-shrink-0">
              <svg class="w-[18px] h-[18px] text-foreground-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path :d="icons.user" /></svg>
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-medium truncate">{{ authStore.user?.name }}</p>
              <p class="text-xs text-foreground-muted truncate">{{ authStore.user?.subscription?.type || t('sidebar.free') }}</p>
            </div>
          </div>
        </template>
        <button
          v-else
          @click="handleAuthClick"
          class="btn btn-primary w-full flex items-center justify-center gap-2 text-sm"
        >
          {{ t('sidebar.loginWithDeezer') }}
        </button>

        <div class="flex items-center gap-2 text-xs" :class="settingsStore.isQobuzLinked ? 'text-foreground' : 'text-foreground-muted'">
          <span class="w-2 h-2 rounded-full" :class="settingsStore.isQobuzLinked ? 'bg-primary-500' : 'bg-line-strong'"></span>
          <router-link to="/settings" class="hover:underline">{{ settingsStore.isQobuzLinked ? t('titleBar.qobuzLinkedTip') : t('qobuz.notConnected') }}</router-link>
        </div>

        <button
          v-if="authStore.isLoggedIn"
          @click="handleAuthClick"
          class="text-xs text-foreground-muted hover:text-foreground text-left"
        >{{ t('sidebar.logout') }}</button>
      </div>

      <button
        v-else-if="!authStore.isLoggedIn"
        @click="handleAuthClick"
        class="w-full min-h-[44px] flex items-center justify-center rounded-[10px] text-foreground-muted hover:bg-hover"
        :title="t('sidebar.loginWithDeezer')"
        :aria-label="t('sidebar.loginWithDeezer')"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path :d="icons.user" /></svg>
      </button>

      <router-link
        v-if="!isSlim"
        to="/about"
        class="px-2 py-1 text-xs text-foreground-muted hover:text-foreground"
      >{{ t('nav.about') }}</router-link>
    </div>

    <LoginModal
      :show="showLoginModal"
      @close="showLoginModal = false"
    />
  </nav>
</template>
