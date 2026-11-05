import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          define: {
            // Public Supabase project settings for Garimpo accounts. Empty
            // values run the app in development mode (no login).
            __GARIMPO_SUPABASE_URL__: JSON.stringify(process.env.GARIMPO_SUPABASE_URL || ''),
            __GARIMPO_SUPABASE_ANON_KEY__: JSON.stringify(process.env.GARIMPO_SUPABASE_ANON_KEY || ''),
            __GARIMPO_RELEASES_REPO__: JSON.stringify(process.env.GARIMPO_RELEASES_REPO || 'diegocostadf/garimpo'),
            __GARIMPO_APPLE_TEAM_ID__: JSON.stringify(process.env.GARIMPO_APPLE_TEAM_ID || '')
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: 'dist-electron'
          }
        }
      }
    ]),
    renderer()
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  }
})
