/**
 * Pure decisions behind app updates (no Electron imports, so tests/updatePlan.test.ts can run them).
 *
 * Updates come from the Garimpo site, never from a public link: the app asks
 * {site}/api/app/latest which version is current and downloads the file for this
 * machine from {site}/api/app/download/{key}, both with the signed-in user's token.
 */

/**
 * How an update gets onto this machine.
 * - winInstaller: Windows Setup build; the app downloads the new Setup and runs it silently, then it relaunches.
 * - portable: Windows portable exe in a writable folder; the app downloads and swaps the exe.
 * - macBundle: the .app sits in a writable folder; the app downloads the zip, swaps the bundle and relaunches.
 * - macDmg: the .app cannot be replaced (read-only folder or App Translocation); the app downloads the
 *   .dmg into Downloads and opens it.
 * - manual: nothing can be installed from here; `reason` says why.
 */
export type InstallMode =
  | { kind: 'winInstaller' | 'portable' | 'macBundle' | 'macDmg' }
  | { kind: 'manual'; reason: ManualReason }
export type ManualReason = 'readonly' | 'dev' | 'unsupported'

export interface InstallEnv {
  platform: NodeJS.Platform
  packaged: boolean
  /** CPU architecture of the running app (process.arch). */
  arch?: string
  /** Windows portable: the exe the user started (PORTABLE_EXECUTABLE_FILE), else undefined. */
  portableExe?: string
  /** Windows portable: can the app write next to its exe? */
  portableDirWritable?: boolean
  /** macOS: path of the running .app bundle. */
  macBundle?: string
  /** macOS: can the app replace its bundle (bundle and its folder writable)? */
  macBundleWritable?: boolean
}

export function installMode(env: InstallEnv): InstallMode {
  if (!env.packaged) return { kind: 'manual', reason: 'dev' }
  if (env.platform === 'win32') {
    if (!env.portableExe) return { kind: 'winInstaller' }
    return env.portableDirWritable ? { kind: 'portable' } : { kind: 'manual', reason: 'readonly' }
  }
  if (env.platform === 'darwin') {
    // An app opened straight from the disk image (or never moved after download) runs from a randomized
    // read-only copy (App Translocation); it cannot replace itself, so it gets the disk image instead.
    const translocated = !!env.macBundle && env.macBundle.includes('/AppTranslocation/')
    return !translocated && env.macBundleWritable ? { kind: 'macBundle' } : { kind: 'macDmg' }
  }
  return { kind: 'manual', reason: 'unsupported' }
}

export type UpdateKey =
  | 'macArm' | 'macIntel' | 'macArmZip' | 'macIntelZip'
  | 'win64' | 'win32' | 'win64Portable' | 'win32Portable'

/** Which file of the release this machine needs (the site maps the key to the file name). */
export function updateKey(mode: InstallMode, arch: string): UpdateKey | null {
  const x86 = arch === 'ia32'
  const arm = arch === 'arm64'
  switch (mode.kind) {
    case 'winInstaller': return x86 ? 'win32' : 'win64'
    case 'portable': return x86 ? 'win32Portable' : 'win64Portable'
    case 'macBundle': return arm ? 'macArmZip' : 'macIntelZip'
    case 'macDmg': return arm ? 'macArm' : 'macIntel'
    default: return null
  }
}

/** "2.6.6" > "2.6.5" by numeric parts; pre-release suffixes are ignored. */
export function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((n) => Number(n) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

export interface UpdateFile {
  key: string
  name: string
  size?: number | null
  /** Hex SHA-256 recorded for the file, when the site knows it. */
  sha256?: string | null
}

/** Only plain release file names are written to disk (no paths, nothing unexpected). */
export function safeFileName(name: string): string {
  if (!/^Garimpo-[\w.-]+\.(exe|zip|dmg)$/.test(name)) throw new Error(`unexpected update file name: ${name}`)
  return name
}

/**
 * Accept a download only when it matches what the site recorded: the SHA-256 when known, otherwise the size.
 * With neither, nothing installs.
 */
export function verifyDownload(actualSha256: string, actualSize: number, file: UpdateFile): string {
  const actual = actualSha256.toLowerCase()
  const expected = file.sha256 ? file.sha256.replace(/^sha256:/, '').toLowerCase() : null
  if (expected) {
    if (expected !== actual) throw new Error(`${file.name} does not match its checksum; update not installed`)
    return actual
  }
  if (file.size && file.size > 0) {
    if (file.size !== actualSize) throw new Error(`${file.name} is incomplete; update not installed`)
    return actual
  }
  throw new Error(`no checksum for ${file.name}; update not installed`)
}

/** Where the portable exe being replaced is parked until the next start deletes it. */
export function parkedExePath(exe: string): string {
  return `${exe}.old`
}

/** Arguments for a silent run of the NSIS Setup that starts the new version when it finishes. */
export const WIN_SILENT_ARGS = ['/S', '--updated', '--force-run']

/** Shell quoting for the swap script (single quotes, embedded quotes escaped). */
function q(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * The macOS bundle swap, run detached after the app quits: wait for the old process to exit, move the old
 * bundle aside, copy the new one in, put the old one back if the copy fails, then open the app.
 */
export function macSwapScript(pid: number, appPath: string, newApp: string): string {
  const app = q(appPath)
  const old = q(`${appPath}.old`)
  return [
    '#!/bin/bash',
    `while kill -0 ${Math.floor(pid)} 2>/dev/null; do sleep 0.5; done`,
    `rm -rf ${old}`,
    `if mv ${app} ${old} && /usr/bin/ditto ${q(newApp)} ${app}; then`,
    `  rm -rf ${old}`,
    'else',
    `  rm -rf ${app}; mv ${old} ${app}`,
    'fi',
    `/usr/bin/xattr -dr com.apple.quarantine ${app} 2>/dev/null`,
    `/usr/bin/open ${app}`,
    ''
  ].join('\n')
}
