<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useOnboardingStore, type OnboardingStep } from '../stores/onboardingStore'
import { useAccountStore } from '../stores/accountStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useWizardStore } from '../stores/wizardStore'
import { qualityLabel as labelOf } from '../composables/useQuality'
import BrandMark from './BrandMark.vue'

// First-run wizard, right after the Garimpo sign in: Deezer (required),
// Qobuz and Spotify (optional), then the app opens. Each service connects
// through its existing assistant or login window.
const { t } = useI18n()
const onboarding = useOnboardingStore()
const account = useAccountStore()
const auth = useAuthStore()
const settings = useSettingsStore()
const wizard = useWizardStore()

const qobuzBusy = ref(false)
const qobuzError = ref('')

const steps = computed(() => [
  { id: 'garimpo', n: '01', label: t('onboarding.steps.garimpo'), tag: account.state.user?.email || '', ok: true },
  { id: 'deezer', n: '02', label: t('onboarding.steps.deezer'), tag: t('onboarding.required'), ok: onboarding.deezerOk },
  { id: 'qobuz', n: '03', label: t('onboarding.steps.qobuz'), tag: t('onboarding.optional'), ok: onboarding.qobuzOk },
  { id: 'spotify', n: '04', label: t('onboarding.steps.spotify'), tag: t('onboarding.optional'), ok: onboarding.spotifyOk }
])
const order: OnboardingStep[] = ['deezer', 'qobuz', 'spotify', 'done']
const current = computed(() => order.indexOf(onboarding.step) + 1)

const deezerPlan = computed(() => auth.user?.subscription?.type || t('sidebar.free'))
const deezerQuality = computed(() => labelOf(auth.maxQuality || '128'))

async function connectQobuz() {
  qobuzBusy.value = true
  qobuzError.value = ''
  try {
    const r = await settings.connectQobuz()
    if (!r.success) qobuzError.value = r.error || t('onboarding.qobuz.failed')
  } finally {
    qobuzBusy.value = false
  }
}
</script>

