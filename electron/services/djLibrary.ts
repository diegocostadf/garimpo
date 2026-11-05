import * as fs from 'fs'
import * as os from 'os'
import { join, dirname, basename, extname } from 'path'
import { app } from 'electron'
import { writeDjTags } from './retagger'
import { isAudioPath } from './mediaProxy'
import {
  type DjTrack, type DjPlaylistData,
  buildSeratoCrate, parseSeratoCrate, seratoTrackPath, seratoCrateFileName, seratoCrateDisplayName,
  buildRekordboxXml, parseRekordboxXml, buildM3u, parseM3u
} from './djFormats'

// The DJ library: analysis results per file, playlists built in Garimpo, and
// the bridges to Serato, Rekordbox and M3U-based software.

export interface LibraryTrack extends DjTrack {
  mtime: number
  size: number
  analyzedAt?: number
}

export interface DjPlaylist {
  id: string
  name: string
  paths: string[]
  updatedAt: number
}

interface Store {
  version: 1
  folders: string[]
  tracks: Record<string, LibraryTrack>
  playlists: DjPlaylist[]
}

class DjLibrary {
  private data: Store | null = null
  private saveTimer: NodeJS.Timeout | null = null

  private file() { return join(app.getPath('userData'), 'garimpo-dj.json') }

