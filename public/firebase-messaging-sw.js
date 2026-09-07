// Service Worker do Firebase Cloud Messaging
// Este arquivo recebe notificações push mesmo com o app FECHADO
// e exibe a notificação no celular/tablet.

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

// Notificação recebida com o app fechado / em segundo plano
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
    data: { url }
  }

  return self.registration.showNotification(titulo, opcoes)
})

// Clique na notificação
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