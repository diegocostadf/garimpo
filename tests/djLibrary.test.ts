import { describe, expect, test, mock } from 'bun:test'
import * as fs from 'fs'
import * as os from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

const root = fs.mkdtempSync(join(os.tmpdir(), 'garimpo-dj-'))
const home = join(root, 'home')
fs.mkdirSync(join(home, 'Music'), { recursive: true })
mock.module('electron', () => ({ app: { getPath: (k: string) => (k === 'music' ? join(home, 'Music') : root), getVersion: () => '0.1.0' } }))
mock.module('os', () => ({ ...os, homedir: () => home, default: { ...os, homedir: () => home } }))
const { djLibrary } = await import('../electron/services/djLibrary')
const { parseSeratoCrate, parseRekordboxXml } = await import('../electron/services/djFormats')

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true } catch { return false } })()

describe.if(hasFfmpeg)('dj library', () => {
  const music = join(root, 'musicas')
  fs.mkdirSync(music)
  for (const [name, freq] of [['Alpha', 220], ['Beta', 330]] as const) {
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=3`,
      '-metadata', `title=${name}`, '-metadata', 'artist=Teste', join(music, `${name}.mp3`)])
  }

  test('scan, analyse, playlist, export and import', async () => {
    const tracks = await djLibrary.scan(music)
    expect(tracks.map(t => t.title)).toEqual(['Alpha', 'Beta'])
    const a = tracks[0].path
    const r = djLibrary.saveAnalysis(a, { bpm: 124.3, key: 'Am', camelot: '8A', energy: 7 }, true)
    expect(r.tagged).toBe(true)
    // Tags really written: rescan reads them back but keeps the analysis.
    const again = await djLibrary.scan(music)
    expect(again[0].bpm).toBe(124.3)
    const mm: any = await import('music-metadata')
    const meta = await mm.parseFile(a)
    expect(meta.common.bpm).toBe(124)
    expect(meta.common.key).toBe('8A')

    const pl = djLibrary.upsertPlaylist({ name: 'Sexta / Abertura', paths: tracks.map(t => t.path) })
    const serato = djLibrary.exportSerato([pl.id])
    expect(serato.crates[0]).toContain('Garimpo%%Sexta%%Abertura.crate')
    expect(parseSeratoCrate(fs.readFileSync(serato.crates[0]))).toEqual(tracks.map(t => t.path.replace(/^\//, '')))

    const xml = djLibrary.exportRekordbox([pl.id])
    const parsed = parseRekordboxXml(fs.readFileSync(xml, 'utf8'))
    expect(parsed.playlists[0].paths).toEqual(tracks.map(t => t.path))
    expect(parsed.tracks[0].key).toBe('8A')

    // Conversion: Serato crates come back as Garimpo playlists (own crates skipped),
    // and a Rekordbox XML imports as playlists.
    fs.copyFileSync(serato.crates[0], join(home, 'Music', '_Serato_', 'Subcrates', 'Warmup.crate'))
    const fromSerato = djLibrary.importSerato()
    expect(fromSerato.map(p => p.name)).toEqual(['Warmup'])
    expect(fromSerato[0].paths).toEqual(tracks.map(t => t.path))
    const fromRb = djLibrary.importRekordbox(xml)
    expect(fromRb[0].name).toBe('Garimpo / Sexta / Abertura')

    const m3u = djLibrary.exportM3u([pl.id])
    expect(fs.readFileSync(m3u[0], 'utf8')).toContain('#EXTINF')
  })
})
