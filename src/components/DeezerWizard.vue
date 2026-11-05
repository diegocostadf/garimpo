<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../stores/authStore'

// Step-by-step Deezer connection. The recommended path opens Deezer's own
// login page in a window (main process: deezer:openLoginWindow) and captures
// the session cookie the moment the person signs in, so nobody has to know
// what an ARL is. Pasting an ARL stays as a fallback.
const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { t, locale } = useI18n()
const authStore = useAuthStore()

type Step = 'start' | 'waiting' | 'arl' | 'checking' | 'done'
const step = ref<Step>('start')
const arl = ref('')
const error = ref('')

watch(() => props.show, (open) => {
  if (open) {
    step.value = authStore.isLoggedIn ? 'done' : 'start'
    error.value = ''
    arl.value = ''
  }
})

const stepIndex = computed(() => ({ start: 0, arl: 0, waiting: 1, checking: 1, done: 2 }[step.value]))

const firstName = computed(() => (authStore.user?.name || '').split(' ')[0] || '')
const planLabel = computed(() => authStore.user?.subscription?.type || t('sidebar.free'))
const qualityLabel = computed(() => (authStore.isPremium ? 'FLAC' : 'MP3 128'))
const regionLabel = computed(() => {
  const code = authStore.user?.country
  if (!code) return '—'
  try {
    return new Intl.DisplayNames([locale.value], { type: 'region' }).of(code.toUpperCase()) || code
  } catch {
    return code
  }
})

async function finishWithArl(value: string) {
  step.value = 'checking'
  const ok = await authStore.login(value)
  if (ok) {
    step.value = 'done'
  } else {
    error.value = authStore.error || t('login.failed')
    step.value = 'start'
  }
}

async function startBrowserLogin() {
  error.value = ''
  if (!window.electronAPI?.deezerLogin) {
    error.value = t('login.browserLoginUnavailable')
    return
  }
  step.value = 'waiting'
  try {
    const result = await window.electronAPI.deezerLogin.openLoginWindow()
    if (result.success && result.arl) {
      await finishWithArl(result.arl)
    } else if (step.value === 'waiting') {
      error.value = result.error === 'Login window closed' ? t('wizard.deezer.windowClosed') : (result.error || t('login.browserLoginFailed'))
      step.value = 'start'
    }
  } catch (e: any) {
    error.value = e?.message || t('login.browserLoginFailed')
    step.value = 'start'
  }
}

async function reopenWindow() {
  await window.electronAPI?.deezerLogin?.closeLoginWindow()
  startBrowserLogin()
}

async function submitArl() {
  const value = arl.value.trim()
  if (value.length < 100) {
    error.value = t('login.invalidArl')
    return
  }
  error.value = ''
  await finishWithArl(value)
}

function back() {
  window.electronAPI?.deezerLogin?.closeLoginWindow()
  error.value = ''
  step.value = 'start'
}

