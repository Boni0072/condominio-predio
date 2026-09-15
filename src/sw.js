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
//
// IMPORTANTE: o SDK do Firebase Messaging é EMBUTIDO no build a partir de
// 'firebase/compat/app' e 'firebase/compat/messaging'. Antes ele era carregado
// via importScripts() do CDN do Google NO MOMENTO DA INSTALAÇÃO do SW — se a
// rede do celular falhasse naquele instante, o Service Worker NÃO instalava,
// o app perdia o modo offline e NENHUMA notificação push chegava. Embutindo o
// SDK, o SW vira um arquivo único que instala em qualquer condição de rede.

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'
import firebase from 'firebase/compat/app'
import 'firebase/compat/messaging'

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
firebase.initializeApp({
  apiKey: 'AIzaSyCNmyvumG0-8Vgdg5nQb-hRT6U5ZbHv9IA',
  authDomain: 'portaria-condominio-8fbc9.firebaseapp.com',
  projectId: 'portaria-condominio-8fbc9',
  storageBucket: 'portaria-condominio-8fbc9.firebasestorage.app',
  messagingSenderId: '494676520919',
  appId: '1:494676520919:web:796b6d6fa17fe8b11b2592'
})

const messaging = firebase.messaging()

// Notificação recebida com o app FECHADO ou em segundo plano.
// A Cloud Function envia a mensagem SOMENTE com o bloco "data" (sem
// "notification"): quem renderiza a notificação é este onBackgroundMessage.
// Assim evitamos notificações duplicadas (FCM mostrando a dele + o SW a nossa)
// e ícones com URL relativa que alguns navegadores recusam quando a
// notificação "vem pronta" do FCM.
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
    // Tag ÚNICA por notificação: garante que TODAS as notificações cheguem e
    // emitam som/vibração. Uma tag fixa + renotify fazia o Android substituir
    // a notificação em silêncio — o usuário achava que "não chegou nada".
    tag: `condominio-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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