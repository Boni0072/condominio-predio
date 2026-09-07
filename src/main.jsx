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
//
// IMPORTANTE: existe apenas UM service worker no app (/sw.js). Ele cuida do
// cache do PWA E das notificações push do Firebase ao mesmo tempo (veja
// src/sw.js). Antes havia um segundo registro para "firebase-messaging-sw.js"
// no mesmo escopo "/" — dois SWs disputando o mesmo escopo faz o navegador
// descartar um deles a cada atualização, e era por isso que as notificações
// paravam de chegar com o app fechado. NÃO registre outro SW além deste.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    if (import.meta.env.DEV) {
      // Em desenvolvimento, desregistra SWs antigos para evitar cache velho.
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const reg of regs) reg.unregister()
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } else {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
        console.log('[SW] Service Worker único registrado (PWA + Push):', registration.scope)
      } catch (err) {
        console.warn('[SW] Falha ao registrar Service Worker:', err)
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