function close() {
  if (step.value === 'waiting') window.electronAPI?.deezerLogin?.closeLoginWindow()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="wizard">
      <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="close" />
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="deezer-wizard-title"
          class="relative w-full max-w-[560px] bg-surface border border-line rounded-3xl shadow-2xl p-8 flex flex-col gap-6"
        >
          <div class="flex items-center justify-between">
            <ol class="flex gap-1.5" :aria-label="t('wizard.stepOf', { n: stepIndex + 1, total: 3 })">
              <li
                v-for="i in 3"
                :key="i"
                class="h-2 rounded-full transition-all duration-300"
                :class="[i - 1 === stepIndex ? 'w-6' : 'w-2', i - 1 <= stepIndex ? 'bg-primary-500' : 'bg-line']"
              />
            </ol>
            <button type="button" @click="close" :aria-label="t('wizard.close')" class="w-10 h-10 rounded-[10px] flex items-center justify-center text-foreground-muted hover:bg-hover">
              <svg class="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>

          <!-- 1. Start -->
          <div v-if="step === 'start'" class="flex flex-col gap-5">
            <span class="w-14 h-14 rounded-2xl bg-foreground text-background-main flex items-center justify-center text-[22px] font-bold" aria-hidden="true">D</span>
            <div class="flex flex-col gap-2">
              <h1 id="deezer-wizard-title" class="text-[28px] font-semibold tracking-tight">{{ t('wizard.deezer.title') }}</h1>
              <p class="text-base leading-relaxed text-foreground-muted">{{ t('wizard.deezer.intro') }}</p>
            </div>
            <ul class="flex flex-col gap-2.5">
              <li v-for="k in ['promise1', 'promise2', 'promise3']" :key="k" class="flex gap-2.5 text-sm text-foreground-muted">
                <svg class="w-[18px] h-[18px] flex-none mt-px text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
                {{ t('wizard.deezer.' + k) }}
              </li>
            </ul>
            <p v-if="error" role="alert" class="text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3">{{ error }}</p>
            <button type="button" @click="startBrowserLogin" class="h-[52px] rounded-2xl bg-primary-500 text-white text-base font-semibold hover:bg-primary-600 transition-colors">{{ t('wizard.deezer.start') }}</button>
            <button type="button" @click="step = 'arl'; error = ''" class="min-h-[44px] text-sm text-foreground-muted underline hover:text-foreground">{{ t('wizard.deezer.haveArl') }}</button>
          </div>

          <!-- 2. Waiting for the Deezer window -->
          <div v-else-if="step === 'waiting' || step === 'checking'" class="flex flex-col gap-5">
            <span class="w-12 h-12 rounded-full border-4 border-line border-t-primary-500 animate-spin" aria-hidden="true" />
            <div class="flex flex-col gap-2">
              <h1 id="deezer-wizard-title" class="text-[26px] font-semibold tracking-tight">{{ step === 'checking' ? t('wizard.deezer.checking') : t('wizard.deezer.waitingTitle') }}</h1>
              <p v-if="step === 'waiting'" class="text-base leading-relaxed text-foreground-muted">{{ t('wizard.deezer.waitingText') }}</p>
            </div>
            <ol v-if="step === 'waiting'" class="flex flex-col gap-3">
              <li v-for="(k, i) in ['tip1', 'tip2', 'tip3']" :key="k" class="flex gap-3 items-start text-sm leading-relaxed text-foreground-muted">
                <span class="w-6 h-6 flex-none rounded-full bg-primary-500/15 text-primary-600 text-[13px] font-semibold flex items-center justify-center">{{ i + 1 }}</span>
                {{ t('wizard.deezer.' + k) }}
              </li>
            </ol>
            <div v-if="step === 'waiting'" class="flex flex-wrap gap-2">
              <button type="button" @click="reopenWindow" class="flex-1 h-12 rounded-xl border border-line bg-surface hover:bg-hover text-[15px]">{{ t('wizard.deezer.reopen') }}</button>
              <button type="button" @click="back" class="flex-1 h-12 rounded-xl text-[15px] text-foreground-muted hover:bg-hover">{{ t('wizard.back') }}</button>
            </div>
          </div>

          <!-- Fallback: paste ARL -->
          <form v-else-if="step === 'arl'" class="flex flex-col gap-4" @submit.prevent="submitArl">
            <div class="flex flex-col gap-2">
              <h1 id="deezer-wizard-title" class="text-[26px] font-semibold tracking-tight">{{ t('wizard.deezer.arlTitle') }}</h1>
              <p class="text-[15px] leading-relaxed text-foreground-muted">{{ t('wizard.deezer.arlText') }}</p>
            </div>
            <label class="flex flex-col gap-1.5 text-sm font-medium">
              {{ t('wizard.deezer.arlLabel') }}
              <input
                v-model="arl"
                type="password"
                autocomplete="off"
                :placeholder="t('wizard.deezer.arlPlaceholder')"
                class="h-12 px-3.5 rounded-xl border border-line-strong bg-background-secondary font-mono text-sm font-normal outline-none focus:border-primary-500"
              />
            </label>
            <p class="text-[13px] leading-relaxed text-foreground-muted">{{ t('wizard.deezer.arlSafe') }}</p>
            <p v-if="error" role="alert" class="text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3">{{ error }}</p>
            <button type="submit" class="h-[52px] rounded-2xl bg-primary-500 text-white text-base font-semibold hover:bg-primary-600 transition-colors">{{ t('wizard.deezer.connect') }}</button>
            <button type="button" @click="back" class="min-h-[44px] text-sm text-foreground-muted hover:text-foreground">{{ t('wizard.back') }}</button>
          </form>

          <!-- 3. Done -->
          <div v-else class="flex flex-col gap-5">
            <span class="w-14 h-14 rounded-full bg-primary-500/15 flex items-center justify-center" aria-hidden="true">
              <svg class="w-7 h-7 text-primary-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10" /></svg>
            </span>
            <div class="flex flex-col gap-2">
              <h1 id="deezer-wizard-title" class="text-[28px] font-semibold tracking-tight">{{ t('wizard.deezer.doneTitle', { name: firstName }) }}</h1>
              <p class="text-base leading-relaxed text-foreground-muted">{{ t('wizard.deezer.doneText') }}</p>
            </div>
            <div class="grid grid-cols-3 gap-2.5">
              <div class="flex flex-col gap-1 p-3.5 rounded-2xl bg-background-main">
                <span class="text-xs text-foreground-muted">{{ t('wizard.deezer.plan') }}</span>
                <span class="text-[15px] font-semibold truncate">{{ planLabel }}</span>
              </div>
              <div class="flex flex-col gap-1 p-3.5 rounded-2xl bg-background-main">
                <span class="text-xs text-foreground-muted">{{ t('wizard.deezer.maxQuality') }}</span>
                <span class="text-[15px] font-semibold">{{ qualityLabel }}</span>
              </div>
              <div class="flex flex-col gap-1 p-3.5 rounded-2xl bg-background-main">
                <span class="text-xs text-foreground-muted">{{ t('wizard.deezer.region') }}</span>
                <span class="text-[15px] font-semibold truncate">{{ regionLabel }}</span>
              </div>
            </div>
            <button type="button" @click="emit('close')" class="h-[52px] rounded-2xl bg-primary-500 text-white text-base font-semibold hover:bg-primary-600 transition-colors">{{ t('wizard.deezer.finish') }}</button>
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
