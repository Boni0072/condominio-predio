import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { AppProvider } from './context/AppContext.jsx'
import './index.css'
import { iniciarTema } from './utils/tema.js'

// Aplica o tema de cores salvo neste dispositivo antes da primeira renderização.
iniciarTema()

// Registro do Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (import.meta.env.DEV) {
      // Em desenvolvimento, desregistra SWs antigos — mas preserva o SW do FCM,
      // senão o registro de push é invalidado a cada recarga.
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const reg of regs) {
        const swUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || ''
        if (swUrl.includes('firebase-messaging-sw.js')) continue
        reg.unregister()
      }
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } else {
      // Em produção, registra o SW do PWA (gerado pelo vite-plugin-pwa)
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        console.log('[SW] Service Worker registrado:', registration.scope)
      } catch (err) {
        console.warn('[SW] Falha ao registrar Service Worker:', err)
      }
      // Registra o SW do Firebase Cloud Messaging (notificações push mesmo com app fechado)
      try {
        import('./utils/push.js').then(({ registrarServiceWorkerFCM }) => registrarServiceWorkerFCM())
      } catch (err) {
        console.warn('[PUSH] Falha ao carregar registro do FCM:', err)
      }
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppProvider>
          <App />
        </AppProvider>
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>
)
