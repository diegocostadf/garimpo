<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAccountStore } from '../stores/accountStore'
import BrandMark from './BrandMark.vue'

// Full-screen sign in, shown before anything else when Garimpo accounts are
// configured. Also explains a blocked, pending or expired account.
const { t } = useI18n()
const account = useAccountStore()

const email = ref('')
const password = ref('')
const show = ref(false)
const view = ref<'login' | 'signup' | 'reset' | 'resetSent'>('login')
const name = ref('')
const confirm = ref('')
const mismatch = computed(() => view.value === 'signup' && confirm.value.length > 0 && confirm.value !== password.value)
const canSignUp = computed(() => /.+@.+\..+/.test(email.value.trim()) && password.value.length >= 6 && confirm.value === password.value && !account.busy)

const blocked = computed(() => account.state.signedIn && account.state.reason)
const canSubmit = computed(() => /.+@.+\..+/.test(email.value.trim()) && password.value.length >= 6 && !account.busy)
const errorText = computed(() => account.error ? t(`account.errors.${account.error}`, t('account.errors.E_UNKNOWN')) : '')

async function submit() {
  if (!canSubmit.value) return
  const ok = await account.signIn(email.value, password.value)
  if (ok) password.value = ''
}
async function submitSignUp() {
  if (!canSignUp.value) return
  const ok = await account.signUp(email.value, password.value, name.value)
  if (ok) { password.value = ''; confirm.value = '' }
}
function go(v: 'login' | 'signup' | 'reset') {
  account.error = null
  view.value = v
}
async function sendReset() {
  if (!/.+@.+\..+/.test(email.value.trim())) return
  if (await account.resetPassword(email.value)) view.value = 'resetSent'
}
</script>

