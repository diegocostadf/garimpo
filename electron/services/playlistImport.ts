import * as https from 'https'
import { urlHasHost } from '../utils/urlHost'
import { spotifyAPI, type SpotifyTrack } from './spotifyAPI'
import { spotifyConverter, type DeezerTrackInfo } from './spotifyConverter'
import { fetchDeezerPublicJson, fetchDeezerPublicPaginated } from './deezerPublicApi'

// Playlist conversion: read a playlist from another service (or a pasted
// list), then find every track in the Deezer catalog so it can be downloaded.
// Sources: Spotify (API), Deezer and TIM Music (TIM Music is Deezer's catalog),
// Apple Music (public page data), YouTube and YouTube Music (public page
// data), and plain text or CSV exports.

export type ImportService = 'spotify' | 'deezer' | 'timmusic' | 'applemusic' | 'youtubemusic' | 'youtube' | 'text'

export interface SourceTrack {
  title: string
  artist: string
  album?: string
  isrc?: string
  durationMs?: number
}

export interface SourcePlaylist {
  service: ImportService
  name: string
  cover?: string
  tracks: SourceTrack[]
  truncated?: boolean
}

export interface ImportMatch {
  source: SourceTrack
  deezer: DeezerTrackInfo | null
  matchType: 'isrc' | 'search' | 'none'
  confidence: number
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const FETCH_HOSTS = [
  'music.apple.com', 'itunes.apple.com', 'apple.co',
  'youtube.com', 'youtu.be',
  'deezer.com', 'deezer.page.link', 'dzr.page.link', 'link.deezer.com', 'timmusic.com.br', 'tim.com.br', 'timmusic.page.link'
]

function request(url: string, opts: { method?: string; body?: string; headers?: Record<string, string> } = {}, redirects = 0): Promise<{ url: string; body: string }> {
  return new Promise((resolve, reject) => {
    if (!urlHasHost(url, FETCH_HOSTS) || !url.startsWith('https://')) {
      reject(new Error('E_LINK'))
      return
    }
    const req = https.request(url, {
      method: opts.method || 'GET',
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        // Skip the EU consent interstitial on YouTube.
        Cookie: 'CONSENT=YES+cb; SOCS=CAI',
        ...(opts.headers || {})
      },
      timeout: 20000
    }, res => {
      const status = res.statusCode || 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (redirects >= 5) { reject(new Error('E_NETWORK')); return }
        request(new URL(res.headers.location, url).toString(), opts, redirects + 1).then(resolve, reject)
        return
      }
      if (status >= 400) { res.resume(); reject(new Error(status === 404 || status === 403 ? 'E_PRIVATE' : 'E_NETWORK')); return }
      const chunks: Buffer[] = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({ url, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('timeout', () => req.destroy(new Error('E_NETWORK')))
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

export function detectService(input: string): ImportService | null {
  const s = input.trim()
  if (!/^https?:\/\//i.test(s) && !s.startsWith('spotify:')) return s.includes('\n') || s.includes(' - ') || s.includes(',') ? 'text' : null
  if (s.startsWith('spotify:') || urlHasHost(s, ['spotify.com', 'spotify.link'])) return 'spotify'
  if (urlHasHost(s, ['music.apple.com', 'itunes.apple.com', 'apple.co'])) return 'applemusic'
  if (urlHasHost(s, ['music.youtube.com'])) return 'youtubemusic'
  if (urlHasHost(s, ['youtube.com', 'youtu.be'])) return 'youtube'
  if (urlHasHost(s, ['timmusic.com.br', 'tim.com.br', 'timmusic.page.link'])) return 'timmusic'
  if (urlHasHost(s, ['deezer.com', 'deezer.page.link', 'dzr.page.link', 'link.deezer.com'])) return 'deezer'
  return null
}

// ---------- text / CSV ----------

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === sep && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(x => x.trim())
}

export function parseText(text: string): SourceTrack[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = lines[0].includes('\t') ? '\t' : lines[0].split(';').length > lines[0].split(',').length ? ';' : ','
  const header = splitCsvLine(lines[0], sep).map(h => h.toLowerCase())
  const find = (...names: string[]) => header.findIndex(h => names.some(n => h === n || h.startsWith(n)))
  const ti = find('track name', 'title', 'track', 'name', 'título', 'titulo', 'música', 'musica', 'song')
  const ai = find('artist name', 'artist', 'artista', 'artists')
  if (header.length > 1 && ti >= 0 && ai >= 0) {
    const ii = find('isrc')
    const al = find('album name', 'album', 'álbum')
    const du = find('duration', 'track duration', 'duração')
    return lines.slice(1).map(l => {
      const c = splitCsvLine(l, sep)
      const dur = du >= 0 ? Number(c[du]) : NaN
      return {
        title: c[ti] || '',
        artist: (c[ai] || '').split(/[;,]/)[0].trim(),
        album: al >= 0 ? c[al] : undefined,
        isrc: ii >= 0 && c[ii] ? c[ii] : undefined,
        durationMs: isFinite(dur) && dur > 0 ? dur : undefined
      }
    }).filter(t => t.title)
  }
  // Free text: "Artist - Title", one per line. Numbering like "1." is dropped.
  return lines.map(l => {
    const clean = l.replace(/^\s*\d+[.)-]?\s+/, '')
    const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(clean)
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: clean }
  }).filter(t => t.title)
}

// ---------- Spotify ----------

async function readSpotify(url: string): Promise<SourcePlaylist> {
  const parsed = spotifyAPI.parseSpotifyUrl(url)
  if (!parsed) throw new Error('E_LINK')
  const toSource = (t: SpotifyTrack): SourceTrack => ({
    title: t.name, artist: t.artists?.[0]?.name || '', album: t.album?.name, isrc: t.external_ids?.isrc, durationMs: t.duration_ms
  })
  if (parsed.type === 'playlist') {
    const p = await spotifyAPI.getPlaylist(parsed.id)
    return { service: 'spotify', name: p.name, cover: (p as any).images?.[0]?.url, tracks: p.tracks.items.map(i => i.track).filter(Boolean).map(toSource) }
  }
  if (parsed.type === 'album') {
    const a = await spotifyAPI.getAlbum(parsed.id)
    return { service: 'spotify', name: a.name, cover: (a as any).images?.[0]?.url, tracks: a.tracks.items.filter(Boolean).map(t => toSource({ ...t, album: a as any })) }
  }
  if (parsed.type === 'track') {
    const t = await spotifyAPI.getTrack(parsed.id)
    return { service: 'spotify', name: t.name, cover: t.album?.images?.[0]?.url, tracks: [toSource(t)] }
  }
  throw new Error('E_LINK')
}

// ---------- Deezer / TIM Music ----------

async function readDeezer(url: string, service: ImportService): Promise<SourcePlaylist> {
  let final = url
  if (!/deezer\.com\/(?:\w+\/)?(playlist|album)\/\d+/.test(url)) final = (await request(url)).url
  const m = /deezer\.com\/(?:[\w-]+\/)?(playlist|album)\/(\d+)/.exec(final)
  if (!m) throw new Error('E_LINK')
  const [, kind, id] = m
  const meta: any = await fetchDeezerPublicJson(`https://api.deezer.com/${kind}/${id}`)
  const items: any[] = await fetchDeezerPublicPaginated(`https://api.deezer.com/${kind}/${id}/tracks?limit=100`)
  return {
    service,
    name: meta.title || '',
    cover: meta.picture_medium || meta.cover_medium,
    tracks: items.map(t => ({ title: t.title, artist: t.artist?.name || '', album: t.album?.title, isrc: t.isrc, durationMs: (t.duration || 0) * 1000 }))
  }
}

// ---------- Apple Music ----------

function walk(node: any, visit: (o: any) => void, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40) return
  visit(node)
  if (Array.isArray(node)) { for (const x of node) walk(x, visit, depth + 1); return }
  for (const k of Object.keys(node)) walk(node[k], visit, depth + 1)
}

function scriptJson(html: string, pattern: RegExp): any[] {
  const out: any[] = []
  let m: RegExpExecArray | null
  while ((m = pattern.exec(html))) {
    try { out.push(JSON.parse(m[1])) } catch { /* skip */ }
  }
  return out
}

async function readAppleMusic(url: string): Promise<SourcePlaylist> {
  const { body } = await request(url)
  const tracks: SourceTrack[] = []
  const seen = new Set<string>()
  const push = (t: SourceTrack) => {
    const k = `${t.artist}|${t.title}`.toLowerCase()
    if (t.title && !seen.has(k)) { seen.add(k); tracks.push(t) }
  }
  let name = ''
  let cover: string | undefined
  // 1) Server data blob used by the web player.
  for (const data of scriptJson(body, /<script[^>]+id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/g)) {
    walk(data, o => {
      if (typeof o.title === 'string' && typeof o.artistName === 'string' && (o.duration || o.contentDescriptor || o.trackNumber !== undefined)) {
        push({ title: o.title, artist: o.artistName, album: typeof o.albumName === 'string' ? o.albumName : undefined, durationMs: typeof o.duration === 'number' ? o.duration : undefined })
      }
      if (!name && typeof o.title === 'string' && o.kind === 'playlist') name = o.title
    })
  }
  // 2) schema.org data (MusicPlaylist / MusicAlbum with MusicRecording items).
  for (const data of scriptJson(body, /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    walk(data, o => {
      if ((o['@type'] === 'MusicPlaylist' || o['@type'] === 'MusicAlbum') && typeof o.name === 'string') {
        name = name || o.name
        if (typeof o.image === 'string') cover = cover || o.image
      }
      if (o['@type'] === 'MusicRecording' && typeof o.name === 'string') {
        const by = Array.isArray(o.byArtist) ? o.byArtist[0] : o.byArtist
        push({ title: o.name, artist: by?.name || '' })
      }
    })
  }
  if (!name) name = /<meta property="og:title" content="([^"]+)"/.exec(body)?.[1] || 'Apple Music'
  cover = cover || /<meta property="og:image" content="([^"]+)"/.exec(body)?.[1]
  if (!tracks.length) throw new Error('E_PRIVATE')
  return { service: 'applemusic', name: decodeEntities(name), cover, tracks }
}

