import { describe, expect, test, mock } from 'bun:test'
mock.module('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.0.0', isPackaged: false }, safeStorage: {} }))
const { parseText, splitYoutubeTitle, detectService } = await import('../electron/services/playlistImport')

describe('playlist import', () => {
  test('free text lines', () => {
    expect(parseText('1. Anitta - Envolver\nLiniker – Baby 95\n\nSó o título')).toEqual([
      { artist: 'Anitta', title: 'Envolver' },
      { artist: 'Liniker', title: 'Baby 95' },
      { artist: '', title: 'Só o título' }
    ])
  })
  test('csv export with header', () => {
    const csv = 'Track Name,Artist Name(s),ISRC,Duration (ms)\n"Envolver","Anitta",BRWMB2100001,193000\n"Dai Dai","Shakira, Burna Boy",,240000'
    const r = parseText(csv)
    expect(r[0]).toEqual({ title: 'Envolver', artist: 'Anitta', album: undefined, isrc: 'BRWMB2100001', durationMs: 193000 })
    expect(r[1].artist).toBe('Shakira')
  })
  test('youtube titles', () => {
    expect(splitYoutubeTitle('LISA - Tarantino (Official Music Video)', 'LLOUD Official')).toEqual({ artist: 'LISA', title: 'Tarantino' })
    expect(splitYoutubeTitle('Shakira, Burna Boy - Dai Dai (Official Video)', 'Shakira')).toEqual({ artist: 'Shakira', title: 'Dai Dai' })
    expect(splitYoutubeTitle('Envolver', 'Anitta - Topic')).toEqual({ artist: 'Anitta', title: 'Envolver' })
    expect(splitYoutubeTitle('Casa Tupka | Vídeo Completo', 'Yo Yo Honey Singh').artist).toBe('Yo Yo Honey Singh')
  })
  test('service detection', () => {
    expect(detectService('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M')).toBe('spotify')
    expect(detectService('https://music.apple.com/br/playlist/top-100-brasil/pl.11ac7cc7d09741c5822e8c66e5c7edbb')).toBe('applemusic')
    expect(detectService('https://music.youtube.com/playlist?list=PL123')).toBe('youtubemusic')
    expect(detectService('https://www.deezer.com/br/playlist/1111141961')).toBe('deezer')
    expect(detectService('https://evil.com/?x=deezer.com')).toBe(null)
  })
})
