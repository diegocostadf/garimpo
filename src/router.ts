import { useAccountStore, type ModuleId } from './stores/accountStore'
import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue')
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('./views/SearchView.vue')
    },
    {
      path: '/downloads',
      name: 'downloads',
      component: () => import('./views/DownloadsView.vue')
    },
    {
      path: '/favorites',
      name: 'favorites',
      component: () => import('./views/FavoritesView.vue')
    },
    {
      path: '/analyzer',
      name: 'analyzer',
      component: () => import('./views/LinkAnalyzerView.vue')
    },
    {
      path: '/sync',
      name: 'sync',
      component: () => import('./views/SyncView.vue')
    },
    {
      path: '/convert',
      name: 'convert',
      meta: { module: 'converter' },
      component: () => import('./views/ConverterView.vue')
    },
    {
      path: '/dj',
      name: 'dj',
      meta: { module: 'dj' },
      component: () => import('./views/DjView.vue')
    },
    {
      path: '/retag',
      name: 'retag',
      component: () => import('./views/RetagView.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue')
    },
    {
      path: '/about',
      name: 'about',
      redirect: { path: '/settings', query: { tab: 'about' } }
    },
    {
      path: '/artist/:id',
      name: 'artist',
      component: () => import('./views/ArtistView.vue')
    },
    {
      path: '/album/:id',
      name: 'album',
      component: () => import('./views/AlbumView.vue')
    },
    {
      path: '/playlist/:id',
      name: 'playlist',
      component: () => import('./views/PlaylistView.vue')
    },
    {
      // A Deezer playlist creator's public playlists (#135)
      path: '/user/:id',
      name: 'user-playlists',
      component: () => import('./views/UserPlaylistsView.vue')
    },
    {
      path: '/charts',
      name: 'charts',
      component: () => import('./views/ChartsView.vue')
    },
    {
      path: '/new-releases',
      name: 'new-releases',
      component: () => import('./views/NewReleasesView.vue')
    },
    {
      path: '/qobuz',
      name: 'qobuz',
      meta: { module: 'qobuz' },
      component: () => import('./views/QobuzView.vue')
    },
    {
      path: '/qobuz/feed',
      name: 'qobuz-feed',
      meta: { module: 'qobuz' },
      component: () => import('./views/QobuzFeedView.vue')
    },
    {
      path: '/genres',
      name: 'genres',
      component: () => import('./views/GenresView.vue')
    },
    {
      path: '/locked',
      name: 'locked',
      component: () => import('./views/LockedView.vue')
    },
    {
      // Catch-all: redirect unknown routes to home
      path: '/:pathMatch(.*)*',
      redirect: '/'
    }
  ]
})

// Paid modules: send the user to the explanation page when the Garimpo
// account does not include the module. Each opened module is logged.
router.beforeEach(to => {
  const mod = to.meta?.module as ModuleId | undefined
  if (!mod) return true
  const account = useAccountStore()
  if (!account.has(mod)) return { path: '/locked', query: { module: mod } }
  account.logModule(mod)
  return true
})

export default router
