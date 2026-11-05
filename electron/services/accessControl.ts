import * as fs from 'fs'
import { join } from 'path'
import * as os from 'os'
import { app, safeStorage } from 'electron'

// Access control for Garimpo accounts (email + password), backed by Supabase
// (GoTrue for auth, PostgREST for profile/entitlements and the access log).
//
// - The project URL and the public anon key are baked in at build time
//   (GARIMPO_SUPABASE_URL / GARIMPO_SUPABASE_ANON_KEY) or read from the
//   environment. With neither, Garimpo runs in development mode: no login,
//   every module unlocked, and the UI says so.
// - The session (refresh token) is stored encrypted with the OS keychain via
//   safeStorage. Nothing is sent anywhere except the configured project.
// - Entitlements come from public.profiles (status, plan, modules, expires_at)
//   so modules can be sold separately later. A cached copy allows a short
//   offline grace period.

declare const __GARIMPO_SUPABASE_URL__: string | undefined
declare const __GARIMPO_SUPABASE_ANON_KEY__: string | undefined

export const ALL_MODULES = ['downloads', 'converter', 'dj', 'qobuz'] as const
export type ModuleId = typeof ALL_MODULES[number]

export interface AccessUser { id: string; email: string }
export interface AccessProfile {
  plan: string
  status: 'active' | 'blocked' | 'pending'
  modules: string[]
  expires_at: string | null
  display_name?: string | null
}
export interface AccessState {
  mode: 'dev' | 'remote'
  signedIn: boolean
  user: AccessUser | null
  profile: AccessProfile | null
  modules: string[]
  offline: boolean
  reason?: 'blocked' | 'expired' | 'pending' | null
}

interface StoredSession {
  access_token: string
  refresh_token: string
  expires_at: number // epoch seconds
  user: AccessUser
  profile: AccessProfile | null
  verified_at: number // epoch ms of the last successful server check
}

const OFFLINE_GRACE_MS = 7 * 24 * 3600 * 1000

export class AuthError extends Error {
  constructor(public code: 'E_CREDENTIALS' | 'E_NETWORK' | 'E_BLOCKED' | 'E_EXPIRED' | 'E_PENDING' | 'E_CONFIG' | 'E_RATE' | 'E_EXISTS' | 'E_WEAK' | 'E_CONFIRM' | 'E_UNKNOWN') {
    super(code)
  }
}

function config(): { url: string; key: string } {
  const url = (process.env.GARIMPO_SUPABASE_URL || (typeof __GARIMPO_SUPABASE_URL__ !== 'undefined' ? __GARIMPO_SUPABASE_URL__ : '') || '').replace(/\/+$/, '')
  const key = process.env.GARIMPO_SUPABASE_ANON_KEY || (typeof __GARIMPO_SUPABASE_ANON_KEY__ !== 'undefined' ? __GARIMPO_SUPABASE_ANON_KEY__ : '') || ''
  return { url, key }
}

export class AccessControl {
  private session: StoredSession | null = null
  private loaded = false
  private offline = false

