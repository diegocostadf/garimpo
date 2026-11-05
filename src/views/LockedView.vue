<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useAccountStore } from '../stores/accountStore'

// Shown when the Garimpo account does not include a module.
const { t } = useI18n()
const route = useRoute()
const account = useAccountStore()
const mod = computed(() => String(route.query.module || 'converter'))
</script>

<template>
  <div class="max-w-[640px] flex flex-col gap-6">
    <span class="font-mono text-[11px] uppercase text-primary-400">{{ t('account.lockedLabel') }}</span>
    <h1 class="font-display">{{ t(`account.modules.${mod}`) }}</h1>
    <p class="text-foreground-muted text-lg leading-relaxed">{{ t('account.lockedBody', { plan: account.state.profile?.plan || '—' }) }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="button" @click="account.refresh()" class="h-12 px-6 rounded-full bg-primary-500 text-white font-mono text-[11px] uppercase">{{ t('account.checkAgain') }}</button>
      <router-link to="/settings?tab=accounts" class="h-12 px-6 rounded-full border border-line-strong font-mono text-[11px] uppercase flex items-center hover:bg-hover">{{ t('account.seeAccount') }}</router-link>
    </div>
  </div>
</template>
