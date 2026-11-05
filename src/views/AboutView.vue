<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BrandMark from '../components/BrandMark.vue'
// Single source of truth: What's New is parsed from CHANGELOG.md at build
// time, so the in-app list and the GitHub release notes can never drift.
import changelogRaw from '../../CHANGELOG.md?raw'

const { t } = useI18n()

// Point these at your own repository before publishing.
const REPO_URL = 'https://github.com/SEU-USUARIO/garimpo'

const appVersion = ref('')
const runtimeInfo = ref<{ electron: string; chromium: string; node: string; v8: string; os: string } | null>(null)

onMounted(async () => {
  if (window.electronAPI) {
    appVersion.value = await window.electronAPI.getVersion()
    runtimeInfo.value = await window.electronAPI.getRuntimeInfo()
  }
})

function openLink(url: string) {
  if (window.electronAPI) {
    window.electronAPI.openExternal(url)
  } else {
    window.open(url, '_blank')
  }
}

// What's New — grouped by version, newest first. Older versions are
// summarized into a single "Earlier releases" entry to keep this page
// scannable. Full history lives in CHANGELOG.md.
interface ReleaseNotes {
  version: string
  date: string
  items: string[]
}

// Derived from CHANGELOG.md. The [Unreleased] section is omitted (users see
// shipped versions only); the "Earlier releases" pointer renders as its own
// entry. Bold/link/code markdown is flattened to plain text for the list.
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim()
}

function parseChangelog(md: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = []
  let cur: ReleaseNotes | null = null
  for (const raw of md.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const vh = line.match(/^## \[([0-9][0-9.]*)\]\s*-\s*(.+)$/)
    if (vh) {
      cur = { version: vh[1], date: vh[2].trim(), items: [] }
      releases.push(cur)
      continue
    }
    if (/^## Earlier releases/i.test(line)) {
      cur = { version: 'earlier', date: '', items: [] }
      releases.push(cur)
      continue
    }
    if (/^## /.test(line)) { cur = null; continue }   // [Unreleased] or other top-level section
    if (/^### /.test(line)) continue                  // category subheading (Added / Fixed / ...)
    if (!cur) continue
    if (/^- /.test(line)) {
      const item = stripMarkdown(line.replace(/^- /, ''))
      if (item) cur.items.push(item)
    } else if (cur.version === 'earlier') {
      const item = stripMarkdown(line)
      if (item) cur.items.push(item)
    }
  }
  return releases
}

const whatsNew: ReleaseNotes[] = parseChangelog(changelogRaw)
</script>

<template>
  <div class="max-w-[640px] mx-auto flex flex-col gap-8 pb-8">
    <!-- Identity -->
    <section class="flex flex-col items-center text-center gap-4 pt-8">
      <BrandMark class="w-20 h-20" />
      <div class="flex flex-col gap-1">
        <h1 class="text-[34px] font-semibold tracking-tight">{{ t('about.appName') }}</h1>
        <p class="text-foreground-muted">{{ t('about.tagline') }}</p>
      </div>
      <span v-if="appVersion" class="font-mono text-xs text-foreground-muted px-2.5 py-1 rounded-full border border-line">v{{ appVersion }}</span>
    </section>

    <!-- Links -->
    <section class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <button
        @click="openLink(REPO_URL)"
        class="flex items-center gap-3 p-4 rounded-card bg-surface border border-line hover:bg-hover transition-colors text-left min-h-[64px]"
      >
        <svg class="w-5 h-5 text-foreground-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5" /></svg>
        <span class="flex flex-col">
          <span class="text-sm font-medium">{{ t('about.githubRepo') }}</span>
          <span class="text-xs text-foreground-muted">{{ t('about.githubRepoDesc') }}</span>
        </span>
      </button>
      <button
        @click="openLink(REPO_URL + '/issues')"
        class="flex items-center gap-3 p-4 rounded-card bg-surface border border-line hover:bg-hover transition-colors text-left min-h-[64px]"
      >
        <svg class="w-5 h-5 text-foreground-muted flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
        <span class="flex flex-col">
          <span class="text-sm font-medium">{{ t('about.reportIssue') }}</span>
          <span class="text-xs text-foreground-muted">{{ t('about.reportIssueDesc') }}</span>
        </span>
      </button>
    </section>

    <!-- What's New -->
    <section v-if="whatsNew.length" class="card flex flex-col gap-4 p-6">
      <h2 class="text-base font-semibold">{{ t('about.whatsNew') }}</h2>
      <div v-for="release in whatsNew" :key="release.version" class="flex flex-col gap-2">
        <div class="flex items-baseline gap-2">
          <h3 class="text-sm font-semibold">{{ release.version === 'earlier' ? t('about.earlierReleases') : `v${release.version}` }}</h3>
          <span class="text-xs text-foreground-muted">{{ release.date }}</span>
        </div>
        <ul class="flex flex-col gap-1.5">
          <li v-for="(item, i) in release.items" :key="i" class="flex items-start gap-2 text-sm text-foreground-muted">
            <span class="mt-2 w-1 h-1 rounded-full bg-primary-500 flex-shrink-0"></span>
            <span>{{ item }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- Credits and license -->
    <section class="card flex flex-col gap-2 p-6 text-sm text-foreground-muted">
      <h2 class="text-base font-semibold text-foreground">{{ t('about.credits') }}</h2>
      <p>{{ t('about.builtBy') }}</p>
      <p>{{ t('about.inspiredBy') }}</p>
      <p>{{ t('about.license') }}</p>
    </section>

    <!-- Runtime -->
    <section v-if="runtimeInfo" class="flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-xs text-foreground-muted">
      <span>Electron {{ runtimeInfo.electron }}</span>
      <span>Chromium {{ runtimeInfo.chromium }}</span>
      <span>Node {{ runtimeInfo.node }}</span>
    </section>

    <p class="text-xs text-foreground-muted text-center leading-relaxed">{{ t('about.disclaimer') }}</p>
  </div>
</template>
