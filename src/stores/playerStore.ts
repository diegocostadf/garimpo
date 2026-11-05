import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Track } from '../types'
import { useSettingsStore } from './settingsStore'

// Preview player. One persistent <audio> element is wired into Web Audio
// (source -> splitter -> two analysers for the L/R VU meters -> speakers).
// Clips are streamed through the local server so they are CORS-clean; if the
// proxy is unreachable we fall back to a plain element (sound, no meters).
export const usePlayerStore = defineStore('player', () => {
  const currentTrack = ref<Track | null>(null)
  const isPlaying = ref(false)
  const isLoading = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  // Playable window inside the media (Qobuz streams are full songs; we play a
  // 30 s slice). For Deezer clips the window is the whole clip.
  const windowStart = ref(0)
  const windowLength = ref(30)
  const queue = ref<Track[]>([])
  const metersLive = ref(false)

  const currentTrackId = computed(() => currentTrack.value?.id || null)
  const position = computed(() => Math.max(0, currentTime.value - windowStart.value))
  const length = computed(() => {
    const avail = duration.value > 0 ? duration.value - windowStart.value : windowLength.value
    return Math.max(1, Math.min(windowLength.value, avail))
  })
  const queueIndex = computed(() => queue.value.findIndex(t => t.id === currentTrack.value?.id))
  const hasNext = computed(() => queueIndex.value >= 0 && queueIndex.value < queue.value.length - 1)
  const hasPrev = computed(() => queueIndex.value > 0)

  const QOBUZ_PREVIEW_SECONDS = 30

  let meterEl: HTMLAudioElement | null = null
  let plainEl: HTMLAudioElement | null = null
  let active: HTMLAudioElement | null = null
  let ctx: AudioContext | null = null
  let analysers: [AnalyserNode, AnalyserNode] | null = null
  let playToken = 0

  async function serverBase(): Promise<string> {
    const port = window.electronAPI ? await window.electronAPI.getServerPort() : 6595
    return `http://127.0.0.1:${port}`
  }

  function bind(el: HTMLAudioElement) {
    el.preload = 'auto'
    el.addEventListener('timeupdate', () => {
      if (el !== active) return
      currentTime.value = el.currentTime
      if (currentTime.value >= windowStart.value + windowLength.value) onEnded()
    })
    el.addEventListener('loadedmetadata', () => {
      if (el !== active) return
      duration.value = isFinite(el.duration) ? el.duration : 0
    })
    el.addEventListener('playing', () => { if (el === active) { isPlaying.value = true; isLoading.value = false } })
    el.addEventListener('pause', () => { if (el === active) isPlaying.value = false })
    el.addEventListener('waiting', () => { if (el === active) isLoading.value = true })
    el.addEventListener('ended', () => { if (el === active) onEnded() })
  }

  function ensureMeterGraph(): HTMLAudioElement | null {
    if (meterEl) return meterEl
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
      const el = new Audio()
      el.crossOrigin = 'anonymous'
      bind(el)
      const src = ctx.createMediaElementSource(el)
      const split = ctx.createChannelSplitter(2)
      const l = ctx.createAnalyser()
      const r = ctx.createAnalyser()
      for (const a of [l, r]) { a.fftSize = 1024; a.smoothingTimeConstant = 0.2 }
      src.connect(split)
      split.connect(l, 0)
      split.connect(r, 1)
      src.connect(ctx.destination)
      analysers = [l, r]
      meterEl = el
      return el
    } catch {
      return null
    }
  }

  function ensurePlain(): HTMLAudioElement {
    if (!plainEl) { plainEl = new Audio(); bind(plainEl) }
    return plainEl
  }

  function applyVolume() {
    const v = (useSettingsStore().settings.previewVolume ?? 80) / 100
    if (meterEl) meterEl.volume = v
    if (plainEl) plainEl.volume = v
  }

  async function resolvePreviewUrl(track: Track): Promise<string | undefined> {
    let previewUrl = track.preview
    const base = await serverBase()
    if ((track as any).localPath) return `${base}/api/library/file?path=${encodeURIComponent((track as any).localPath)}`
    if ((track as any).source === 'qobuz') {
      // Signed Qobuz URLs are short-lived: resolve fresh on every play.
      try {
        const qobuzId = (track as any).qobuzId ?? track.id
        const r = await fetch(`${base}/api/qobuz/preview?id=${qobuzId}`)
        if (r.ok) { const d = await r.json(); return d.url || undefined }
      } catch { /* no preview */ }
      return undefined
    }
    if (previewUrl === undefined) {
      // Slim Deezer list objects carry no preview; resolve once and cache.
      try {
        const r = await fetch(`${base}/api/track?id=${track.id}`)
        if (r.ok) {
          const d = await r.json()
          track.preview = typeof d.preview === 'string' ? d.preview : ''
          previewUrl = track.preview || undefined
        }
      } catch { /* retry on next click */ }
    }
    return previewUrl || undefined
  }

  function waitForMeta(el: HTMLAudioElement): Promise<void> {
    return new Promise((resolve, reject) => {
      if (el.readyState >= 1) return resolve()
      const ok = () => { cleanup(); resolve() }
      const bad = () => { cleanup(); reject(new Error('media error')) }
      const cleanup = () => { el.removeEventListener('loadedmetadata', ok); el.removeEventListener('error', bad) }
      el.addEventListener('loadedmetadata', ok)
      el.addEventListener('error', bad)
    })
  }

  async function start(track: Track) {
    const token = ++playToken
    halt()
    currentTrack.value = track
    isLoading.value = true
    currentTime.value = 0
    duration.value = 0
    windowStart.value = 0
    windowLength.value = (track as any).source === 'qobuz' ? QOBUZ_PREVIEW_SECONDS : 30

    const url = await resolvePreviewUrl(track)
    if (token !== playToken) return
    if (!url) { isLoading.value = false; currentTrack.value = null; return }

    const base = await serverBase()
    const local = !!(track as any).localPath
    // Local library files play whole (the DJ view previews the real file).
    if (local) windowLength.value = 24 * 3600
    const attempts: Array<{ el: HTMLAudioElement | null; src: string; meters: boolean }> = local
      ? [{ el: ensureMeterGraph(), src: url, meters: true }]
      : [
          { el: ensureMeterGraph(), src: `${base}/api/preview/stream?url=${encodeURIComponent(url)}`, meters: true },
          { el: ensurePlain(), src: url, meters: false }
        ]
    for (const a of attempts) {
      if (!a.el || token !== playToken) continue
      active = a.el
      applyVolume()
      a.el.src = a.src
      try {
        await waitForMeta(a.el)
        if (token !== playToken) return
        const d = a.el.duration
        if ((track as any).source === 'qobuz' && isFinite(d) && d > 45) {
          windowStart.value = Math.min(d * 0.25, 60)
          a.el.currentTime = windowStart.value
        } else if (isFinite(d) && d > 0) {
          windowLength.value = (track as any).source === 'qobuz' && !local ? Math.min(QOBUZ_PREVIEW_SECONDS, d) : d
        }
        if (a.meters && ctx?.state === 'suspended') await ctx.resume()
        metersLive.value = a.meters
        await a.el.play()
        return
      } catch {
        a.el.removeAttribute('src')
        a.el.load()
      }
    }
    if (token === playToken) { isLoading.value = false; currentTrack.value = null; active = null }
  }

  // Click on a row: same track toggles, another track starts. A list passed
  // as queue enables next/previous in the floating player.
  async function play(track: Track, list?: Track[]) {
    if (list && list.length) queue.value = list.slice(0, 500)
    else if (!queue.value.some(t => t.id === track.id)) queue.value = [track]
    if (currentTrack.value?.id === track.id && active) {
      toggle()
      return
    }
    await start(track)
  }

  function toggle() {
    if (!active || !currentTrack.value) return
    if (active.paused) {
      if (ctx?.state === 'suspended') ctx.resume()
      active.play().catch(() => {})
    } else {
      active.pause()
    }
  }

  function pause() { active?.pause() }

  function seek(seconds: number) {
    if (!active) return
    const t = windowStart.value + Math.max(0, Math.min(length.value - 0.05, seconds))
    active.currentTime = t
    currentTime.value = t
  }

  function next() { if (hasNext.value) start(queue.value[queueIndex.value + 1]) }
  function prev() {
    if (position.value > 3 || !hasPrev.value) { seek(0); return }
    start(queue.value[queueIndex.value - 1])
  }

  function onEnded() {
    if (hasNext.value) { next(); return }
    active?.pause()
    isPlaying.value = false
    seek(0)
  }

  function setVolume(v: number) {
    const s = useSettingsStore()
    s.settings.previewVolume = Math.max(0, Math.min(100, Math.round(v)))
    applyVolume()
  }

  // Halts playback but keeps the player open.
  function halt() {
    for (const el of [meterEl, plainEl]) if (el) { el.pause() }
    isPlaying.value = false
  }

  // Closes the floating player.
  function stop() {
    playToken++
    halt()
    active = null
    currentTrack.value = null
    isLoading.value = false
    currentTime.value = 0
    metersLive.value = false
  }

  // Peak level per channel, 0..1, for the VU meters.
  const buf = new Float32Array(1024)
  function levels(): [number, number] {
    if (!analysers || !metersLive.value || !isPlaying.value) return [0, 0]
    const out: number[] = []
    for (const a of analysers) {
      a.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      out.push(Math.sqrt(sum / buf.length))
    }
    return [out[0], out[1]]
  }

  function isTrackPlaying(trackId: number | string): boolean {
    return isPlaying.value && currentTrack.value?.id === trackId
  }

  return {
    currentTrack, isPlaying, isLoading, currentTrackId, currentTime, duration,
    position, length, queue, hasNext, hasPrev, metersLive,
    play, toggle, pause, seek, next, prev, stop, setVolume, levels, isTrackPlaying
  }
})