<template>
  <div class="fixed inset-x-0 bottom-0 top-10 z-[45] bg-background-main text-foreground flex" data-testid="onboarding">
    <!-- steps rail -->
    <aside class="hidden md:flex w-[340px] flex-none flex-col justify-between p-10 border-r border-line">
      <div class="flex flex-col gap-10">
        <div class="flex items-center gap-3">
          <BrandMark class="w-9 h-9" />
          <span class="font-display text-[22px] leading-none">{{ t('sidebar.appName') }}</span>
        </div>
        <ol class="flex flex-col gap-2" :aria-label="t('wizard.stepOf', { n: current, total: 4 })">
          <li
            v-for="s in steps"
            :key="s.id"
            class="flex items-center gap-4 p-4 rounded-[20px] border"
            :class="onboarding.step === s.id ? 'border-foreground bg-surface' : 'border-line'"
            :aria-current="onboarding.step === s.id ? 'step' : undefined"
          >
            <span
              class="w-9 h-9 flex-none rounded-full flex items-center justify-center font-mono text-[11px]"
              :class="s.ok ? 'bg-primary-500 text-white' : 'border border-line-strong text-foreground-muted'"
            >
              <svg v-if="s.ok" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
              <template v-else>{{ s.n }}</template>
            </span>
            <span class="flex flex-col min-w-0">
              <span class="font-semibold">{{ s.label }}</span>
              <span class="font-mono text-[10px] uppercase text-foreground-muted truncate">{{ s.tag }}</span>
            </span>
          </li>
        </ol>
      </div>
      <button type="button" class="self-start font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground" @click="account.signOut()">{{ t('onboarding.switchAccount') }}</button>
    </aside>

    <!-- step content -->
    <section class="flex-1 flex items-center justify-center p-10 overflow-y-auto">
      <div class="w-full max-w-[520px] flex flex-col gap-6">
        <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('onboarding.progress', { n: Math.min(current, 3), total: 3 }) }}</span>

        <!-- Deezer (required) -->
        <template v-if="onboarding.step === 'deezer'">
          <span class="w-14 h-14 rounded-2xl bg-foreground text-background-main flex items-center justify-center text-[22px] font-bold" aria-hidden="true">D</span>
          <div class="flex flex-col gap-2">
            <h1 class="text-[32px] font-semibold tracking-tight">{{ onboarding.deezerOk ? t('onboarding.deezer.doneTitle') : t('onboarding.deezer.title') }}</h1>
            <p class="text-base leading-relaxed text-foreground-muted">
              {{ onboarding.deezerOk ? t('onboarding.deezer.doneBody') : auth.authExpired ? t('onboarding.deezer.expired') : t('onboarding.deezer.body') }}
            </p>
          </div>
          <div v-if="onboarding.deezerOk && auth.user" class="grid grid-cols-2 gap-2.5">
            <div class="flex flex-col gap-1 p-4 rounded-2xl bg-surface border border-line">
              <span class="text-xs text-foreground-muted">{{ t('wizard.deezer.plan') }}</span>
              <span class="font-semibold truncate">{{ deezerPlan }}</span>
            </div>
            <div class="flex flex-col gap-1 p-4 rounded-2xl bg-surface border border-line">
              <span class="text-xs text-foreground-muted">{{ t('wizard.deezer.maxQuality') }}</span>
              <span class="font-semibold">{{ deezerQuality }}</span>
            </div>
          </div>
          <p v-if="!onboarding.deezerOk" class="text-sm text-foreground-muted p-4 rounded-2xl border border-line">{{ t('onboarding.deezer.why') }}</p>
          <button v-if="!onboarding.deezerOk" type="button" data-testid="onboarding-deezer" @click="wizard.openDeezer()" class="h-14 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600">{{ t('wizard.deezer.start') }}</button>
          <button v-else type="button" data-testid="onboarding-next" @click="onboarding.next()" class="h-14 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600">{{ t('onboarding.continue') }}</button>
        </template>

        <!-- Qobuz (optional) -->
        <template v-else-if="onboarding.step === 'qobuz'">
          <span class="w-14 h-14 rounded-2xl bg-foreground text-background-main flex items-center justify-center text-[22px] font-bold" aria-hidden="true">Q</span>
          <div class="flex flex-col gap-2">
            <h1 class="text-[32px] font-semibold tracking-tight">{{ onboarding.qobuzOk ? t('onboarding.qobuz.doneTitle') : t('onboarding.qobuz.title') }}</h1>
            <p class="text-base leading-relaxed text-foreground-muted">{{ onboarding.qobuzOk ? t('onboarding.qobuz.doneBody') : t('onboarding.qobuz.body') }}</p>
          </div>
          <p v-if="qobuzError" role="alert" class="text-sm text-primary-400 bg-primary-500/10 rounded-xl px-4 py-3">{{ qobuzError }}</p>
          <template v-if="!onboarding.qobuzOk">
            <button type="button" data-testid="onboarding-qobuz" :disabled="qobuzBusy" @click="connectQobuz" class="h-14 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600 disabled:opacity-50">{{ qobuzBusy ? t('onboarding.qobuz.waiting') : t('onboarding.qobuz.connect') }}</button>
            <button type="button" data-testid="onboarding-skip" @click="onboarding.next()" class="h-12 flex items-center justify-center rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('onboarding.skip') }}</button>
          </template>
          <button v-else type="button" data-testid="onboarding-next" @click="onboarding.next()" class="h-14 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600">{{ t('onboarding.continue') }}</button>
        </template>

        <!-- Spotify (optional) -->
        <template v-else-if="onboarding.step === 'spotify'">
          <span class="w-14 h-14 rounded-2xl bg-foreground text-background-main flex items-center justify-center text-[22px] font-bold" aria-hidden="true">S</span>
          <div class="flex flex-col gap-2">
            <h1 class="text-[32px] font-semibold tracking-tight">{{ onboarding.spotifyOk ? t('onboarding.spotify.doneTitle') : t('onboarding.spotify.title') }}</h1>
            <p class="text-base leading-relaxed text-foreground-muted">{{ onboarding.spotifyOk ? t('onboarding.spotify.doneBody') : t('onboarding.spotify.body') }}</p>
          </div>
          <template v-if="!onboarding.spotifyOk">
            <button type="button" data-testid="onboarding-spotify" @click="wizard.openSpotify()" class="h-14 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600">{{ t('onboarding.spotify.connect') }}</button>
            <button type="button" data-testid="onboarding-skip" @click="onboarding.next()" class="h-12 flex items-center justify-center rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('onboarding.skip') }}</button>
          </template>
          <button v-else type="button" data-testid="onboarding-next" @click="onboarding.next()" class="h-14 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600">{{ t('onboarding.continue') }}</button>
        </template>

        <!-- Done -->
        <template v-else>
          <span class="w-14 h-14 rounded-full bg-primary-500/15 flex items-center justify-center" aria-hidden="true">
            <svg class="w-7 h-7 text-primary-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10" /></svg>
          </span>
          <div class="flex flex-col gap-2">
            <h1 class="text-[32px] font-semibold tracking-tight">{{ t('onboarding.done.title') }}</h1>
            <p class="text-base leading-relaxed text-foreground-muted">{{ t('onboarding.done.body') }}</p>
          </div>
          <ul class="flex flex-col gap-2">
            <li v-for="s in steps.slice(1)" :key="s.id" class="flex items-center justify-between h-12 px-5 rounded-full border border-line">
              <span>{{ s.label }}</span>
              <span class="font-mono text-[11px] uppercase" :class="s.ok ? 'text-primary-400' : 'text-foreground-muted'">{{ s.ok ? t('onboarding.connected') : t('onboarding.later') }}</span>
            </li>
          </ul>
          <button type="button" data-testid="onboarding-finish" @click="onboarding.finish()" class="h-14 flex items-center justify-center rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600">{{ t('onboarding.done.start') }}</button>
        </template>
      </div>
    </section>
  </div>
</template>