function decodeEntities(s: string) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

// ---------- YouTube / YouTube Music ----------

const NOISE = /\s*[([](official|oficial|audio|áudio|video|vídeo|clipe|lyric|lyrics|letra|visualizer|hd|4k|mv|music video|videoclipe)[^)\]]*[)\]]/gi

export function splitYoutubeTitle(title: string, channel: string): SourceTrack {
  const topic = / - Topic$/i.test(channel)
  const cleanTitle = title.replace(NOISE, '').trim()
  if (topic) return { artist: channel.replace(/ - Topic$/i, ''), title: cleanTitle }
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(cleanTitle)
  if (m) return { artist: firstArtist(m[1]), title: m[2].split(/\s+\|\s+/)[0].trim() }
  return { artist: channel.replace(/VEVO$/i, '').trim(), title: cleanTitle.split(/\s+\|\s+/)[0].trim() }
}

function firstArtist(s: string): string {
  return s.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bpart\.?)\s*/i)[0].trim() || s.trim()
}

function clockToMs(s: string): number | undefined {
  if (!/^\d+(:\d{2}){1,2}$/.test(s)) return undefined
  return s.split(':').reduce((acc, v) => acc * 60 + Number(v), 0) * 1000
}

function textOf(x: any): string {
  if (!x) return ''
  if (typeof x.content === 'string') return x.content
  if (typeof x.simpleText === 'string') return x.simpleText
  if (Array.isArray(x.runs)) return x.runs.map((r: any) => r.text).join('')
  return ''
}

