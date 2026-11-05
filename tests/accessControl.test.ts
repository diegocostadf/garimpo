import { describe, expect, test, mock, beforeEach } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'

const dir = fs.mkdtempSync(join(os.tmpdir(), 'garimpo-auth-'))
mock.module('electron', () => ({
  app: { getPath: () => dir, getVersion: () => '0.3.0' },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
    decryptString: (b: Buffer) => Buffer.from(b.toString().slice(4), 'base64').toString()
  }
}))
const { AccessControl } = await import('../electron/services/accessControl')

type Profile = { plan: string; status: string; modules: string[]; expires_at: string | null }
function backend(opts: { profile?: Profile; down?: boolean } = {}) {
  const calls: Array<{ url: string; method: string; body: any; auth: string }> = []
  const profile = opts.profile ?? { plan: 'pro', status: 'active', modules: ['downloads', 'converter'], expires_at: null }
  const fake = (async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null
    calls.push({ url, method: init?.method || 'GET', body, auth: init?.headers?.Authorization })
    if (opts.down) throw new TypeError('fetch failed')
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status })
    if (url.includes('grant_type=password')) {
      return body.password === 'certa123'
        ? json(200, { access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600, user: { id: 'u1', email: body.email } })
        : json(400, { error: 'invalid_grant' })
    }
    if (url.includes('grant_type=refresh_token')) return json(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600, user: { id: 'u1', email: 'dj@garimpo.app' } })
    if (url.includes('/rest/v1/profiles')) return json(200, [profile])
    if (url.includes('/rest/v1/access_log')) return new Response('', { status: 201 })
    if (url.includes('/auth/v1/logout')) return new Response('', { status: 204 })
    if (url.includes('/auth/v1/recover')) return json(200, {})
    return json(404, {})
  }) as unknown as typeof fetch
  return { calls, fake }
}

beforeEach(() => {
  process.env.GARIMPO_SUPABASE_URL = 'https://garimpo-test.supabase.co'
  process.env.GARIMPO_SUPABASE_ANON_KEY = 'anon-key'
  fs.rmSync(join(dir, 'garimpo-session.bin'), { force: true })
})

describe('access control', () => {
  test('development mode without configuration unlocks everything', () => {
    delete process.env.GARIMPO_SUPABASE_URL
    const ac = new AccessControl(backend().fake)
    const s = ac.state()
    expect(s.mode).toBe('dev')
    expect(s.modules).toEqual(['downloads', 'converter', 'dj', 'qobuz'])
  })

  test('sign in loads plan and modules, logs the login, stores an encrypted session', async () => {
    const b = backend()
    const ac = new AccessControl(b.fake)
    expect(ac.state()).toMatchObject({ mode: 'remote', signedIn: false, modules: [] })
    const s = await ac.signIn(' dj@garimpo.app ', 'certa123')
    expect(s).toMatchObject({ signedIn: true, user: { email: 'dj@garimpo.app' }, modules: ['downloads', 'converter'] })
    expect(ac.hasModule('dj')).toBe(false)
    await new Promise(r => setTimeout(r, 10))
    const log = b.calls.find(c => c.url.includes('access_log'))!
    expect(log.body).toMatchObject({ user_id: 'u1', event: 'login', app_version: '0.3.0' })
    expect(log.auth).toBe('Bearer AT1')
    const raw = fs.readFileSync(join(dir, 'garimpo-session.bin'), 'utf8')
    expect(raw.startsWith('enc:')).toBe(true)
    expect(raw).not.toContain('RT1')
  })

  test('wrong password', async () => {
    const ac = new AccessControl(backend().fake)
    await expect(ac.signIn('dj@garimpo.app', 'errada')).rejects.toMatchObject({ code: 'E_CREDENTIALS' })
    expect(ac.state().signedIn).toBe(false)
  })

  test('blocked, pending and expired accounts get no modules', async () => {
    for (const [profile, reason] of [
      [{ plan: 'pro', status: 'blocked', modules: ['downloads'], expires_at: null }, 'blocked'],
      [{ plan: 'free', status: 'pending', modules: ['downloads'], expires_at: null }, 'pending'],
      [{ plan: 'pro', status: 'active', modules: ['downloads'], expires_at: '2020-01-01T00:00:00Z' }, 'expired']
    ] as const) {
      const ac = new AccessControl(backend({ profile: profile as Profile }).fake)
      const s = await ac.signIn('dj@garimpo.app', 'certa123')
      expect(s.reason).toBe(reason)
      expect(s.modules).toEqual([])
    }
  })

  test('restore refreshes the saved session, then works offline within the grace period', async () => {
    await new AccessControl(backend().fake).signIn('dj@garimpo.app', 'certa123')
    const online = new AccessControl(backend().fake)
    expect((await online.restore()).signedIn).toBe(true)
    const offline = new AccessControl(backend({ down: true }).fake)
    const s = await offline.restore()
    expect(s).toMatchObject({ signedIn: true, offline: true, modules: ['downloads', 'converter'] })
  })

  test('sign out clears the session and logs it', async () => {
    const b = backend()
    const ac = new AccessControl(b.fake)
    await ac.signIn('dj@garimpo.app', 'certa123')
    const s = await ac.signOut()
    expect(s.signedIn).toBe(false)
    expect(fs.existsSync(join(dir, 'garimpo-session.bin'))).toBe(false)
    expect(b.calls.some(c => c.body?.event === 'logout')).toBe(true)
    expect(b.calls.some(c => c.url.endsWith('/auth/v1/logout'))).toBe(true)
  })
})
