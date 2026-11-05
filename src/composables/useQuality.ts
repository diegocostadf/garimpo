import { computed } from 'vue'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'

export type Quality = '128' | '320' | 'flac'
const RANK: Record<Quality, number> = { '128': 1, '320': 2, flac: 3 }

export function qualityLabel(q: Quality): string {
  return q === 'flac' ? 'FLAC' : q === '320' ? 'MP3 320' : 'MP3 128'
}

/** The quality downloads really use: the one chosen in Settings, capped by
 *  what the signed-in Deezer account may download (free accounts: MP3 128). */
export function effectiveQuality(selected: Quality, accountMax: Quality | null): Quality {
  if (!accountMax) return selected
  return RANK[selected] <= RANK[accountMax] ? selected : accountMax
}

export function isAllowed(q: Quality, accountMax: Quality | null): boolean {
  return !accountMax || RANK[q] <= RANK[accountMax]
}

export function useQuality() {
  const auth = useAuthStore()
  const settings = useSettingsStore()
  const selected = computed(() => (settings.settings.quality || '320') as Quality)
  const accountMax = computed(() => (auth.isLoggedIn ? auth.maxQuality : null) as Quality | null)
  const effective = computed(() => effectiveQuality(selected.value, accountMax.value))
  const capped = computed(() => effective.value !== selected.value)
  return { selected, accountMax, effective, capped, label: computed(() => qualityLabel(effective.value)) }
}
