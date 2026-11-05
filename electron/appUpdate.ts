import { app, BrowserWindow, powerMonitor, shell } from 'electron'
import { execFile, spawn } from 'child_process'
import { createHash } from 'crypto'
import { accessSync, constants, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { promisify } from 'util'
import { accessControl } from './services/accessControl'
import {
  installMode, macSwapScript, newer, parkedExePath, safeFileName, updateKey, verifyDownload, WIN_SILENT_ARGS,
  type InstallMode, type ManualReason, type UpdateFile
} from './updatePlan'

/**
 * App updates, served by the Garimpo site with the signed-in user's token. No public link ever reaches the
 * person: the app downloads the file itself and installs it.
 *
 * A check 15 s after launch, then on the schedule picked in Settings, again when the machine wakes past the
 * interval, and a manual one from Settings. Results go to the renderer as `update:status`; the renderer owns the
 * Update now / Later / Skip dialog. Nothing is downloaded until the person says so.
 *
 * Installing (see updatePlan.installMode):
 * - Windows Setup: download the new Setup, run it silently on restart; it starts the new version.
 * - Windows portable: download and swap the exe, relaunch.
 * - macOS: download the zip, swap the .app on restart and reopen it. A bundle that cannot be replaced gets the
 *   .dmg in Downloads, opened on restart.
 * If downloads are running it waits and offers "Restart now" instead, so an update never cuts one off.
 */

export type UpdateSchedule = 'hour' | 'sixHours' | 'day' | 'launch' | 'never'

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error'
  current: string
  latest?: string
  notes?: string
  progress?: number
  error?: string
  /** Set when "Update now" means opening the download page on the site, and why. */
  manualReason?: ManualReason | 'failed'
  /** The macOS disk image path: "restart" opens the installer instead of swapping the app. */
  opensInstaller?: boolean
  /** Downloads are running, so a restart now would interrupt them. */
  busy?: boolean
}

declare const __GARIMPO_SITE_URL__: string | undefined
const SITE = ((typeof __GARIMPO_SITE_URL__ !== 'undefined' && __GARIMPO_SITE_URL__) || 'https://garimpo.diegocosta.digital').replace(/\/+$/, '')
const DOWNLOAD_PAGE = `${SITE}/conta`

const SCHEDULE_MS: Record<UpdateSchedule, number> = {
  hour: 60 * 60_000,
  sixHours: 6 * 60 * 60_000,
  day: 24 * 60 * 60_000,
  launch: 0,
  never: 0
}

let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let schedule: UpdateSchedule = 'launch'
let timer: NodeJS.Timeout | undefined
let launchChecked = false
let resumeHooked = false
let lastCheckAt = 0
let latestFile: UpdateFile | null = null
/** Set by "Update now": restart on our own once the download is ready (unless downloads are running). */
let restartWhenReady = false
/** An install failed this session: fall back to the site's download page until the next launch. */
let inPlaceFailed = false
let isBusy: () => boolean = () => false
let modePromise: Promise<InstallMode> | undefined
let pendingRestart: (() => void) | undefined

const portableExe = process.platform === 'win32' ? process.env.PORTABLE_EXECUTABLE_FILE : undefined
/** process.execPath = <bundle>.app/Contents/MacOS/Garimpo */
const macBundle = process.platform === 'darwin' ? resolve(process.execPath, '..', '..', '..') : undefined

/** main.ts tells us whether downloads are running, so a finished update never cuts one off. */
export function setUpdateBusyCheck(fn: () => boolean): void {
  isBusy = fn
}

function dirWritable(dir: string): boolean {
  const probe = join(dir, `.garimpo-write-test-${process.pid}`)
  try {
    writeFileSync(probe, '')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

function bundleWritable(bundle: string): boolean {
  try {
    accessSync(bundle, constants.W_OK)
    return dirWritable(dirname(bundle))
  } catch {
    return false
  }
}

function updateInstallMode(): Promise<InstallMode> {
  return (modePromise ??= Promise.resolve().then(() => {
    const mode = installMode({
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      portableExe,
      portableDirWritable: portableExe ? dirWritable(dirname(portableExe)) : undefined,
      macBundle,
      macBundleWritable: macBundle && app.isPackaged ? bundleWritable(macBundle) : undefined
    })
    console.log(`[Update] install mode: ${mode.kind}${mode.kind === 'manual' ? ` (${mode.reason})` : ''}`)
    return mode
  }))
}

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next, current: app.getVersion() }
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:status', status)
  }
}

export function updateStatus(): UpdateStatus {
  return status
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessControl.accessToken()
  if (!token) throw new Error('sign in to check for updates')
  return { Authorization: `Bearer ${token}`, 'User-Agent': `Garimpo/${app.getVersion()} (${process.platform}; ${process.arch})` }
}