<template>
  <div class="fixed inset-x-0 bottom-0 top-10 z-[100] bg-background-main text-foreground flex">
    <!-- brand side -->
    <section class="hidden lg:flex flex-1 flex-col justify-between p-12 border-r border-line relative overflow-hidden">
      <div class="flex items-center gap-3">
        <BrandMark class="w-10 h-10" />
        <span class="font-display text-[26px] leading-none">{{ t('sidebar.appName') }}</span>
      </div>
      <div class="flex flex-col gap-6 max-w-[520px]">
        <h1 class="font-display !text-[56px] leading-[1]">{{ t('account.heroTitle') }}</h1>
        <p class="text-foreground-muted text-lg leading-relaxed">{{ t('account.heroBody') }}</p>
        <ul class="grid grid-cols-2 gap-2 font-mono text-[11px] uppercase">
          <li v-for="k in ['downloads', 'converter', 'dj', 'qobuz']" :key="k" class="h-10 px-4 rounded-full border border-line-strong flex items-center gap-2">
            <span class="w-1.5 h-1.5 rounded-full bg-primary-500" />{{ t(`account.modules.${k}`) }}
          </li>
        </ul>
      </div>
      <p class="font-mono text-[10px] uppercase text-foreground-muted">{{ t('account.privacy') }}</p>
      <div class="pointer-events-none absolute -right-24 -bottom-24 w-[420px] h-[420px] rounded-full border border-line" aria-hidden="true" />
      <div class="pointer-events-none absolute -right-8 -bottom-8 w-[260px] h-[260px] rounded-full border border-primary-500/40" aria-hidden="true" />
    </section>

    <!-- form side -->
    <section class="w-full lg:w-[520px] flex flex-col justify-center px-10 py-12">
      <div class="lg:hidden flex items-center gap-3 mb-10">
        <BrandMark class="w-9 h-9" />
        <span class="font-display text-[22px] leading-none">{{ t('sidebar.appName') }}</span>
      </div>

      <!-- Signed in but not allowed -->
      <div v-if="blocked" class="flex flex-col gap-5" role="alert">
        <span class="font-mono text-[11px] uppercase text-primary-400">{{ t(`account.reason.${account.state.reason}.label`) }}</span>
        <h2 class="text-3xl font-semibold leading-tight">{{ t(`account.reason.${account.state.reason}.title`) }}</h2>
        <p class="text-foreground-muted leading-relaxed">{{ t(`account.reason.${account.state.reason}.body`) }}</p>
        <p class="font-mono text-xs text-foreground-muted">{{ account.state.user?.email }}</p>
        <div class="flex gap-2">
          <button type="button" @click="account.refresh()" class="h-12 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase">{{ t('account.checkAgain') }}</button>
          <button type="button" @click="account.signOut()" class="h-12 px-6 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover">{{ t('account.signOut') }}</button>
        </div>
      </div>

      <!-- Reset password -->
      <!-- Create account -->
      <form v-else-if="view === 'signup'" class="flex flex-col gap-4" @submit.prevent="submitSignUp" data-testid="signup-form">
        <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.label') }}</span>
        <h2 class="text-3xl font-semibold">{{ t('account.signUpTitle') }}</h2>
        <p class="text-sm text-foreground-muted">{{ t('account.signUpBody') }}</p>
        <label class="flex flex-col gap-2">
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.name') }}</span>
          <input v-model="name" type="text" autocomplete="name" class="h-14 px-6 rounded-full bg-surface border border-line focus:border-foreground outline-none" />
        </label>
        <label class="flex flex-col gap-2">
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.email') }}</span>
          <input v-model="email" type="email" autocomplete="email" required class="h-14 px-6 rounded-full bg-surface border border-line focus:border-foreground outline-none" />
        </label>
        <label class="flex flex-col gap-2">
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.newPassword') }}</span>
          <input v-model="password" type="password" autocomplete="new-password" required minlength="6" class="h-14 px-6 rounded-full bg-surface border border-line focus:border-foreground outline-none" />
        </label>
        <label class="flex flex-col gap-2">
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.confirmPassword') }}</span>
          <input v-model="confirm" type="password" autocomplete="new-password" required class="h-14 px-6 rounded-full bg-surface border outline-none" :class="mismatch ? 'border-primary-500' : 'border-line focus:border-foreground'" />
        </label>
        <p v-if="mismatch" class="text-sm text-primary-400" role="alert">{{ t('account.passwordMismatch') }}</p>
        <p v-else-if="errorText" class="text-sm text-primary-400" role="alert">{{ errorText }}</p>
        <button type="submit" :disabled="!canSignUp" class="h-14 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">
          {{ account.busy ? t('account.creating') : t('account.signUp') }}
        </button>
        <button type="button" @click="go('login')" class="self-start font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground">{{ t('account.haveAccount') }}</button>
      </form>

      <form v-else-if="view !== 'login'" class="flex flex-col gap-5" @submit.prevent="sendReset">
        <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.resetLabel') }}</span>
        <h2 class="text-3xl font-semibold">{{ t('account.resetTitle') }}</h2>
        <template v-if="view === 'reset'">
          <p class="text-foreground-muted">{{ t('account.resetBody') }}</p>
          <label class="flex flex-col gap-2">
            <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.email') }}</span>
            <input v-model="email" type="email" autocomplete="email" required class="h-14 px-6 rounded-full bg-surface border border-line focus:border-foreground outline-none" />
          </label>
          <p v-if="errorText" class="text-sm text-primary-400" role="alert">{{ errorText }}</p>
          <button type="submit" :disabled="account.busy" class="h-14 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">{{ t('account.sendReset') }}</button>
        </template>
        <p v-else class="p-5 rounded-[20px] bg-surface border border-line leading-relaxed">{{ t('account.resetSent', { email }) }}</p>
        <button type="button" @click="go('login')" class="self-start font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground">← {{ t('account.backToLogin') }}</button>
      </form>

      <!-- Sign in -->
      <form v-else class="flex flex-col gap-5" @submit.prevent="submit">
        <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.label') }}</span>
        <h2 class="text-3xl font-semibold">{{ t('account.title') }}</h2>
        <label class="flex flex-col gap-2">
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.email') }}</span>
          <input v-model="email" type="email" autocomplete="username" required class="h-14 px-6 rounded-full bg-surface border border-line focus:border-foreground outline-none" />
        </label>
        <label class="flex flex-col gap-2">
          <span class="font-mono text-[11px] uppercase text-foreground-muted">{{ t('account.password') }}</span>
          <span class="flex items-center h-14 pl-6 pr-2 rounded-full bg-surface border border-line focus-within:border-foreground">
            <input v-model="password" :type="show ? 'text' : 'password'" autocomplete="current-password" required minlength="6" class="flex-1 min-w-0 bg-transparent outline-none" />
            <button type="button" @click="show = !show" class="h-10 px-4 rounded-full font-mono text-[10px] uppercase text-foreground-muted hover:bg-hover">{{ show ? t('account.hide') : t('account.show') }}</button>
          </span>
        </label>
        <p v-if="errorText" class="text-sm text-primary-400" role="alert">{{ errorText }}</p>
        <button type="submit" :disabled="!canSubmit" class="h-14 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase disabled:opacity-40">
          {{ account.busy ? t('account.signingIn') : t('account.signIn') }}
        </button>
        <div class="flex items-center justify-between gap-3">
          <button type="button" @click="go('reset')" class="font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground">{{ t('account.forgot') }}</button>
          <button type="button" @click="go('signup')" class="h-10 px-4 rounded-full border border-line-strong font-mono text-[11px] uppercase hover:bg-hover" data-testid="go-signup">{{ t('account.createAccount') }}</button>
        </div>
      </form>
    </section>
  </div>
</template>
