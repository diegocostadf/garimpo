import type { AnalysisResult } from './analyzer'
import { apiBase } from '../utils/api'
import AnalyzerWorker from './analyzer.worker?worker&inline'

// Decodes a local file (resampled to 22.05 kHz by the browser decoder) and
// hands the PCM to a small pool of workers.
const SAMPLE_RATE = 22050
const POOL = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1))

interface Pending { resolve: (r: AnalysisResult) => void; reject: (e: Error) => void }
const workers: Worker[] = []
const pending = new Map<number, Pending>()
let nextId = 1
let rr = 0

function worker(): Worker {
  if (workers.length < POOL) {
    const w = new AnalyzerWorker()
    w.onmessage = (e: MessageEvent<{ id: number; result?: AnalysisResult; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.result) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error || 'analysis failed'))
    }
    workers.push(w)
    return w
  }
  return workers[rr++ % workers.length]
}

export async function analyzeFile(path: string): Promise<AnalysisResult & { duration: number }> {
  const res = await fetch(`${await apiBase()}/api/library/file?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE)
  const audio = await ctx.decodeAudioData(buf)
  const channels: Float32Array[] = []
  for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) channels.push(audio.getChannelData(c).slice())
  const id = nextId++
  const result = await new Promise<AnalysisResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker().postMessage({ id, channels, sampleRate: audio.sampleRate }, channels.map(c => c.buffer))
  })
  return { ...result, duration: audio.duration }
}