/** Ask the site which version is current. */
export async function checkForUpdate(manual = false): Promise<UpdateStatus> {
  if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return status
  lastCheckAt = Date.now()
  set({ state: 'checking', error: undefined })
  try {
    const mode = await updateInstallMode()
    const key = updateKey(mode, process.arch) ?? (process.platform === 'darwin' ? (process.arch === 'arm64' ? 'macArm' : 'macIntel') : process.arch === 'ia32' ? 'win32' : 'win64')
    const res = await fetch(`${SITE}/api/app/latest?key=${encodeURIComponent(key)}`, { headers: await authHeaders(), signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(`update server ${res.status}`)
    const rel = (await res.json()) as { version?: string; notes?: string | null; file?: UpdateFile | null }
    const latest = String(rel.version || '').replace(/^v/, '')
    if (!/^\d+\.\d+\.\d+/.test(latest)) throw new Error('update server sent no version')
    latestFile = rel.file && rel.file.name ? rel.file : null
    if (newer(latest, app.getVersion())) {
      console.log(`[Update] check (${manual ? 'manual' : 'scheduled'}): ${latest} available, running ${app.getVersion()}`)
      const manualReason = inPlaceFailed ? 'failed' : mode.kind === 'manual' ? mode.reason : !latestFile ? 'unsupported' : undefined
      set({ state: 'available', latest, notes: rel.notes?.slice(0, 4000) || undefined, manualReason, opensInstaller: mode.kind === 'macDmg' })
    } else {
      console.log(`[Update] check (${manual ? 'manual' : 'scheduled'}): up to date`)
      set({ state: 'none', latest, notes: undefined, manualReason: undefined })
    }
  } catch (e) {
    console.warn('[Update] check failed:', (e as Error).message)
    set({ state: 'error', error: (e as Error).message })
  }
  return status
}

/** "Update now": download and install, or open the site's download page when nothing can install here. */
export async function installUpdate(): Promise<void> {
  if (status.state === 'ready') return restartNow()
  if (status.state !== 'available') return
  const mode = await updateInstallMode()
  if (inPlaceFailed || mode.kind === 'manual' || !latestFile) {
    await shell.openExternal(DOWNLOAD_PAGE)
    return
  }
  restartWhenReady = true
  set({ state: 'downloading', progress: 0, error: undefined })
  try {
    const file = await download(latestFile)
    if (mode.kind === 'winInstaller') prepareWinInstaller(file)
    else if (mode.kind === 'portable') preparePortable(file)
    else if (mode.kind === 'macBundle') await prepareMacBundle(file)
    else prepareMacDmg(file)
    downloaded(status.latest ?? '')
  } catch (e) {
    failInPlace(e as Error)
  }
}

/** "Restart later" after the download: stay running; the update waits in the ready state. */
export function deferRestart(): void {
  restartWhenReady = false
}

function failInPlace(err: Error): void {
  inPlaceFailed = true
  restartWhenReady = false
  pendingRestart = undefined
  console.error('[Update] install failed:', err.message)
  set({ state: 'available', progress: undefined, manualReason: 'failed', error: err.message })
}

function downloaded(version: string): void {
  console.log(`[Update] ${version} ready to install`)
  const busy = isBusy()
  set({ state: 'ready', latest: version, progress: 100, busy })
  if (restartWhenReady && !busy) restartNow()
}

function restartNow(): void {
  if (status.state !== 'ready' || !pendingRestart) return
  console.log(`[Update] installing ${status.latest}`)
  pendingRestart()
}

function stagingDir(): string {
  const dir = join(tmpdir(), 'garimpo-update')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Download {site}/api/app/download/{key} with progress and check it against the recorded checksum. */
async function download(file: UpdateFile, dir = stagingDir()): Promise<string> {
  const name = safeFileName(file.name)
  const target = join(dir, name)
  const partial = `${target}.part`
  rmSync(partial, { force: true })
  console.log(`[Update] downloading ${name}`)
  const res = await fetch(`${SITE}/api/app/download/${encodeURIComponent(file.key)}`, { headers: await authHeaders() })
  if (!res.ok || !res.body) throw new Error(`download ${res.status}`)
  const total = Number(res.headers.get('content-length')) || file.size || 0
  const hash = createHash('sha256')
  const out = createWriteStream(partial)
  let got = 0
  let lastPct = -1
  try {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      got += value.length
      const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0
      if (pct !== lastPct) set({ state: 'downloading', progress: (lastPct = pct) })
    }
    await new Promise<void>((ok, fail) => out.end((err?: Error | null) => (err ? fail(err) : ok())))
    const sha = verifyDownload(hash.digest('hex'), got, file)
    console.log(`[Update] ${name} verified, sha256 ${sha}`)
  } catch (e) {
    out.destroy()
    rmSync(partial, { force: true })
    throw e
  }
  rmSync(target, { force: true })
  renameSync(partial, target)
  return target
}

// ---- Windows Setup ----

function prepareWinInstaller(setupExe: string): void {
  pendingRestart = () => {
    try {
      const child = spawn(setupExe, WIN_SILENT_ARGS, { detached: true, stdio: 'ignore' })
      child.unref()
    } catch (e) {
      failInPlace(e as Error)
      return
    }
    app.quit()
  }
}

// ---- Windows portable ----

function preparePortable(downloadedExe: string): void {
  const exe = portableExe as string
  const staging = join(dirname(exe), `.${safeFileName(downloadedExe.split(/[\\/]/).pop() || '')}.download`)
  rmSync(staging, { force: true })
  renameOrCopy(downloadedExe, staging)
  pendingRestart = () => swapPortableAndRelaunch(exe, staging)
}

function renameOrCopy(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    // another drive: copy, then remove the original
    copyFileSync(from, to)
    rmSync(from, { force: true })
  }
}

function swapPortableAndRelaunch(exe: string, staging: string): void {
  const parked = parkedExePath(exe)
  try {
    rmSync(parked, { force: true })
    renameSync(exe, parked) // Windows lets a running exe be renamed, not overwritten
    try {
      renameSync(staging, exe)
    } catch (e) {
      renameSync(parked, exe)
      throw e
    }
  } catch (e) {
    rmSync(staging, { force: true })
    failInPlace(e as Error)
    return
  }
  console.log(`[Update] portable: ${exe} replaced; relaunching`)
  app.relaunch({ execPath: exe })
  app.quit()
}

/** Portable build: delete the exe parked by the last self-update. */
export function cleanupPortableUpdate(): void {
  if (!portableExe) return
  const parked = parkedExePath(portableExe)
  const attempt = (left: number) => {
    if (!existsSync(parked)) return
    try {
      rmSync(parked, { force: true })
    } catch {
      if (left > 0) setTimeout(() => attempt(left - 1), 10_000)
    }
  }
  attempt(6)
}

// ---- macOS ----

async function prepareMacBundle(zip: string): Promise<void> {
  const unpack = join(dirname(zip), `unpacked-${Date.now()}`)
  rmSync(unpack, { recursive: true, force: true })
  mkdirSync(unpack, { recursive: true })
  await promisify(execFile)('/usr/bin/ditto', ['-x', '-k', zip, unpack], { timeout: 180_000 })
  rmSync(zip, { force: true })
  const appName = readdirSync(unpack).find((n) => n.endsWith('.app'))
  if (!appName) throw new Error('the update has no app inside')
  const newApp = join(unpack, appName)
  // The new bundle must carry a valid signature before it replaces this one.
  await promisify(execFile)('/usr/bin/codesign', ['--verify', '--deep', newApp], { timeout: 120_000 })
  const script = join(dirname(zip), 'swap.sh')
  writeFileSync(script, macSwapScript(process.pid, macBundle as string, newApp), { mode: 0o755 })
  pendingRestart = () => {
    try {
      spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' }).unref()
    } catch (e) {
      failInPlace(e as Error)
      return
    }
    app.quit()
  }
}

function prepareMacDmg(dmg: string): void {
  const dest = join(app.getPath('downloads'), dmg.split('/').pop() as string)
  rmSync(dest, { force: true })
  renameOrCopy(dmg, dest)
  pendingRestart = () => {
    void shell.openPath(dest).then(() => app.quit())
  }
}

/**
 * The renderer calls this once settings have loaded, and again when the setting changes. The launch check runs
 * 15 s after the first call (unless the setting is "never"), then the chosen interval takes over.
 */
export function scheduleUpdateChecks(every: UpdateSchedule): void {
  schedule = every in SCHEDULE_MS ? every : 'launch'
  if (timer) clearInterval(timer)
  timer = undefined
  const interval = SCHEDULE_MS[schedule]
  if (!launchChecked && schedule !== 'never') {
    launchChecked = true
    setTimeout(() => void checkForUpdate(false), 15_000)
  }
  if (interval > 0) timer = setInterval(() => void checkForUpdate(false), interval)
  if (!resumeHooked) {
    resumeHooked = true
    powerMonitor.on('resume', () => {
      const ms = SCHEDULE_MS[schedule]
      if (ms > 0 && Date.now() - lastCheckAt > ms) void checkForUpdate(false)
    })
  }
}
