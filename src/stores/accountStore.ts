import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Garimpo account (access control). The main process owns the session; this
// store mirrors its state for the UI and the router guard.
export type ModuleId = 'downloads' | 'converter' | 'dj' | 'qobuz'

export interface AccountState {
  mode: 'dev' | 'remote'
  signedIn: boolean
  user: { id: string; email: string } | null
  profile: { plan: string; status: 'active' | 'blocked' | 'pending'; modules: string[]; expires_at: string | null; display_name?: string | null } | null
  modules: string[]
  offline: boolean
  reason?: 'blocked' | 'expired' | 'pending' | null
}

const DEV: AccountState = { mode: 'dev', signedIn: false, user: null, profile: null, modules: ['downloads', 'converter', 'dj', 'qobuz'], offline: false, reason: null }

export const useAccountStore = defineStore('account', () => {
  const state = ref<AccountState>(DEV)
  const ready = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)

  const isDev = computed(() => state.value.mode === 'dev')
  // The app is usable when no login is configured, or the user is signed in
  // with an active profile.
  const canUseApp = computed(() => isDev.value || (state.value.signedIn && !state.value.reason))
  const has = (m: ModuleId) => state.value.modules.includes(m)

  function api() { return window.electronAPI?.account }

  async function init() {
    const a = api()
    if (!a) { state.value = DEV; ready.value = true; return }
    try {
      const r = await a.state()
      state.value = r.state
    } catch {
      state.value = DEV
    }
    ready.value = true
  }

  async function signIn(email: string, password: string) {
    const a = api()
    if (!a) return false
    busy.value = true
    error.value = null
    try {
      const r = await a.signIn(email, password)
      state.value = r.state
      if (!r.ok) error.value = r.error || 'E_UNKNOWN'
      return r.ok
    } finally {
      busy.value = false
    }
  }

  async function signUp(email: string, password: string, name: string) {
    const a = api()
    if (!a) return false
    busy.value = true
    error.value = null
    try {
      const r = await a.signUp(email, password, name)
      state.value = r.state
      if (!r.ok) error.value = r.error || 'E_UNKNOWN'
      return r.ok
    } finally {
      busy.value = false
    }
  }

  async function signOut() {
    const a = api()
    if (!a) return
    const r = await a.signOut()
    state.value = r.state
  }

  async function resetPassword(email: string) {
    const a = api()
    if (!a) return false
    busy.value = true
    error.value = null
    try {
      const r = await a.resetPassword(email)
      if (!r.ok) error.value = r.error || 'E_UNKNOWN'
      return r.ok
    } finally {
      busy.value = false
    }
  }

  async function refresh() {
    const a = api()
    if (!a) return
    const r = await a.refresh()
    state.value = r.state
  }

  function logModule(m: ModuleId) { api()?.logModule(m).catch(() => {}) }

  return { state, ready, busy, error, isDev, canUseApp, has, init, signIn, signUp, signOut, resetPassword, refresh, logModule }
})