  private load(): Store {
    if (this.data) return this.data
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(), 'utf8'))
      this.data = { version: 1, folders: raw.folders || [], tracks: raw.tracks || {}, playlists: raw.playlists || [] }
    } catch {
      this.data = { version: 1, folders: [], tracks: {}, playlists: [] }
    }
    return this.data
  }

  private save() {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      try {
        const tmp = this.file() + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(this.data))
        fs.renameSync(tmp, this.file())
      } catch (e) { console.error('[DjLibrary] save failed', e) }
    }, 400)
  }

  state() {
    const d = this.load()
    return { folders: d.folders, tracks: Object.values(d.tracks), playlists: d.playlists }
  }

  // ---------- scanning ----------

  async scan(folder: string): Promise<LibraryTrack[]> {
    const d = this.load()
    if (!fs.existsSync(folder)) throw new Error('Folder not found')
    if (!d.folders.includes(folder)) d.folders.push(folder)
    const files: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 12) return
      let entries: fs.Dirent[]
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === '_Serato_') continue
        const full = join(dir, e.name)
        if (e.isDirectory()) walk(full, depth + 1)
        else if (e.isFile() && isAudioPath(full)) files.push(full)
      }
    }
    walk(folder, 0)

    const mm: any = await import('music-metadata')
    const out: LibraryTrack[] = []
    let i = 0
    const worker = async () => {
      while (i < files.length) {
        const p = files[i++]
        let st: fs.Stats
        try { st = fs.statSync(p) } catch { continue }
        const cached = d.tracks[p]
        if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) { out.push(cached); continue }
        const t: LibraryTrack = { path: p, title: basename(p, extname(p)), artist: '', mtime: st.mtimeMs, size: st.size }
        try {
          const meta = await mm.parseFile(p, { duration: true, skipCovers: true })
          const c = meta.common || {}
          t.title = c.title || t.title
          t.artist = c.artist || c.albumartist || ''
          t.album = c.album || undefined
          t.genre = Array.isArray(c.genre) ? c.genre[0] : c.genre
          t.duration = meta.format?.duration ? Math.round(meta.format.duration) : undefined
          if (c.bpm) t.bpm = Number(c.bpm) || undefined
          if (c.key) t.key = String(c.key)
          if (/^\d{1,2}[AB]$/i.test(t.key || '')) t.camelot = t.key!.toUpperCase()
        } catch { /* keep filename title */ }
        // Keep previous analysis when only tags changed (we write tags ourselves).
        if (cached?.analyzedAt) {
          t.bpm = cached.bpm; t.key = cached.key; t.camelot = cached.camelot; t.energy = cached.energy; t.analyzedAt = cached.analyzedAt
        }
        d.tracks[p] = t
        out.push(t)
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
    this.save()
    return out.sort((a, b) => a.path.localeCompare(b.path))
  }

  forgetFolder(folder: string) {
    const d = this.load()
    d.folders = d.folders.filter(f => f !== folder)
    for (const p of Object.keys(d.tracks)) if (p.startsWith(folder)) delete d.tracks[p]
    this.save()
  }

  saveAnalysis(path: string, r: { bpm: number; key: string; camelot: string; energy: number; duration?: number }, writeTags: boolean) {
    const d = this.load()
    const t = d.tracks[path]
    if (!t) throw new Error('Track not in library')
    Object.assign(t, { bpm: r.bpm, key: r.key, camelot: r.camelot, energy: r.energy, analyzedAt: Date.now() })
    if (r.duration && !t.duration) t.duration = Math.round(r.duration)
    let tagged = false
    if (writeTags) {
      try {
        tagged = writeDjTags(path, { bpm: r.bpm, key: r.camelot, energy: r.energy })
        const st = fs.statSync(path)
        t.mtime = st.mtimeMs
        t.size = st.size
      } catch (e) { console.error('[DjLibrary] tag write failed', e) }
    }
    this.save()
    return { track: t, tagged }
  }

  // ---------- playlists ----------

  upsertPlaylist(p: { id?: string; name: string; paths: string[] }): DjPlaylist {
    const d = this.load()
    const name = (p.name || '').trim() || 'Playlist'
    let pl = p.id ? d.playlists.find(x => x.id === p.id) : undefined
    if (!pl) {
      pl = { id: `pl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, paths: [], updatedAt: Date.now() }
      d.playlists.push(pl)
    }
    pl.name = name
    pl.paths = Array.from(new Set(p.paths))
    pl.updatedAt = Date.now()
    this.save()
    return pl
  }

  deletePlaylist(id: string) {
    const d = this.load()
    d.playlists = d.playlists.filter(p => p.id !== id)
    this.save()
  }

  private tracksFor(paths: string[]): DjTrack[] {
    const d = this.load()
    return paths.map(p => d.tracks[p] || { path: p, title: basename(p, extname(p)), artist: '' })
  }

  private selected(ids?: string[]): DjPlaylist[] {
    const d = this.load()
    return ids && ids.length ? d.playlists.filter(p => ids.includes(p.id)) : d.playlists
  }

  // ---------- export ----------

  /** Serato reads crates from _Serato_ on the drive that holds the music. */
  seratoRootFor(trackPath: string): { serato: string; volume: string } {
    const norm = trackPath.replace(/\\/g, '/')
    const vol = /^\/Volumes\/[^/]+/.exec(norm)?.[0]
    if (vol) return { serato: join(vol, '_Serato_'), volume: vol }
    if (process.platform === 'win32') {
      const drive = /^[A-Za-z]:/.exec(trackPath)?.[0]
      const home = os.homedir()
      if (drive && !home.toUpperCase().startsWith(drive.toUpperCase())) return { serato: join(drive + '\\', '_Serato_'), volume: drive + '\\' }
      return { serato: join(home, 'Music', '_Serato_'), volume: (drive || 'C:') + '\\' }
    }
    return { serato: join(os.homedir(), 'Music', '_Serato_'), volume: '/' }
  }

  exportSerato(ids?: string[]): { crates: string[]; folders: string[] } {
    const written: string[] = []
    const folders = new Set<string>()
    for (const pl of this.selected(ids)) {
      const byRoot = new Map<string, { volume: string; paths: string[] }>()
      for (const p of pl.paths) {
        const r = this.seratoRootFor(p)
        const e = byRoot.get(r.serato) || { volume: r.volume, paths: [] }
        e.paths.push(seratoTrackPath(p, r.volume))
        byRoot.set(r.serato, e)
      }
      if (!byRoot.size) byRoot.set(this.seratoRootFor(join(os.homedir(), 'x')).serato, { volume: '/', paths: [] })
      for (const [root, e] of byRoot) {
        const dir = join(root, 'Subcrates')
        fs.mkdirSync(dir, { recursive: true })
        const file = join(dir, seratoCrateFileName(['Garimpo', ...pl.name.split(' / ')]))
        fs.writeFileSync(file, buildSeratoCrate(e.paths))
        written.push(file)
        folders.add(dir)
      }
    }
    return { crates: written, folders: [...folders] }
  }

  defaultExportDir(): string {
    const dir = join(app.getPath('music'), 'Garimpo', 'DJ')
    fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  exportRekordbox(ids?: string[], dir?: string): string {
    const pls = this.selected(ids)
    const paths = Array.from(new Set(pls.flatMap(p => p.paths)))
    const xml = buildRekordboxXml(this.tracksFor(paths), pls.map(p => ({ name: p.name, paths: p.paths })), 'Garimpo', app.getVersion())
    const out = join(dir || this.defaultExportDir(), 'garimpo-rekordbox.xml')
    fs.writeFileSync(out, xml, 'utf8')
    return out
  }

  exportM3u(ids?: string[], dir?: string): string[] {
    const base = join(dir || this.defaultExportDir(), 'M3U')
    fs.mkdirSync(base, { recursive: true })
    return this.selected(ids).map(pl => {
      const file = join(base, pl.name.replace(/[\\/:*?"<>|]/g, '-') + '.m3u8')
      fs.writeFileSync(file, buildM3u(this.tracksFor(pl.paths)), 'utf8')
      return file
    })
  }

  // ---------- import (conversion between DJ software) ----------

  private importPlaylists(list: DjPlaylistData[], tracks: DjTrack[] = []): DjPlaylist[] {
    const d = this.load()
    for (const t of tracks) {
      if (d.tracks[t.path]) continue
      let st: fs.Stats | null = null
      try { st = fs.statSync(t.path) } catch { /* file may live on a drive not mounted now */ }
      d.tracks[t.path] = { ...t, camelot: /^\d{1,2}[AB]$/i.test(t.key || '') ? t.key!.toUpperCase() : t.camelot, mtime: st?.mtimeMs || 0, size: st?.size || 0 }
    }
    return list.filter(p => p.name).map(p => this.upsertPlaylist({
      id: d.playlists.find(x => x.name === p.name)?.id,
      name: p.name,
      paths: p.paths
    }))
  }

  importRekordbox(xmlPath: string): DjPlaylist[] {
    const parsed = parseRekordboxXml(fs.readFileSync(xmlPath, 'utf8'))
    return this.importPlaylists(parsed.playlists, parsed.tracks)
  }

  seratoFolders(): string[] {
    const roots = [join(os.homedir(), 'Music', '_Serato_')]
    if (process.platform === 'darwin') {
      try { for (const v of fs.readdirSync('/Volumes')) roots.push(join('/Volumes', v, '_Serato_')) } catch { /* none */ }
    }
    return roots.filter(r => fs.existsSync(join(r, 'Subcrates')))
  }

  importSerato(): DjPlaylist[] {
    const lists: DjPlaylistData[] = []
    for (const root of this.seratoFolders()) {
      const volume = root.startsWith('/Volumes/') ? dirname(root) : process.platform === 'win32' ? root.slice(0, 3) : '/'
      for (const f of fs.readdirSync(join(root, 'Subcrates'))) {
        if (!f.endsWith('.crate') || f.startsWith('Garimpo%%')) continue
        const rel = parseSeratoCrate(fs.readFileSync(join(root, 'Subcrates', f)))
        lists.push({ name: seratoCrateDisplayName(f), paths: rel.map(r => join(volume, r)) })
      }
    }
    return this.importPlaylists(lists)
  }

  importM3u(file: string): DjPlaylist[] {
    const paths = parseM3u(fs.readFileSync(file, 'utf8'), dirname(file))
    return this.importPlaylists([{ name: basename(file, extname(file)), paths }])
  }
}

export const djLibrary = new DjLibrary()
