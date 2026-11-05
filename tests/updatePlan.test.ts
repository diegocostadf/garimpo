import { describe, expect, test } from 'bun:test'
import { installMode, macSwapScript, newer, safeFileName, updateKey, verifyDownload, WIN_SILENT_ARGS } from '../electron/updatePlan'

describe('installMode', () => {
  test('dev builds never update in place', () => {
    expect(installMode({ platform: 'darwin', packaged: false })).toEqual({ kind: 'manual', reason: 'dev' })
  })
  test('Mac: a writable bundle swaps itself, anything else gets the disk image', () => {
    expect(installMode({ platform: 'darwin', packaged: true, macBundle: '/Applications/Garimpo.app', macBundleWritable: true })).toEqual({ kind: 'macBundle' })
    expect(installMode({ platform: 'darwin', packaged: true, macBundle: '/Applications/Garimpo.app', macBundleWritable: false })).toEqual({ kind: 'macDmg' })
    expect(installMode({ platform: 'darwin', packaged: true, macBundle: '/private/var/folders/x/AppTranslocation/ABC/d/Garimpo.app', macBundleWritable: true })).toEqual({ kind: 'macDmg' })
  })
  test('Windows Setup (32 and 64 bits) and portable', () => {
    expect(installMode({ platform: 'win32', packaged: true, arch: 'x64' })).toEqual({ kind: 'winInstaller' })
    expect(installMode({ platform: 'win32', packaged: true, arch: 'ia32' })).toEqual({ kind: 'winInstaller' })
    expect(installMode({ platform: 'win32', packaged: true, portableExe: 'C:\\a.exe', portableDirWritable: true })).toEqual({ kind: 'portable' })
    expect(installMode({ platform: 'win32', packaged: true, portableExe: 'C:\\a.exe', portableDirWritable: false })).toEqual({ kind: 'manual', reason: 'readonly' })
  })
  test('other systems are not supported', () => {
    expect(installMode({ platform: 'linux', packaged: true })).toEqual({ kind: 'manual', reason: 'unsupported' })
  })
})

describe('updateKey', () => {
  test('one file per machine', () => {
    expect(updateKey({ kind: 'winInstaller' }, 'x64')).toBe('win64')
    expect(updateKey({ kind: 'winInstaller' }, 'ia32')).toBe('win32')
    expect(updateKey({ kind: 'portable' }, 'x64')).toBe('win64Portable')
    expect(updateKey({ kind: 'portable' }, 'ia32')).toBe('win32Portable')
    expect(updateKey({ kind: 'macBundle' }, 'arm64')).toBe('macArmZip')
    expect(updateKey({ kind: 'macBundle' }, 'x64')).toBe('macIntelZip')
    expect(updateKey({ kind: 'macDmg' }, 'arm64')).toBe('macArm')
    expect(updateKey({ kind: 'macDmg' }, 'x64')).toBe('macIntel')
    expect(updateKey({ kind: 'manual', reason: 'dev' }, 'x64')).toBeNull()
  })
})

describe('newer', () => {
  test('compares numerically', () => {
    expect(newer('2.6.10', '2.6.9')).toBe(true)
    expect(newer('v2.6.6', '2.6.5')).toBe(true)
    expect(newer('2.6.5', '2.6.5')).toBe(false)
    expect(newer('2.6.4', '2.6.5')).toBe(false)
  })
})

describe('download checks', () => {
  const file = { key: 'win64', name: 'Garimpo-Setup-0.5.0-x64.exe', size: 10, sha256: 'sha256:ABC' }
  test('installs only on a matching checksum', () => {
    expect(verifyDownload('abc', 10, file)).toBe('abc')
    expect(() => verifyDownload('def', 10, file)).toThrow()
  })
  test('without a checksum the size must match', () => {
    expect(verifyDownload('x', 10, { ...file, sha256: null })).toBe('x')
    expect(() => verifyDownload('x', 9, { ...file, sha256: null })).toThrow()
    expect(() => verifyDownload('x', 10, { ...file, sha256: null, size: null })).toThrow()
  })
  test('only release file names are written to disk', () => {
    expect(safeFileName('Garimpo-0.5.0-arm64-mac.zip')).toBe('Garimpo-0.5.0-arm64-mac.zip')
    expect(() => safeFileName('../evil.exe')).toThrow()
    expect(() => safeFileName('Garimpo-x/../../a.exe')).toThrow()
    expect(() => safeFileName('Garimpo-0.5.0.sh')).toThrow()
  })
})

describe('installers', () => {
  test('Windows Setup runs silently and starts the new version', () => {
    expect(WIN_SILENT_ARGS).toEqual(['/S', '--updated', '--force-run'])
  })
  test('Mac swap waits for the app, keeps a way back and reopens it', () => {
    const s = macSwapScript(123, "/Applications/Garimpo's.app", '/tmp/u/Garimpo.app')
    expect(s).toContain('kill -0 123')
    expect(s).toContain(`mv '/Applications/Garimpo'\\''s.app' '/Applications/Garimpo'\\''s.app.old'`)
    expect(s).toContain("/usr/bin/ditto '/tmp/u/Garimpo.app'")
    expect(s).toContain("/usr/bin/open '/Applications/Garimpo'\\''s.app'")
  })
})