async function readYoutube(url: string, service: ImportService): Promise<SourcePlaylist> {
  const list = new URL(url).searchParams.get('list') || /\/browse\/VL([\w-]+)/.exec(url)?.[1] || null
  if (!list) throw new Error('E_LINK')
  const { body } = await request(`https://www.youtube.com/playlist?list=${encodeURIComponent(list)}&hl=pt-BR`)
  const m = /var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(body) || /ytInitialData"\]\s*=\s*(\{[\s\S]*?\});/.exec(body)
  if (!m) throw new Error('E_PRIVATE')
  const apiKey = /"INNERTUBE_API_KEY":"([^"]+)"/.exec(body)?.[1]
  const clientVersion = /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/.exec(body)?.[1] || '2.20240101.00.00'
  const tracks: SourceTrack[] = []
  let name = ''
  let cover: string | undefined
  let continuation: string | null = null

  const collect = (data: any) => {
    continuation = null
    walk(data, o => {
      const r = o.playlistVideoRenderer
      if (r && r.videoId) {
        const title = textOf(r.title)
        const channel = textOf(r.shortBylineText)
        const secs = Number(r.lengthSeconds)
        if (title && title !== '[Private video]' && title !== '[Deleted video]') {
          tracks.push({ ...splitYoutubeTitle(title, channel), durationMs: isFinite(secs) ? secs * 1000 : undefined })
        }
      }
      // Current layout (2025+): lockupViewModel items.
      const L = o.lockupViewModel
      if (L && L.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
        const md = L.metadata?.lockupMetadataViewModel
        const title = textOf(md?.title)
        const channel = textOf(md?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text)
        let clock = ''
        walk(L.contentImage, (b: any) => {
          const txt = b?.thumbnailBadgeViewModel?.text
          if (!clock && typeof txt === 'string' && /^\d+(:\d{2}){1,2}$/.test(txt)) clock = txt
        })
        if (title) tracks.push({ ...splitYoutubeTitle(title, channel), durationMs: clockToMs(clock) })
      }
      const tok = o.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token
        || (typeof o.continuationCommand?.token === 'string' ? o.continuationCommand.token : null)
      if (tok) continuation = tok
      if (!name && o.playlistHeaderRenderer) name = textOf(o.playlistHeaderRenderer.title)
      if (!name && o.pageHeaderViewModel?.title?.dynamicTextViewModel?.text?.content) name = o.pageHeaderViewModel.title.dynamicTextViewModel.text.content
    })
  }
  const initial = JSON.parse(m[1])
  name = initial?.metadata?.playlistMetadataRenderer?.title || ''
  cover = /<meta property="og:image" content="([^"]+)"/.exec(body)?.[1]
  collect(initial)

  let pages = 0
  while (continuation && apiKey && pages < 20) {
    pages++
    const res = await request(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion, hl: 'pt-BR' } }, continuation })
    })
    collect(JSON.parse(res.body))
  }
  if (!tracks.length) throw new Error('E_PRIVATE')
  return { service, name: name || 'YouTube', cover, tracks, truncated: !!continuation }
}

