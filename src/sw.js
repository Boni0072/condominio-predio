// Service Worker ÚNICO do app.
//
// Antes existiam DOIS service workers registrados no mesmo escopo ("/"):
// o gerado pelo vite-plugin-pwa (sw.js) e o do Firebase (firebase-messaging-sw.js).
// O navegador só mantém UM worker "dono" de cada escopo — então a cada
// atualização um substituía o outro, e é por isso que as notificações push
// paravam de chegar quando o app estava fechado.
//
// Agora só existe ESTE arquivo. Ele cuida do cache do PWA (via workbox,
// injetado automaticamente pelo build) E recebe as notificações push do
// Firebase em segundo plano.

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

// ---------- 1. Cache do PWA (gerado pelo build) ----------
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
  // Permite disparar notificação manualmente a partir do app (ex: teste em primeiro plano)
  if (event.data && event.data.type === 'NOTIFICACAO') {
    const { titulo, opcoes } = event.data
    self.registration.showNotification(titulo, {
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'pt-BR',
      ...opcoes
    })
  }
})

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// ---------- 2. Firebase Cloud Messaging (push em segundo plano) ----------
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey: 'AIzaSyCNmyvumG0-8Vgdg5nQb-hRT6U5ZbHv9IA',
  authDomain: 'portaria-condominio-8fbc9.firebaseapp.com',
  projectId: 'portaria-condominio-8fbc9',
  storageBucket: 'portaria-condominio-8fbc9.firebasestorage.app',
  messagingSenderId: '494676520919',
  appId: '1:494676520919:web:796b6d6fa17fe8b11b2592'
})

const messaging = firebase.messaging()

// Notificação recebida com o app FECHADO ou em segundo plano
messaging.onBackgroundMessage((payload) => {
  const dados = payload?.data || {}
  const titulo = dados.titulo || payload?.notification?.title || 'Nova notificação'
  const corpo = dados.corpo || payload?.notification?.body || ''
  const url = dados.url || '/'

  const opcoes = {
    body: corpo,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'pt-BR',
    renotify: true,
    tag: 'condominio-notificacao',
    data: { url }
  }

  return self.registration.showNotification(titulo, opcoes)
})

// Clique na notificação (com app aberto, em segundo plano, ou fechado)
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.postMessage({ type: 'NAVEGAR', url })
          return
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })
  )
})