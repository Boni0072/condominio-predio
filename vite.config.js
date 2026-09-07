import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'firebase-messaging-sw.js'],
      manifest: {
        id: '/',
        name: 'Portaria & Mural - Condomínio',
        short_name: 'Condomínio',
        description: 'Sistema de portaria digital e mural de comunicados do condomínio',
        lang: 'pt-BR',
        dir: 'ltr',
        theme_color: '#1C2B33',
        background_color: '#F3F4F1',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        categories: ['productivity', 'utilities'],
        shortcuts: [
          {
            name: 'Portaria',
            short_name: 'Portaria',
            description: 'Registro de visitantes e encomendas',
            url: '/#/portaria',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }]
          },
          {
            name: 'Mural de avisos',
            short_name: 'Mural',
            description: 'Comunicados do condomínio',
            url: '/#/mural',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192' }]
          }
        ],
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: 'index.html'
      },
      // Desabilita registro automático para usar SW customizado
      injectRegister: false,
      devOptions: {
        enabled: false
      }
    })
  ]
})
