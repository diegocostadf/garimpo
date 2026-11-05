<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUpdateStore } from '../stores/updateStore'

const { t } = useI18n()
const updateStore = useUpdateStore()
const status = computed(() => updateStore.status)

// Release notes are markdown from the release, shown as plain text: never rendered as HTML.
const notes = computed(() => (status.value.notes ?? '')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^[-*]\s+/gm, '• ')
  .replace(/\*\*(.+?)\*\*/g, '$1')
  .replace(/\[(.+?)\]\(.+?\)/g, '$1')
  .trim())

const manualNote = computed(() => {
  switch (status.value.manualReason) {
    case 'readonly': return t('updates.manualReadonly')
    case 'unsupported': return t('updates.manualUnsupported')
    case 'failed': return t('updates.manualFailed', { error: status.value.error ?? '' })
    default: return ''
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="updateStore.dialogOpen"
      class="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
    >
      <div
        class="bg-background-secondary border border-line-strong rounded-[28px] shadow-2xl max-w-lg w-full overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
      >
        <!-- Offer -->
        <template v-if="status.state === 'available'">
          <div class="px-6 pt-6 pb-4 space-y-3">
            <h2 id="update-dialog-title" class="font-display !text-[22px] text-foreground">{{ t('updates.dialogTitle') }}</h2>
            <p class="text-sm text-foreground-muted">
              {{ t('updates.dialogBody', { version: status.latest ?? '', current: status.current }) }}
            </p>
            <p v-if="manualNote" class="text-sm text-primary-400">{{ manualNote }}</p>
            <div v-if="notes">
              <p class="text-xs uppercase tracking-wide text-foreground-muted mb-1">{{ t('updates.whatsNew') }}</p>
              <div class="max-h-56 overflow-y-auto text-sm text-foreground whitespace-pre-wrap border border-line rounded-[16px] p-3">{{ notes }}</div>
            </div>
          </div>
          <div class="px-6 py-4 flex flex-wrap items-center justify-end gap-3 border-t border-line">
            <button class="mr-auto h-10 px-3 font-mono text-[11px] uppercase text-foreground-muted hover:text-foreground transition-colors" @click="updateStore.skip()">
              {{ t('updates.skip') }}
            </button>
            <button class="h-10 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase text-foreground hover:bg-hover transition-colors" @click="updateStore.later()">
              {{ t('updates.later') }}
            </button>
            <button class="h-10 px-5 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600 transition-colors" @click="updateStore.updateNow()">
              {{ status.manualReason ? t('updates.downloadUpdate') : t('updates.updateNow') }}
            </button>
          </div>
        </template>

        <!-- Downloading -->
        <template v-else-if="status.state === 'downloading'">
          <div class="px-6 pt-6 pb-4 space-y-3">
            <h2 id="update-dialog-title" class="font-display !text-[22px] text-foreground">{{ t('updates.dialogTitle') }}</h2>
            <p class="text-sm text-foreground-muted">{{ t('updates.downloading', { percent: status.progress ?? 0 }) }}</p>
            <div class="h-1.5 rounded-full overflow-hidden bg-hover">
              <div class="h-full bg-primary-500 transition-all" :style="{ width: `${status.progress ?? 0}%` }"></div>
            </div>
          </div>
          <div class="px-6 py-4 flex justify-end border-t border-line">
            <button class="h-10 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase text-foreground hover:bg-hover transition-colors" @click="updateStore.dialogOpen = false">
              {{ t('updates.hide') }}
            </button>
          </div>
        </template>

        <!-- Ready -->
        <template v-else-if="status.state === 'ready'">
          <div class="px-6 pt-6 pb-4 space-y-3">
            <h2 id="update-dialog-title" class="font-display !text-[22px] text-foreground">{{ t('updates.dialogTitle') }}</h2>
            <p class="text-sm text-foreground-muted">{{ t(status.opensInstaller ? 'updates.readyInstaller' : 'updates.ready', { version: status.latest ?? '' }) }}</p>
            <p v-if="status.busy" class="text-sm text-primary-400">{{ t('updates.busyWarning') }}</p>
          </div>
          <div class="px-6 py-4 flex justify-end gap-3 border-t border-line">
            <button class="h-10 px-5 rounded-full border border-line-strong font-mono text-[11px] uppercase text-foreground hover:bg-hover transition-colors" @click="updateStore.restartLater()">
              {{ t('updates.restartLater') }}
            </button>
            <button class="h-10 px-5 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase hover:bg-primary-600 transition-colors" @click="updateStore.updateNow()">
              {{ status.opensInstaller ? t('updates.openInstaller') : t('updates.restartNow') }}
            </button>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