  constructor(private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  get enabled(): boolean {
    const c = config()
    return !!(c.url && c.key && /^https:\/\//.test(c.url))
  }

  private file() { return join(app.getPath('userData'), 'garimpo-session.bin') }

  private readStored(): StoredSession | null {
    try {
      const raw = fs.readFileSync(this.file())
      const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8')
      return JSON.parse(json)
    } catch {
      return null
    }
  }

  private writeStored(s: StoredSession | null) {
    try {
      if (!s) { fs.rmSync(this.file(), { force: true }); return }
      const json = JSON.stringify(s)
      const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8')
      fs.writeFileSync(this.file(), data, { mode: 0o600 })
    } catch (e) {
      console.error('[Access] could not persist session', e)
    }
  }

  private async call(path: string, init: { method?: string; body?: unknown; token?: string; prefer?: string } = {}): Promise<any> {
    const { url, key } = config()
    let res: Response
    try {
      res = await this.fetchImpl(url + path, {
        method: init.method || 'GET',
        headers: {
          apikey: key,
          // New Supabase publishable keys (sb_publishable_…) are not JWTs: send them only as
          // apikey; Authorization carries the user's access token when there is one.
          ...(init.token ? { Authorization: `Bearer ${init.token}` } : /^eyJ/.test(key) ? { Authorization: `Bearer ${key}` } : {}),
          'Content-Type': 'application/json',
          ...(init.prefer ? { Prefer: init.prefer } : {})
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(15000)
      })
    } catch {
      throw new AuthError('E_NETWORK')
    }
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    if (!res.ok) {
      const msg = String((data && (data.msg || data.error_description || data.message || data.error_code || data.error)) || '')
      if (/already (been )?registered|user_already_exists|email_exists/i.test(msg)) throw new AuthError('E_EXISTS')
      if (/password/i.test(msg) && /(weak|short|at least|characters)/i.test(msg)) throw new AuthError('E_WEAK')
      if (/email not confirmed|email_not_confirmed/i.test(msg)) throw new AuthError('E_CONFIRM')
      if (res.status === 400 || res.status === 401 || res.status === 403) throw Object.assign(new AuthError('E_CREDENTIALS'), { status: res.status })
      if (res.status === 429) throw new AuthError('E_RATE')
      if (res.status >= 500) throw new AuthError('E_NETWORK')
      throw new AuthError('E_UNKNOWN')
    }
    return data
  }

  private async fetchProfile(token: string, userId: string): Promise<AccessProfile> {
    const rows = await this.call(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,status,modules,expires_at,display_name`, { token })
    const p = Array.isArray(rows) ? rows[0] : null
    return p
      ? { plan: p.plan || 'free', status: p.status || 'pending', modules: Array.isArray(p.modules) ? p.modules : [], expires_at: p.expires_at || null, display_name: p.display_name ?? null }
      : { plan: 'free', status: 'pending', modules: [], expires_at: null }
  }

  private blockReason(p: AccessProfile | null): AccessState['reason'] {
    if (!p) return null
    if (p.status === 'blocked') return 'blocked'
    if (p.status === 'pending') return 'pending'
    if (p.expires_at && Date.parse(p.expires_at) < Date.now()) return 'expired'
    return null
  }

  state(): AccessState {
    if (!this.enabled) {
      return { mode: 'dev', signedIn: false, user: null, profile: null, modules: [...ALL_MODULES], offline: false, reason: null }
    }
    const s = this.session
    const reason = this.blockReason(s?.profile || null)
    return {
      mode: 'remote',
      signedIn: !!s,
      user: s?.user || null,
      profile: s?.profile || null,
      modules: s && !reason ? (s.profile?.modules || []) : [],
      offline: this.offline,
      reason
    }
  }

  private async adopt(tokens: any, event: 'login' | 'app_open'): Promise<AccessState> {
    const user: AccessUser = { id: tokens.user?.id, email: tokens.user?.email }
    const profile = await this.fetchProfile(tokens.access_token, user.id)
    this.session = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: tokens.expires_at || Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
      user,
      profile,
      verified_at: Date.now()
    }
    this.offline = false
    this.writeStored(this.session)
    this.log(event).catch(() => {})
    return this.state()
  }

  /** Restores the saved session on startup (refreshing the token). */
  async restore(): Promise<AccessState> {
    if (this.loaded || !this.enabled) { this.loaded = true; return this.state() }
    this.loaded = true
    const stored = this.readStored()
    if (!stored) return this.state()
    try {
      const tokens = await this.call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: stored.refresh_token } })
      return await this.adopt(tokens, 'app_open')
    } catch (e) {
      if (e instanceof AuthError && e.code === 'E_NETWORK' && Date.now() - stored.verified_at < OFFLINE_GRACE_MS) {
        this.session = stored
        this.offline = true
        return this.state()
      }
      this.session = null
      this.writeStored(null)
      return this.state()
    }
  }

  async signIn(email: string, password: string): Promise<AccessState> {
    if (!this.enabled) throw new AuthError('E_CONFIG')
    const tokens = await this.call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } })
    const st = await this.adopt(tokens, 'login')
    return st
  }

  /** Creates an account (no e-mail confirmation: the project auto-confirms) and signs in. */
  async signUp(email: string, password: string, displayName = ''): Promise<AccessState> {
    if (!this.enabled) throw new AuthError('E_CONFIG')
    if (password.length < 6) throw new AuthError('E_WEAK')
    const res = await this.call('/auth/v1/signup', {
      method: 'POST',
      body: { email: email.trim(), password, data: { display_name: displayName.trim(), signup_source: 'app' } }
    })
    // Auto-confirm projects return a session right away; otherwise try to sign in.
    if (res && res.access_token) return this.adopt(res, 'login')
    try {
      return await this.signIn(email, password)
    } catch (e) {
      if (e instanceof AuthError && e.code === 'E_CREDENTIALS') throw new AuthError('E_CONFIRM')
      throw e
    }
  }

  async signOut(): Promise<AccessState> {
    const s = this.session
    if (s) {
      await this.log('logout').catch(() => {})
      await this.call('/auth/v1/logout', { method: 'POST', token: s.access_token }).catch(() => {})
    }
    this.session = null
    this.writeStored(null)
    return this.state()
  }

  async resetPassword(email: string): Promise<void> {
    if (!this.enabled) throw new AuthError('E_CONFIG')
    await this.call('/auth/v1/recover', { method: 'POST', body: { email: email.trim() } })
  }

  /** Re-reads entitlements (e.g. after a purchase on the site). */
  async refresh(): Promise<AccessState> {
    if (!this.session) return this.state()
    try {
      if (this.session.expires_at - 60 < Date.now() / 1000) {
        const tokens = await this.call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: this.session.refresh_token } })
        return await this.adopt(tokens, 'app_open')
      }
      this.session.profile = await this.fetchProfile(this.session.access_token, this.session.user.id)
      this.session.verified_at = Date.now()
      this.offline = false
      this.writeStored(this.session)
    } catch (e) {
      if (e instanceof AuthError && e.code === 'E_NETWORK') this.offline = true
    }
    return this.state()
  }

  hasModule(m: string): boolean {
    return this.state().modules.includes(m)
  }

  /** Access log row (who used the app, when, which version and platform). */
  async log(event: 'login' | 'logout' | 'app_open' | 'module', module?: string): Promise<void> {
    const s = this.session
    if (!s || !this.enabled) return
    await this.call('/rest/v1/access_log', {
      method: 'POST',
      token: s.access_token,
      prefer: 'return=minimal',
      body: {
        user_id: s.user.id,
        event,
        module: module || null,
        app_version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        os_release: os.release()
      }
    })
  }
}

export const accessControl = new AccessControl()
