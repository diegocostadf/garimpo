import { defineStore } from 'pinia'
import { ref } from 'vue'

// Which connection assistant is open. App.vue mounts both wizards once, and
// any screen (sidebar, settings, an empty state) opens them through here.
export const useWizardStore = defineStore('wizard', () => {
  const deezerOpen = ref(false)
  const spotifyOpen = ref(false)

  function openDeezer() { deezerOpen.value = true }
  function openSpotify() { spotifyOpen.value = true }
  function closeAll() {
    deezerOpen.value = false
    spotifyOpen.value = false
  }

  return { deezerOpen, spotifyOpen, openDeezer, openSpotify, closeAll }
})