// ---------- entry points ----------

export async function readSource(input: { url?: string; text?: string; name?: string }): Promise<SourcePlaylist> {
  if (input.text && input.text.trim()) {
    const tracks = parseText(input.text)
    if (!tracks.length) throw new Error('E_EMPTY')
    return { service: 'text', name: input.name || 'Lista colada', tracks }
  }
  const url = (input.url || '').trim()
  const service = detectService(url)
  switch (service) {
    case 'spotify':
      try { return await readSpotify(url) } catch (e: any) { throw new Error(e?.message === 'E_LINK' ? 'E_LINK' : 'E_SPOTIFY') }
    case 'deezer':
    case 'timmusic': return readDeezer(url, service)
    case 'applemusic': return readAppleMusic(url)
    case 'youtube':
    case 'youtubemusic': return readYoutube(url, service)
    case 'text': return readSource({ text: url })
    default: throw new Error('E_LINK')
  }
}

export async function matchTrack(t: SourceTrack): Promise<ImportMatch> {
  if (!t.artist) {
    // No artist (free text line): search the title alone and take the top hit.
    try {
      const r: any = await fetchDeezerPublicJson(`https://api.deezer.com/search?q=${encodeURIComponent(t.title)}&limit=1`)
      const hit = r?.data?.[0]
      if (hit) return { source: t, deezer: hit, matchType: 'search', confidence: 60 }
    } catch { /* fall through */ }
    return { source: t, deezer: null, matchType: 'none', confidence: 0 }
  }
  const fake: SpotifyTrack = {
    id: '', name: t.title, artists: [{ id: '', name: firstArtist(t.artist) }],
    album: { id: '', name: t.album || '', images: [], release_date: '' },
    duration_ms: t.durationMs || 0, explicit: false, external_ids: t.isrc ? { isrc: t.isrc } : undefined,
    preview_url: null, popularity: 0
  }
  const m = await spotifyConverter.convertTrack(fake)
  return { source: t, deezer: m.deezerTrack, matchType: m.matchType, confidence: m.confidence }
}

// Background jobs so the UI can poll progress for long playlists.
interface Job { id: string; total: number; done: number; results: ImportMatch[]; finished: boolean; cancelled: boolean; error?: string }
const jobs = new Map<string, Job>()

export function startMatchJob(tracks: SourceTrack[]): string {
  const id = `imp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const job: Job = { id, total: tracks.length, done: 0, results: [], finished: false, cancelled: false }
  jobs.set(id, job)
  ;(async () => {
    for (const t of tracks) {
      if (job.cancelled) break
      try { job.results.push(await matchTrack(t)) }
      catch (e: any) { job.results.push({ source: t, deezer: null, matchType: 'none', confidence: 0 }); job.error = e?.message }
      job.done++
    }
    job.finished = true
    setTimeout(() => jobs.delete(id), 30 * 60 * 1000)
  })()
  return id
}

export function getMatchJob(id: string, from = 0) {
  const job = jobs.get(id)
  if (!job) return null
  return { id, total: job.total, done: job.done, finished: job.finished, results: job.results.slice(from) }
}

export function cancelMatchJob(id: string) {
  const job = jobs.get(id)
  if (job) job.cancelled = true
}
