<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../stores/settingsStore'

// Step-by-step Spotify connection. Like the Qobuz and Deezer logins, the
// recommended path happens in a window of the service's own site: the main
// process opens the Spotify developer dashboard with the "create app" form
// prefilled and reads the Client ID and Secret off the page once the person
// reveals them. The person signs in, accepts Spotify's terms and clicks Save
// themselves. Pasting both keys stays available.
const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t } = useI18n()
const settingsStore = useSettingsStore()

type Step = 'intro' | 'create' | 'capture' | 'paste' | 'testing' | 'done'
const step = ref<Step>('intro')
const clientId = ref('')
const clientSecret = ref('')
const gotId = ref(false)
const gotSecret = ref(false)
const error = ref('')
let stopProgress: (() => void) | null = null

watch(() => props.show, (open) => {
  if (open) {
    step.value = settingsStore.settings.spotifyClientId ? 'done' : 'intro'
    error.value = ''
    clientId.value = ''
    clientSecret.value = ''
    gotId.value = false
    gotSecret.value = false
  }
})

const stepIndex = computed(() => ({ intro: 0, create: 1, paste: 1, capture: 2, testing: 2, done: 3 }[step.value]))

async function testAndSave(id: string, secret: string) {
  step.value = 'testing'
  error.value = ''
  try {
    const port = window.electronAPI ? await window.electronAPI.getServerPort() : 6595
    const response = await fetch(`http://127.0.0.1:${port}/api/spotify/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: id, clientSecret: secret })
    })
    const data = await response.json()
    if (response.ok && data.success) {
      await settingsStore.setSpotifyCredentials(id, secret, settingsStore.settings.spotifyUsername || '')
      step.value = 'done'
    } else {
      error.value = data.error || t('settings.spotify.connectionFailed')
      clientId.value = id
      clientSecret.value = secret
      step.value = 'paste'
    }
  } catch (e: any) {
    error.value = e?.message || t('settings.spotify.connectionFailed')
    step.value = 'paste'
  }
}

async function openDashboard() {
  error.value = ''
  const bridge = window.electronAPI?.spotifyDeveloper
  if (!bridge) {
    step.value = 'paste'
    return
  }
  gotId.value = false
  gotSecret.value = false
  step.value = 'capture'
  stopProgress?.()
  stopProgress = bridge.onProgress((p) => {
    gotId.value = p.clientId
    gotSecret.value = p.clientSecret
  })
  const result = await bridge.openWindow()
  stopProgress?.()
  stopProgress = null
  if (result.success && result.clientId && result.clientSecret) {
    await testAndSave(result.clientId, result.clientSecret)
  } else if (step.value === 'capture') {
    error.value = t('wizard.spotify.windowClosed')
    step.value = 'create'
  }
}

function submitPaste() {
  const id = clientId.value.trim()
  const secret = clientSecret.value.trim()
  if (!id || !secret) {
    error.value = t('settings.spotify.credentialsRequired')
    return
  }
  testAndSave(id, secret)
}

function switchToPaste() {
  window.electronAPI?.spotifyDeveloper?.closeWindow()
  error.value = ''
  step.value = 'paste'
}

function close() {
  window.electronAPI?.spotifyDeveloper?.closeWindow()
  stopProgress?.()
  stopProgress = null
  emit('close')
}

onBeforeUnmount(() => stopProgress?.())
</script>

<template>
  <Teleport to="body">
    <Transition name="wizard">
      <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="close" />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="spotify-wizard-title"
          class="relative w-full max-w-[600px] bg-surface border border-line rounded-3xl shadow-2xl p-8 flex flex-col gap-6"
        >
          <div class="flex items-center justify-between">
            <ol class="flex gap-1.5" :aria-label="t('wizard.stepOf', { n: stepIndex + 1, total: 4 })">
              <li
                v-for="i in 4"
                :key="i"
                class="h-2 rounded-full transition-all duration-300"
                :class="[i - 1 === stepIndex ? 'w-6' : 'w-2', i - 1 <= stepIndex ? 'bg-primary-500' : 'bg-line']"
              />
            </ol>
            <button type="button" @click="close" :aria-label="t('wizard.close')" class="w-10 h-10 rounded-[10px] flex items-center justify-center text-foreground-muted hover:bg-hover">
              <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <!-- 1. Why and what it needs -->
          <div v-if="step === 'intro'" class="flex flex-col gap-5">
            <span class="w-14 h-14 rounded-2xl bg-[#1DB954] text-[#0B1F12] flex items-center justify-center text-[22px] font-bold" aria-hidden="true">S</span>
            <div class="flex flex-col gap-2">
              <h1 id="spotify-wizard-title" class="text-[28px] font-semibold tracking-tight">{{ t('wizard.spotify.title') }}</h1>
              <p class="text-base leading-relaxed text-foreground-muted">{{ t('wizard.spotify.intro') }}</p>
            </div>
            <p class="flex gap-3 p-4 rounded-2xl bg-primary-500/10 text-sm leading-relaxed">
              <svg class="w-5 h-5 flex-none mt-px text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
              {{ t('wizard.spotify.requirement') }}
            </p>
            <button type="button" @click="step = 'create'" class="h-[52px] rounded-2xl bg-primary-500 text-white text-base font-semibold hover:bg-primary-600 transition-colors">{{ t('wizard.spotify.start') }}</button>
          </div>

          <!-- 2. Create the developer app -->
          <div v-else-if="step === 'create'" class="flex flex-col gap-5">
            <div class="flex flex-col gap-2">
              <h1 id="spotify-wizard-title" class="text-[26px] font-semibold tracking-tight">{{ t('wizard.spotify.createTitle') }}</h1>
              <p class="text-base leading-relaxed text-foreground-muted">{{ t('wizard.spotify.createText') }}</p>
            </div>
            <ol class="flex flex-col gap-3">
              <li v-for="(k, i) in ['create1', 'create2', 'create3']" :key="k" class="flex gap-3 items-start text-sm leading-relaxed text-foreground-muted">
                <span class="w-6 h-6 flex-none rounded-full bg-primary-500/15 text-primary-600 text-[13px] font-semibold flex items-center justify-center">{{ i + 1 }}</span>
                {{ t('wizard.spotify.' + k) }}
              </li>
            </ol>
            <p v-if="error" role="alert" class="text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3">{{ error }}</p>
            <button type="button" @click="openDashboard" class="h-[52px] rounded-2xl bg-primary-500 text-white text-base font-semibold hover:bg-primary-600 transition-colors">{{ t('wizard.spotify.openDashboard') }}</button>
            <button type="button" @click="step = 'paste'; error = ''" class="min-h-[44px] text-sm text-foreground-muted underline hover:text-foreground">{{ t('wizard.spotify.haveKeys') }}</button>
          </div>

          <!-- 3. Waiting for the keys / testing -->
          <div v-else-if="step === 'capture' || step === 'testing'" class="flex flex-col gap-5">
            <span class="w-12 h-12 rounded-full border-4 border-line border-t-[#1DB954] animate-spin" aria-hidden="true" />
            <div class="flex flex-col gap-2">
              <h1 id="spotify-wizard-title" class="text-[26px] font-semibold tracking-tight">{{ step === 'testing' ? t('wizard.spotify.testing') : t('wizard.spotify.captureTitle') }}</h1>
              <p v-if="step === 'capture'" class="text-base leading-relaxed text-foreground-muted">{{ t('wizard.spotify.captureText') }}</p>
            </div>
            <ul v-if="step === 'capture'" class="flex flex-col gap-2.5">
              <li v-for="item in [{ ok: gotId, label: 'gotId' }, { ok: gotSecret, label: 'gotSecret' }]" :key="item.label" class="flex items-center gap-2.5 text-sm" :class="item.ok ? 'text-foreground' : 'text-foreground-muted'">
                <span class="w-5 h-5 rounded-full flex items-center justify-center" :class="item.ok ? 'bg-[#1DB954]' : 'bg-line-strong'">
                  <svg class="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="item.ok ? 'm5 12 5 5 9-10' : 'M8 12h8'" /></svg>
                </span>
                {{ item.ok ? t('wizard.spotify.' + item.label) : t('wizard.spotify.waiting') }}
              </li>
            </ul>
            <button v-if="step === 'capture'" type="button" @click="switchToPaste" class="min-h-[44px] text-sm text-foreground-muted underline hover:text-foreground">{{ t('wizard.spotify.haveKeys') }}</button>
          </div>

          <!-- Fallback: paste the keys -->
          <form v-else-if="step === 'paste'" class="flex flex-col gap-4" @submit.prevent="submitPaste">
            <h1 id="spotify-wizard-title" class="text-[26px] font-semibold tracking-tight">{{ t('wizard.spotify.pasteTitle') }}</h1>
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('settings.spotify.clientId') }}
              <input v-model="clientId" type="text" autocomplete="off" :placeholder="t('wizard.spotify.keyHint')" class="h-12 px-3.5 rounded-xl border border-line-strong bg-background-secondary font-mono text-sm font-normal outline-none focus:border-primary-500" />
            </label>
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('settings.spotify.clientSecret') }}
              <input v-model="clientSecret" type="password" autocomplete="off" :placeholder="t('wizard.spotify.keyHint')" class="h-12 px-3.5 rounded-xl border border-line-strong bg-background-secondary font-mono text-sm font-normal outline-none focus:border-primary-500" />
            </label>
            <p v-if="error" role="alert" class="text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3">{{ error }}</p>
            <button type="submit" class="h-[52px] rounded-2xl bg-primary-500 text-white text-base font-semibold hover:bg-primary-600 transition-colors">{{ t('wizard.spotify.testConnect') }}</button>
            <button type="button" @click="step = 'create'; error = ''" class="min-h-[44px] text-sm text-foreground-muted hover:text-foreground">{{ t('wizard.back') }}</button>
          </form>

          <!-- 4. Done -->
          <div v-else class="flex flex-col gap-5">
            <span class="w-14 h-14 rounded-full bg-primary-500/15 flex items-center justify-center" aria-hidden="true">
              <svg class="w-7 h-7 text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10" /></svg>
            </span>
            <div class="flex flex-col gap-2">
              <h1 id="spotify-wizard-title" class="text-[28px] font-semibold tracking-tight">{{ t('wizard.spotify.doneTitle') }}</h1>
              <p class="text-base leading-relaxed text-foreground-muted">{{ t('wizard.spotify.doneText') }}</p>
            </div>
            <button type="button" @click="emit('close')" class="h-[52px] rounded-2xl bg-primary-500 text-white text-base font-semibold hover:bg-primary-600 transition-colors">{{ t('wizard.spotify.finish') }}</button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.wizard-enter-active, .wizard-leave-active { transition: opacity 0.18s ease; }
.wizard-enter-from, .wizard-leave-to { opacity: 0; }
</style>
