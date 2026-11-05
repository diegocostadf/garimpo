// Track analysis for DJs: tempo (BPM), musical key in Camelot notation and an
// energy rating from 1 to 10. Pure functions over mono PCM so it runs in a
// Web Worker and in unit tests.

export interface AnalysisResult {
  bpm: number
  key: string // musical, e.g. "Am", "F#"
  camelot: string // e.g. "8A"
  energy: number // 1..10
  confidence: { bpm: number; key: number }
}

const FRAME = 2048
const HOP = 512

// ---------- FFT (radix-2, in place) ----------

function makeFft(n: number) {
  const levels = Math.log2(n)
  const rev = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    let x = i, y = 0
    for (let b = 0; b < levels; b++) { y = (y << 1) | (x & 1); x >>= 1 }
    rev[i] = y
  }
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n) }
  return (re: Float64Array, im: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const tr = re[j + half] * cos[k] + im[j + half] * sin[k]
          const ti = -re[j + half] * sin[k] + im[j + half] * cos[k]
          re[j + half] = re[j] - tr; im[j + half] = im[j] - ti
          re[j] += tr; im[j] += ti
        }
      }
    }
  }
}

// ---------- helpers ----------

/** Average channels and pick an analysis window (middle of the song, max 120 s). */
export function prepareMono(channels: Float32Array[], sampleRate: number, maxSeconds = 120): Float32Array {
  const len = channels[0]?.length || 0
  const want = Math.min(len, Math.floor(maxSeconds * sampleRate))
  const start = Math.max(0, Math.floor((len - want) / 2))
  const out = new Float32Array(want)
  for (const ch of channels) for (let i = 0; i < want; i++) out[i] += ch[start + i] / channels.length
  return out
}

/** Decimate by an integer factor with a simple moving-average low-pass. */
export function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x
  const out = new Float32Array(Math.floor(x.length / factor))
  for (let i = 0; i < out.length; i++) {
    let s = 0
    for (let j = 0; j < factor; j++) s += x[i * factor + j]
    out[i] = s / factor
  }
  return out
}

// ---------- spectral pass ----------

interface Spectral {
  flux: Float64Array // onset strength per frame
  chroma: Float64Array // 12 bins
  rmsDb: number
  brightness: number // share of energy above 4 kHz
  frameRate: number
}

function spectralPass(x: Float32Array, sr: number): Spectral {
  const fft = makeFft(FRAME)
  const win = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
  const frames = Math.max(0, Math.floor((x.length - FRAME) / HOP))
  const re = new Float64Array(FRAME)
  const im = new Float64Array(FRAME)
  const bins = FRAME / 2
  let prev = new Float64Array(bins)
  let cur = new Float64Array(bins)
  const flux = new Float64Array(frames)
  const chroma = new Float64Array(12)

  // Precompute pitch class per bin for 55 Hz .. 5 kHz.
  const pc = new Int8Array(bins).fill(-1)
  for (let k = 1; k < bins; k++) {
    const f = (k * sr) / FRAME
    if (f < 55 || f > 5000) continue
    const midi = 69 + 12 * Math.log2(f / 440)
    pc[k] = ((Math.round(midi) % 12) + 12) % 12
  }
  const hiBin = Math.floor((4000 * FRAME) / sr)

  let sumSq = 0
  let hiE = 0
  let allE = 0
  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    for (let i = 0; i < FRAME; i++) { const v = x[off + i]; re[i] = v * win[i]; im[i] = 0 }
    for (let i = 0; i < HOP; i++) { const v = x[off + i]; sumSq += v * v }
    fft(re, im)
    let fl = 0
    for (let k = 1; k < bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k]
      const mag = Math.sqrt(p)
      const lm = Math.log1p(100 * mag)
      cur[k] = lm
      const d = lm - prev[k]
      if (d > 0) fl += d
      allE += p
      if (k >= hiBin) hiE += p
      if (pc[k] >= 0) chroma[pc[k]] += mag
    }
    flux[f] = fl
    const t = prev; prev = cur; cur = t
  }
  const rms = Math.sqrt(sumSq / Math.max(1, frames * HOP))
  return {
    flux,
    chroma,
    rmsDb: 20 * Math.log10(rms + 1e-9),
    brightness: allE > 0 ? hiE / allE : 0,
    frameRate: sr / HOP
  }
}

// ---------- tempo ----------

