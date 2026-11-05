import { describe, expect, test } from 'bun:test'
import { effectiveQuality, isAllowed, qualityLabel } from '../src/composables/useQuality'

describe('download quality rules', () => {
  test('free account (max 128) caps every choice to MP3 128', () => {
    expect(effectiveQuality('flac', '128')).toBe('128')
    expect(effectiveQuality('320', '128')).toBe('128')
    expect(effectiveQuality('128', '128')).toBe('128')
    expect(isAllowed('320', '128')).toBe(false)
    expect(isAllowed('flac', '128')).toBe(false)
  })
  test('premium (max 320) allows 128 and 320, caps FLAC', () => {
    expect(effectiveQuality('flac', '320')).toBe('320')
    expect(effectiveQuality('128', '320')).toBe('128')
    expect(isAllowed('flac', '320')).toBe(false)
  })
  test('hifi keeps the choice; logged out keeps the choice', () => {
    expect(effectiveQuality('flac', 'flac')).toBe('flac')
    expect(effectiveQuality('128', 'flac')).toBe('128')
    expect(effectiveQuality('flac', null)).toBe('flac')
  })
  test('labels', () => {
    expect(qualityLabel('128')).toBe('MP3 128')
    expect(qualityLabel('320')).toBe('MP3 320')
    expect(qualityLabel('flac')).toBe('FLAC')
  })
})
