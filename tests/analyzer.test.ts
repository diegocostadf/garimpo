import { describe, expect, test } from 'bun:test'
import { analyzePcm, camelotFromKey, estimateKey } from '../src/analysis/analyzer'

const SR = 44100

function synth(bpm: number, notes: number[], seconds = 40, kick = true): Float32Array {
  const n = SR * seconds
  const x = new Float32Array(n)
  const beat = (60 / bpm) * SR
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let v = 0
    for (const m of notes) {
      const f = 440 * Math.pow(2, (m - 69) / 12)
      v += 0.08 * Math.sin(2 * Math.PI * f * t) + 0.03 * Math.sin(4 * Math.PI * f * t)
    }
    if (kick) {
      const pos = i % beat
      const tb = pos / SR
      v += 0.8 * Math.exp(-tb * 25) * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tb * 40)) * tb)
      const off = (i + beat / 2) % beat
      v += 0.15 * Math.exp(-(off / SR) * 120) * rnd()
    }
    x[i] = v
  }
  return x
}

describe('analyzer', () => {
  test('finds 128 BPM and A minor (8A)', () => {
    const pcm = synth(128, [57, 60, 64, 69, 45])
    const r = analyzePcm([pcm, pcm], SR)
    expect(Math.abs(r.bpm - 128)).toBeLessThan(1.2)
    expect(r.camelot).toBe('8A')
    expect(r.energy).toBeGreaterThanOrEqual(1)
    expect(r.energy).toBeLessThanOrEqual(10)
  })

  test('finds 94 BPM and C major (8B)', () => {
    const pcm = synth(94, [48, 60, 64, 67, 72])
    const r = analyzePcm([pcm], SR)
    expect(Math.abs(r.bpm - 94)).toBeLessThan(1.2)
    expect(r.camelot).toBe('8B')
  })

  test('finds 174 BPM drum and bass', () => {
    const pcm = synth(174, [50, 53, 57], 30)
    const r = analyzePcm([pcm], SR)
    expect(Math.abs(r.bpm - 174)).toBeLessThan(1.5)
  })

  test('quiet ambient rates lower energy than a loud club track', () => {
    const quiet = synth(120, [60, 64, 67], 30, false).map(v => v * 0.2) as Float32Array
    const loud = synth(128, [57, 60, 64], 30).map(v => v * 1.2) as Float32Array
    expect(analyzePcm([quiet], SR).energy).toBeLessThan(analyzePcm([loud], SR).energy)
  })

  test('camelot mapping', () => {
    expect(camelotFromKey('Am')).toBe('8A')
    expect(camelotFromKey('C')).toBe('8B')
    expect(camelotFromKey('F#m')).toBe('11A')
    expect(camelotFromKey('Bb')).toBe('6B')
    expect(camelotFromKey('Ebm')).toBe('2A')
    expect(estimateKey([0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0]).camelot).toBe('7A')
  })
})