export function estimateTempo(flux: Float64Array, frameRate: number): { bpm: number; confidence: number; onsetRate: number } {
  const n = flux.length
  if (n < 64) return { bpm: 0, confidence: 0, onsetRate: 0 }
  // Remove the slow trend so only transients remain, then half-wave rectify.
  const env = new Float64Array(n)
  const w = Math.max(1, Math.round(frameRate * 0.5))
  let acc = 0
  for (let i = 0; i < n; i++) {
    acc += flux[i]
    if (i >= w) acc -= flux[i - w]
    const mean = acc / Math.min(i + 1, w)
    env[i] = Math.max(0, flux[i] - mean)
  }
  let mean = 0
  for (let i = 0; i < n; i++) mean += env[i]
  mean /= n
  let onsets = 0
  for (let i = 1; i < n - 1; i++) if (env[i] > env[i - 1] && env[i] >= env[i + 1] && env[i] > mean * 2) onsets++

  const minLag = Math.floor((60 / 200) * frameRate)
  const maxLag = Math.ceil((60 / 60) * frameRate)
  const ac = new Float64Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0
    for (let i = lag; i < n; i++) s += env[i] * env[i - lag]
    ac[lag] = s / (n - lag)
  }
  // Score each lag together with its multiples (comb), weighted toward
  // dance-music tempos around 120 BPM.
  let best = 0
  let bestScore = -1
  let total = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * frameRate) / lag
    let s = ac[lag]
    if (2 * lag <= maxLag + 1) s += 0.5 * ac[2 * lag]
    if (Math.round(lag / 2) >= minLag) s += 0.25 * ac[Math.round(lag / 2)]
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2))
    s *= prior
    total += Math.max(0, s)
    if (s > bestScore) { bestScore = s; best = lag }
  }
  if (!best) return { bpm: 0, confidence: 0, onsetRate: onsets / (n / frameRate) }
  // Parabolic interpolation around the peak for sub-frame precision.
  const a = ac[best - 1] ?? ac[best]
  const b = ac[best]
  const c = ac[best + 1] ?? ac[best]
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0
  let bpm = (60 * frameRate) / (best + shift)
  // Fold into the usual DJ range.
  while (bpm < 75) bpm *= 2
  while (bpm > 180) bpm /= 2
  const confidence = total > 0 ? Math.min(1, (bestScore / total) * 12) : 0
  return { bpm: Math.round(bpm * 10) / 10, confidence, onsetRate: onsets / (n / frameRate) }
}

// ---------- key ----------

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
// Krumhansl-Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
// Camelot wheel numbers indexed by tonic pitch class.
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1]
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10]

function corr(a: number[], b: number[]) {
  const ma = a.reduce((s, v) => s + v, 0) / a.length
  const mb = b.reduce((s, v) => s + v, 0) / b.length
  let num = 0, da = 0, db = 0
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  return da && db ? num / Math.sqrt(da * db) : 0
}

export function estimateKey(chroma: ArrayLike<number>): { key: string; camelot: string; confidence: number } {
  const c = Array.from(chroma)
  const scores: Array<{ key: string; camelot: string; r: number }> = []
  for (let tonic = 0; tonic < 12; tonic++) {
    const rotated = c.slice(tonic).concat(c.slice(0, tonic))
    scores.push({ key: NOTES[tonic], camelot: `${CAMELOT_MAJOR[tonic]}B`, r: corr(rotated, MAJOR) })
    scores.push({ key: `${NOTES[tonic]}m`, camelot: `${CAMELOT_MINOR[tonic]}A`, r: corr(rotated, MINOR) })
  }
  scores.sort((x, y) => y.r - x.r)
  const best = scores[0]
  const confidence = Math.max(0, Math.min(1, (best.r - scores[1].r) * 8 + best.r * 0.5))
  return { key: best.key, camelot: best.camelot, confidence }
}

export function camelotFromKey(key: string): string {
  const m = /^([A-G][#b]?)(m|min|minor)?$/i.exec(key.trim())
  if (!m) return ''
  const flats: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' }
  const note = flats[m[1]] || m[1].toUpperCase().replace('B#', 'C')
  const i = NOTES.indexOf(note)
  if (i < 0) return ''
  return m[2] ? `${CAMELOT_MINOR[i]}A` : `${CAMELOT_MAJOR[i]}B`
}

// ---------- energy ----------

export function estimateEnergy(rmsDb: number, onsetRate: number, brightness: number, bpm: number): number {
  const clamp = (v: number) => Math.max(0, Math.min(1, v))
  const loud = clamp((rmsDb + 28) / 20) // -28 dBFS .. -8 dBFS
  const dens = clamp(onsetRate / 6) // onsets per second
  const bright = clamp(brightness / 0.12)
  const tempo = clamp((bpm - 80) / 70)
  const score = 0.4 * loud + 0.25 * dens + 0.2 * bright + 0.15 * tempo
  return Math.max(1, Math.min(10, Math.round(1 + score * 9)))
}

// ---------- entry point ----------

export function analyzePcm(channels: Float32Array[], sampleRate: number): AnalysisResult {
  let mono = prepareMono(channels, sampleRate)
  let sr = sampleRate
  // Work at ~22 kHz: enough for tempo, key and the 4 kHz brightness split.
  const factor = Math.max(1, Math.floor(sr / 22050))
  if (factor > 1) { mono = decimate(mono, factor); sr = sr / factor }
  const sp = spectralPass(mono, sr)
  const tempo = estimateTempo(sp.flux, sp.frameRate)
  const key = estimateKey(sp.chroma)
  return {
    bpm: tempo.bpm,
    key: key.key,
    camelot: key.camelot,
    energy: estimateEnergy(sp.rmsDb, tempo.onsetRate, sp.brightness, tempo.bpm),
    confidence: { bpm: Math.round(tempo.confidence * 100) / 100, key: Math.round(key.confidence * 100) / 100 }
  }
}
