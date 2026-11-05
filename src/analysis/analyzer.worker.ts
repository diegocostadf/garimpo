import { analyzePcm } from './analyzer'

// Runs the DSP off the UI thread.
self.onmessage = (e: MessageEvent<{ id: number; channels: Float32Array[]; sampleRate: number }>) => {
  const { id, channels, sampleRate } = e.data
  try {
    const result = analyzePcm(channels, sampleRate)
    ;(self as any).postMessage({ id, result })
  } catch (err: any) {
    ;(self as any).postMessage({ id, error: err?.message || 'analysis failed' }) // i18n-exempt
  }
}
