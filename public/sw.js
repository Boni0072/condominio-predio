// Service Worker personalizado para notificações em segundo plano

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Recebe mensagens do app para disparar notificações
self.addEventListener('message', (event) => {
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

// Quando o usuário clica na notificação
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Se já tem uma janela aberta, foca nela
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.postMessage({ type: 'NAVEGAR', url })
          return
        }
      }
      // Se não tem janela aberta, abre uma nova
      if (self.clients.openWindow) {
        return self.clients.openWindow(url)
      }
    })
  )
})
