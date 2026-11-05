import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiGet, apiPost } from '../utils/api'
import { analyzeFile } from '../analysis/runner'

export interface LibTrack {
  path: string
  title: string
  artist: string
  album?: string
  genre?: string
  duration?: number
  bpm?: number
  key?: string
  camelot?: string
  energy?: number
  analyzedAt?: number
}

export interface DjPlaylist {
  id: string
  name: string
  paths: string[]
  updatedAt: number
}

export const useDjStore = defineStore('dj', () => {
  const folders = ref<string[]>([])
  const tracks = ref<LibTrack[]>([])
  const playlists = ref<DjPlaylist[]>([])
  const seratoFolders = ref<string[]>([])
  const loaded = ref(false)
  const scanning = ref(false)
  const writeTags = ref(true)

  // Analysis queue
  const analyzing = ref(false)
  const queueTotal = ref(0)
  const queueDone = ref(0)
  const current = ref<string | null>(null)
  const failures = ref<string[]>([])
  let stopRequested = false

  const byPath = computed(() => new Map(tracks.value.map(t => [t.path, t])))
  const unanalyzed = computed(() => tracks.value.filter(t => !t.analyzedAt))

  async function load() {
    const s = await apiGet<{ folders: string[]; tracks: LibTrack[]; playlists: DjPlaylist[]; seratoFolders: string[] }>('/api/dj/state')
    folders.value = s.folders
    tracks.value = s.tracks.sort((a, b) => a.path.localeCompare(b.path))
    playlists.value = s.playlists
    seratoFolders.value = s.seratoFolders
    loaded.value = true
  }

  async function addFolder(folder: string) {
    scanning.value = true
    try {
      await apiPost('/api/dj/scan', { folder })
      await load()
    } finally {
      scanning.value = false
    }
  }

  async function rescan() {
    scanning.value = true
    try {
      for (const f of folders.value) await apiPost('/api/dj/scan', { folder: f }).catch(() => {})
      await load()
    } finally {
      scanning.value = false
    }
  }

  async function forgetFolder(folder: string) {
    await apiPost('/api/dj/forget', { folder })
    await load()
  }

  async function analyze(paths: string[]) {
    if (analyzing.value || !paths.length) return
    analyzing.value = true
    stopRequested = false
    queueTotal.value = paths.length
    queueDone.value = 0
    failures.value = []
    for (const p of paths) {
      if (stopRequested) break
      current.value = p
      try {
        const r = await analyzeFile(p)
        const saved = await apiPost<{ track: LibTrack }>('/api/dj/analysis', { path: p, result: r, writeTags: writeTags.value })
        const i = tracks.value.findIndex(t => t.path === p)
        if (i >= 0) tracks.value[i] = { ...tracks.value[i], ...saved.track }
      } catch {
        failures.value.push(p)
      }
      queueDone.value++
    }
    current.value = null
    analyzing.value = false
  }

  function stopAnalysis() { stopRequested = true }

  async function savePlaylist(p: { id?: string; name: string; paths: string[] }) {
    const saved = await apiPost<DjPlaylist>('/api/dj/playlist', p)
    const i = playlists.value.findIndex(x => x.id === saved.id)
    if (i >= 0) playlists.value[i] = saved
    else playlists.value.push(saved)
    return saved
  }

  async function deletePlaylist(id: string) {
    await apiPost('/api/dj/playlist/delete', { id })
    playlists.value = playlists.value.filter(p => p.id !== id)
  }

  async function exportTo(target: 'serato' | 'rekordbox' | 'm3u', ids?: string[]) {
    return apiPost<{ files: string[] }>('/api/dj/export', { target, ids })
  }

  async function importFrom(source: 'serato' | 'rekordbox' | 'm3u', file?: string) {
    const r = await apiPost<{ playlists: DjPlaylist[] }>('/api/dj/import', { source, file })
    await load()
    return r.playlists
  }

  return {
    folders, tracks, playlists, seratoFolders, loaded, scanning, writeTags,
    analyzing, queueTotal, queueDone, current, failures, byPath, unanalyzed,
    load, addFolder, rescan, forgetFolder, analyze, stopAnalysis,
    savePlaylist, deletePlaylist, exportTo, importFrom
  }
})

// ---------- harmonic helpers ----------

export function camelotParts(c?: string): { n: number; l: 'A' | 'B' } | null {
  const m = /^(\d{1,2})([AB])$/.exec(c || '')
  return m ? { n: Number(m[1]), l: m[2] as 'A' | 'B' } : null
}

export function isCompatible(a?: string, b?: string): boolean {
  const x = camelotParts(a)
  const y = camelotParts(b)
  if (!x || !y) return false
  if (x.n === y.n) return true
  const d = Math.abs(x.n - y.n)
  return x.l === y.l && (d === 1 || d === 11)
}

/** Greedy harmonic order: each next track is key-compatible when possible
 *  and as close in tempo as possible, starting from the first one. */
export function harmonicOrder(list: LibTrack[]): LibTrack[] {
  if (list.length < 3) return list.slice()
  const rest = list.slice(1)
  const out = [list[0]]
  while (rest.length) {
    const last = out[out.length - 1]
    let bestI = 0
    let bestScore = Infinity
    rest.forEach((t, i) => {
      const bpmGap = last.bpm && t.bpm ? Math.abs(last.bpm - t.bpm) : 20
      const score = (isCompatible(last.camelot, t.camelot) ? 0 : 30) + bpmGap + Math.abs((last.energy || 5) - (t.energy || 5)) * 0.5
      if (score < bestScore) { bestScore = score; bestI = i }
    })
    out.push(rest.splice(bestI, 1)[0])
  }
  return out
}
