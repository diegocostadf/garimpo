import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useAccountStore } from './accountStore'
import { useAuthStore } from './authStore'
import { useSettingsStore } from './settingsStore'

// First-run wizard after the Garimpo sign in: Deezer (required), then Qobuz
// and Spotify (both can be skipped). The optional steps are shown once per
// Garimpo user on this computer; Deezer is required every time it is missing.
export type OnboardingStep = 'deezer' | 'qobuz' | 'spotify' | 'done'

const KEY = 'garimpo-onboarding-done:'

function readDone(userId: string): boolean {
  try {
    return localStorage.getItem(KEY + userId) === '1'
  } catch {
    return false
  }
}

export const useOnboardingStore = defineStore('onboarding', () => {
  const account = useAccountStore()
  const auth = useAuthStore()
  const settings = useSettingsStore()

  /** App.vue flips this once every store has loaded, so the wizard never flashes during startup. */
  const appReady = ref(false)
  const finished = ref(false)
  const step = ref<OnboardingStep>('deezer')

  const userId = computed(() => account.state.user?.id || '')
  const deezerOk = computed(() => auth.isLoggedIn || (!!settings.settings.arl && !auth.authExpired))
  const qobuzOk = computed(() => settings.isQobuzConnected)
  const spotifyOk = computed(() => !!settings.settings.spotifyClientId)

  watch(userId, (id) => { finished.value = id ? readDone(id) : false }, { immediate: true })

  const visible = computed(() =>
    appReady.value &&
    account.state.mode === 'remote' &&
    account.canUseApp &&
    (!deezerOk.value || !finished.value)
  )

  // Where to start: Deezer when it is missing, otherwise the first optional step.
  watch(visible, (v) => {
    if (v) step.value = !deezerOk.value ? 'deezer' : 'qobuz'
  }, { immediate: true })

  function next() {
    if (step.value === 'deezer') {
      if (!deezerOk.value) return
      // Deezer came back after the wizard was already finished: nothing else to ask.
      if (finished.value) return
      step.value = 'qobuz'
    } else if (step.value === 'qobuz') step.value = 'spotify'
    else if (step.value === 'spotify') step.value = 'done'
  }

  function finish() {
    if (!deezerOk.value) { step.value = 'deezer'; return }
    finished.value = true
    try {
      if (userId.value) localStorage.setItem(KEY + userId.value, '1')
    } catch {
      // then it is asked again next launch
    }
  }

  return { appReady, step, visible, finished, deezerOk, qobuzOk, spotifyOk, next, finish }
})
