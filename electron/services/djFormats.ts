// File formats used by DJ software. Kept free of Electron imports so they can
// be unit tested.
//
// - Serato: binary .crate files in _Serato_/Subcrates (tag + length + data,
//   strings in UTF-16BE, track paths relative to the volume root).
// - Rekordbox: the "rekordbox xml" collection format (File > Export
//   Collection in xml format, and Preferences > Advanced > rekordbox xml).
// - M3U8: plain playlists, read by Engine DJ, djay Pro, Traktor and others.

export interface DjTrack {
  path: string
  title: string
  artist: string
  album?: string
  genre?: string
  duration?: number // seconds
  bpm?: number
  key?: string
  camelot?: string
  energy?: number
}

export interface DjPlaylistData {
  name: string
  paths: string[]
}

// ---------- Serato ----------

function utf16be(s: string): Buffer {
  const b = Buffer.alloc(s.length * 2)
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2)
  return b
}

function fromUtf16be(b: Buffer): string {
  let s = ''
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i))
  return s
}

function tag(name: string, data: Buffer): Buffer {
  const h = Buffer.alloc(8)
  h.write(name, 0, 'ascii')
  h.writeUInt32BE(data.length, 4)
  return Buffer.concat([h, data])
}

/** Path as Serato stores it: relative to the volume root, forward slashes. */
export function seratoTrackPath(absPath: string, volumeRoot: string): string {
  let p = absPath.replace(/\\/g, '/')
  const root = volumeRoot.replace(/\\/g, '/').replace(/\/$/, '')
  if (root && p.startsWith(root + '/')) p = p.slice(root.length + 1)
  return p.replace(/^[A-Za-z]:\//, '').replace(/^\/+/, '')
}

export function buildSeratoCrate(trackPaths: string[]): Buffer {
  const parts: Buffer[] = [tag('vrsn', utf16be('1.0/Serato ScratchLive Crate'))]
  parts.push(tag('osrt', Buffer.concat([tag('tvcn', utf16be('key')), tag('brev', Buffer.from([0]))])))
  for (const col of ['song', 'artist', 'bpm', 'key', 'album', 'length']) {
    parts.push(tag('ovct', Buffer.concat([tag('tvcn', utf16be(col)), tag('tvcw', utf16be('0'))])))
  }
  for (const p of trackPaths) parts.push(tag('otrk', tag('ptrk', utf16be(p))))
  return Buffer.concat(parts)
}

export function parseSeratoCrate(buf: Buffer): string[] {
  const out: string[] = []
  const walk = (b: Buffer) => {
    let i = 0
    while (i + 8 <= b.length) {
      const name = b.toString('ascii', i, i + 4)
      const len = b.readUInt32BE(i + 4)
      const data = b.subarray(i + 8, i + 8 + len)
      if (name === 'otrk') walk(data)
      else if (name === 'ptrk') out.push(fromUtf16be(data))
      i += 8 + len
    }
  }
  walk(buf)
  return out
}

/** "Garimpo%%House" is a sub-crate "House" inside crate "Garimpo". */
export function seratoCrateFileName(parts: string[]): string {
  const clean = parts.map(p => p.replace(/[\\/:*?"<>|%]/g, '-').trim() || 'Sem nome')
  return clean.join('%%') + '.crate'
}

export function seratoCrateDisplayName(fileName: string): string {
  return fileName.replace(/\.crate$/i, '').split('%%').join(' / ')
}

// ---------- Rekordbox XML ----------

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const xmlUnesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

export function fileUrl(absPath: string): string {
  let p = absPath.replace(/\\/g, '/')
  if (/^[A-Za-z]:\//.test(p)) p = '/' + p
  return 'file://localhost' + p.split('/').map(seg => encodeURIComponent(seg).replace(/%3A/gi, ':')).join('/')
}

export function pathFromFileUrl(url: string): string {
  let p = url.replace(/^file:\/\/localhost/i, '').replace(/^file:\/\//i, '')
  p = p.split('/').map(seg => { try { return decodeURIComponent(seg) } catch { return seg } }).join('/')
  if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1)
  return p
}

function kindOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  return ({ mp3: 'MP3 File', flac: 'FLAC File', m4a: 'M4A File', aac: 'AAC File', wav: 'WAV File', aif: 'AIFF File', aiff: 'AIFF File' } as Record<string, string>)[ext || ''] || 'Audio File'
}

export function buildRekordboxXml(tracks: DjTrack[], playlists: DjPlaylistData[], folderName = 'Garimpo', version = '0.1.0'): string {
  const ids = new Map<string, number>()
  tracks.forEach((t, i) => ids.set(t.path, i + 1))
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push('<DJ_PLAYLISTS Version="1.0.0">')
  lines.push(`  <PRODUCT Name="Garimpo" Version="${xmlEsc(version)}" Company="Garimpo"/>`)
  lines.push(`  <COLLECTION Entries="${tracks.length}">`)
  for (const t of tracks) {
    const attrs: Array<[string, string]> = [
      ['TrackID', String(ids.get(t.path))],
      ['Name', t.title || ''],
      ['Artist', t.artist || ''],
      ['Album', t.album || ''],
      ['Genre', t.genre || ''],
      ['Kind', kindOf(t.path)],
      ['TotalTime', String(Math.round(t.duration || 0))],
      ['AverageBpm', (t.bpm || 0).toFixed(2)],
      ['Tonality', t.camelot || t.key || ''],
      ['Comments', t.energy ? `Energy ${t.energy}` : ''],
      ['Location', fileUrl(t.path)]
    ]
    lines.push(`    <TRACK ${attrs.map(([k, v]) => `${k}="${xmlEsc(v)}"`).join(' ')}/>`)
  }
  lines.push('  </COLLECTION>')
  lines.push('  <PLAYLISTS>')
  lines.push('    <NODE Type="0" Name="ROOT" Count="1">')
  lines.push(`      <NODE Type="0" Name="${xmlEsc(folderName)}" Count="${playlists.length}">`)
  for (const p of playlists) {
    const keys = p.paths.map(x => ids.get(x)).filter((x): x is number => !!x)
    lines.push(`        <NODE Name="${xmlEsc(p.name)}" Type="1" KeyType="0" Entries="${keys.length}">`)
    for (const k of keys) lines.push(`          <TRACK Key="${k}"/>`)
    lines.push('        </NODE>')
  }
  lines.push('      </NODE>')
  lines.push('    </NODE>')
  lines.push('  </PLAYLISTS>')
  lines.push('</DJ_PLAYLISTS>')
  return lines.join('\n') + '\n'
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out[m[1]] = xmlUnesc(m[2])
  return out
}

export function parseRekordboxXml(xml: string): { tracks: DjTrack[]; playlists: DjPlaylistData[] } {
  const byId = new Map<string, DjTrack>()
  const tracks: DjTrack[] = []
  const playlists: DjPlaylistData[] = []
  const stack: Array<{ name: string; type: string; keyType: string; keys: string[] }> = []
  let inCollection = false
  const re = /<(\/?)([A-Z_]+)([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const [, close, name, rest, selfClose] = m
    if (name === 'COLLECTION') { inCollection = !close; continue }
    if (name === 'TRACK' && !close) {
      const a = attrs(rest)
      if (inCollection && a.Location) {
        const t: DjTrack = {
          path: pathFromFileUrl(a.Location),
          title: a.Name || '',
          artist: a.Artist || '',
          album: a.Album || undefined,
          genre: a.Genre || undefined,
          duration: Number(a.TotalTime) || undefined,
          bpm: Number(a.AverageBpm) || undefined,
          key: a.Tonality || undefined
        }
        byId.set(a.TrackID, t)
        tracks.push(t)
      } else if (stack.length && a.Key !== undefined) {
        stack[stack.length - 1].keys.push(a.Key)
      }
      continue
    }
    if (name === 'NODE') {
      if (close) {
        const n = stack.pop()
        if (n && n.type === '1') {
          const path = stack.slice(1).map(s => s.name).concat(n.name).filter(Boolean)
          playlists.push({
            name: path.join(' / '),
            paths: n.keys.map(k => (n.keyType === '1' ? tracks.find(t => t.path === pathFromFileUrl(k)) : byId.get(k))?.path).filter((p): p is string => !!p)
          })
        }
        continue
      }
      const a = attrs(rest)
      const node = { name: a.Name || '', type: a.Type || '0', keyType: a.KeyType || '0', keys: [] as string[] }
      if (selfClose) {
        if (node.type === '1') playlists.push({ name: stack.slice(1).map(s => s.name).concat(node.name).join(' / '), paths: [] })
      } else stack.push(node)
    }
  }
  return { tracks, playlists }
}

// ---------- M3U8 ----------

export function buildM3u(tracks: DjTrack[]): string {
  const lines = ['#EXTM3U']
  for (const t of tracks) {
    lines.push(`#EXTINF:${Math.round(t.duration || -1)},${t.artist ? t.artist + ' - ' : ''}${t.title}`)
    lines.push(t.path)
  }
  return lines.join('\n') + '\n'
}

export function parseM3u(text: string, baseDir = ''): string[] {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
    if (/^file:/i.test(l)) return pathFromFileUrl(l)
    if (l.startsWith('/') || /^[A-Za-z]:[\\/]/.test(l) || !baseDir) return l
    return baseDir.replace(/[\\/]$/, '') + '/' + l
  })
}

// ---------- harmonic mixing ----------

/** Camelot neighbours: same key, ±1 on the wheel, and relative major/minor. */
export function compatibleKeys(camelot: string): string[] {
  const m = /^(\d{1,2})([AB])$/.exec(camelot || '')
  if (!m) return []
  const n = Number(m[1])
  const l = m[2]
  const wrap = (x: number) => ((x - 1 + 12) % 12) + 1
  return [`${n}${l}`, `${wrap(n - 1)}${l}`, `${wrap(n + 1)}${l}`, `${n}${l === 'A' ? 'B' : 'A'}`]
}
