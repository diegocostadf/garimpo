<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useDownloadStore } from '../stores/downloadStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWizardStore } from '../stores/wizardStore'
import { useAccountStore, type ModuleId } from '../stores/accountStore'
import BrandMark from './BrandMark.vue'
import { useQuality } from '../composables/useQuality'

const route = useRoute()
const { t } = useI18n()
const downloadStore = useDownloadStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const wizardStore = useWizardStore()
const account = useAccountStore()
const { label: qualityLabel } = useQuality()

const activeDownloadsCount = computed(() => downloadStore.activeDownloads.length)
const isSlim = computed(() => settingsStore.settings.appearance?.slimSidebar ?? false)

interface NavItem { path: string; label: string; hidden?: boolean; live?: boolean; module?: ModuleId }

// Three short groups. Everything that is configuration (accounts, about,
// appearance) lives in Ajustes, and pasting a link works from any search box,
// so neither needs its own menu entry.
const groups = computed(() => [
  {
    label: t('nav.groups.discover'),
    items: [
      { path: '/', label: t('nav.home') },
      { path: '/search', label: t('nav.search') },
      { path: '/charts', label: t('nav.charts') },
      { path: '/genres', label: t('nav.genres') },
      { path: '/qobuz', label: 'Qobuz', hidden: !settingsStore.isQobuzConnected, module: 'qobuz' }
    ] as NavItem[]
  },
  {
    label: t('nav.groups.library'),
    items: [
      { path: '/favorites', label: t('nav.favorites') },
      { path: '/downloads', label: t('nav.downloads'), live: activeDownloadsCount.value > 0 },
      { path: '/retag', label: t('nav.retag') }
    ] as NavItem[]
  },
  {
    label: t('nav.groups.tools'),
    items: [
      { path: '/convert', label: t('nav.convert'), module: 'converter' },
      { path: '/dj', label: t('nav.dj'), module: 'dj' },
      { path: '/sync', label: t('nav.playlistSync') }
    ] as NavItem[]
  }
].map(g => ({ ...g, items: g.items.filter(i => !i.hidden) })))

// Running number across groups, like channel numbers on a desk.
const numbered = computed(() => {
  let n = 0
  return groups.value.map(g => ({ ...g, items: g.items.map(i => ({ ...i, num: String(++n).padStart(2, '0') })) }))
})

const isActive = (path: string) => (path === '/' ? route.path === '/' : route.path.startsWith(path))
</script>

<template>
  <nav
    role="navigation"
    :aria-label="t('accessibility.mainNavigation')"
    class="bg-background-secondary border-r border-line flex flex-col transition-all duration-300"
    :class="isSlim ? 'w-[76px]' : 'w-[232px]'"
  >
    <router-link to="/" class="flex items-center gap-2.5 pt-5 pb-6" :class="isSlim ? 'justify-center' : 'px-5'" :aria-label="t('sidebar.appName')">
      <BrandMark class="w-8 h-8 flex-shrink-0" />
      <span v-if="!isSlim" class="font-display text-[22px] leading-none">{{ t('sidebar.appName') }}</span>
    </router-link>

    <div class="flex-1 overflow-y-auto px-3 flex flex-col gap-5">
      <div v-for="group in numbered" :key="group.label" class="flex flex-col gap-0.5">
        <span v-if="!isSlim" class="px-3 pb-1.5 font-mono text-[11px] uppercase text-foreground-muted">{{ group.label }}</span>
        <router-link
          v-for="item in group.items"
          :key="item.path"
          :to="item.path"
          :aria-current="isActive(item.path) ? 'page' : undefined"
          :title="isSlim ? item.label : ''"
          class="relative flex items-center gap-2.5 min-h-[40px] rounded-full text-sm transition-colors"
          :class="[
            isSlim ? 'justify-center' : 'px-3',
            isActive(item.path) ? 'bg-hover text-foreground font-semibold' : 'text-foreground-muted hover:text-foreground'
          ]"
        >
          <span class="font-mono text-[11px] w-5 text-center" :class="isActive(item.path) ? 'text-primary-400' : ''">{{ item.num }}</span>
          <span v-if="!isSlim" class="flex-1 truncate">{{ item.label }}</span>
          <svg v-if="item.module && !account.has(item.module)" class="w-3.5 h-3.5 text-foreground-muted" :class="isSlim ? 'absolute top-1 right-1.5' : ''" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" :aria-label="t('account.locked')"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
          <span v-if="item.live" class="w-2 h-2 rounded-full bg-primary-500 animate-pulse" :class="isSlim ? 'absolute top-1.5 right-2' : ''" aria-hidden="true" />
        </router-link>
      </div>
    </div>

    <div class="p-3 flex flex-col gap-2">
      <router-link
        to="/settings"
        :aria-current="isActive('/settings') ? 'page' : undefined"
        class="flex items-center gap-2.5 min-h-[40px] rounded-full text-sm transition-colors"
        :class="[isSlim ? 'justify-center' : 'px-3', isActive('/settings') ? 'bg-hover text-foreground font-semibold' : 'text-foreground-muted hover:text-foreground']"
        :title="isSlim ? t('nav.settings') : ''"
      >
        <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4" /></svg>
        <span v-if="!isSlim">{{ t('nav.settings') }}</span>
      </router-link>

      <button
        v-if="!isSlim"
        type="button"
        @click="authStore.isLoggedIn ? $router.push('/settings') : wizardStore.openDeezer()"
        class="flex flex-col gap-2 p-3.5 rounded-[18px] bg-surface border border-line text-left hover:border-line-strong transition-colors"
      >
        <span v-if="account.state.mode === 'remote' && account.state.user" class="text-xs truncate pb-1 border-b border-line" :title="account.state.user.email">
          {{ account.state.user.email }} · <span class="font-mono uppercase text-[10px]" :class="account.state.offline ? 'text-foreground-muted' : 'text-primary-400'">{{ account.state.offline ? t('account.offline') : account.state.profile?.plan }}</span>
        </span>
        <span class="flex items-center gap-2 font-mono text-[11px] uppercase" :class="authStore.isLoggedIn ? 'text-foreground' : 'text-foreground-muted'">
          <span class="w-2 h-2 rounded-full" :class="authStore.isLoggedIn ? 'bg-primary-500' : 'border border-foreground-muted'" />
          Deezer · {{ authStore.isLoggedIn ? qualityLabel : t('wizard.deezer.connect') }}
        </span>
        <span class="flex items-center gap-2 font-mono text-[11px] uppercase" :class="settingsStore.isQobuzLinked ? 'text-foreground' : 'text-foreground-muted'">
          <span class="w-2 h-2 rounded-full" :class="settingsStore.isQobuzLinked ? 'bg-primary-500' : 'border border-foreground-muted'" />
          Qobuz · {{ settingsStore.isQobuzLinked ? 'HI-RES' : t('wizard.deezer.connect') }}
        </span>
      </button>
    </div>
  </nav>
</template>
