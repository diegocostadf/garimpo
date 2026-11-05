import { describe, expect, test } from 'bun:test'
import {
  buildSeratoCrate, parseSeratoCrate, seratoTrackPath, seratoCrateFileName,
  buildRekordboxXml, parseRekordboxXml, fileUrl, pathFromFileUrl, buildM3u, parseM3u, compatibleKeys
} from '../electron/services/djFormats'

const tracks = [
  { path: '/Users/diego/Music/Garimpo/Lua Torres/Noite & Dia.mp3', title: 'Noite & Dia', artist: 'Lua Torres', bpm: 124, camelot: '8A', duration: 380, energy: 7 },
  { path: '/Users/diego/Music/Garimpo/Os Pacatos/Ção "Remix".flac', title: 'Ção "Remix"', artist: 'Os Pacatos', bpm: 128.5, camelot: '9A', duration: 401 }
]

describe('serato', () => {
  test('crate round trip keeps paths', () => {
    const paths = tracks.map(t => seratoTrackPath(t.path, '/'))
    expect(paths[0]).toBe('Users/diego/Music/Garimpo/Lua Torres/Noite & Dia.mp3')
    const buf = buildSeratoCrate(paths)
    expect(buf.toString('ascii', 0, 4)).toBe('vrsn')
    expect(parseSeratoCrate(buf)).toEqual(paths)
  })
  test('external drive paths are relative to the volume', () => {
    expect(seratoTrackPath('/Volumes/USB/Musicas/a.mp3', '/Volumes/USB')).toBe('Musicas/a.mp3')
  })
  test('sub-crate file names', () => {
    expect(seratoCrateFileName(['Garimpo', 'House/Tech'])).toBe('Garimpo%%House-Tech.crate')
  })
})

describe('rekordbox', () => {
  test('xml round trip', () => {
    const xml = buildRekordboxXml(tracks, [{ name: 'Sexta', paths: tracks.map(t => t.path) }])
    expect(xml).toContain('AverageBpm="128.50"')
    expect(xml).toContain('Tonality="8A"')
    const parsed = parseRekordboxXml(xml)
    expect(parsed.tracks.map(t => t.path)).toEqual(tracks.map(t => t.path))
    expect(parsed.tracks[1].title).toBe('Ção "Remix"')
    expect(parsed.playlists).toEqual([{ name: 'Garimpo / Sexta', paths: tracks.map(t => t.path) }])
  })
  test('file urls', () => {
    const u = fileUrl('/Users/diego/Música/a b.mp3')
    expect(u).toBe('file://localhost/Users/diego/M%C3%BAsica/a%20b.mp3')
    expect(pathFromFileUrl(u)).toBe('/Users/diego/Música/a b.mp3')
    expect(pathFromFileUrl('file://localhost/C:/Music/x.mp3')).toBe('C:/Music/x.mp3')
  })
})

describe('m3u and keys', () => {
  test('m3u round trip', () => {
    expect(parseM3u(buildM3u(tracks))).toEqual(tracks.map(t => t.path))
    expect(parseM3u('#EXTM3U\nsub/a.mp3', '/music')).toEqual(['/music/sub/a.mp3'])
  })
  test('camelot neighbours', () => {
    expect(compatibleKeys('8A')).toEqual(['8A', '7A', '9A', '8B'])
    expect(compatibleKeys('12B')).toEqual(['12B', '11B', '1B', '12A'])
    expect(compatibleKeys('1A')).toContain('12A')
  })
})
