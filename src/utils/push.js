// Utilidade de Web Push via Firebase Cloud Messaging (FCM)
// Funciona mesmo com o app FECHADO no celular, pois o push é enviado
// pelo servidor FCM e exibido pelo service worker (firebase-messaging-sw.js).

import { getToken, onMessage } from 'firebase/messaging'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { messaging, FCM_VAPID_KEY, FCM_SERVER_KEY, app } from '../firebase/config.js'

const PREFIX_TOKEN = 'condo_fcm_token_'
let funcoes = null

function obterFuncoes() {
  if (!funcoes) funcoes = getFunctions(app)
  return funcoes
}

export function pushConfigurado() {
  return Boolean(FCM_VAPID_KEY && FCM_VAPID_KEY !== 'SUA_VAPID_KEY_AQUI')
}

// Registra o service worker do FCM (uma vez)
export async function registrarServiceWorkerFCM() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', { scope: '/' })
    return reg
  } catch (err) {
    console.warn('[PUSH] Falha ao registrar SW do FCM:', err)
    return null
  }
}

// Gera (ou reutiliza) o token FCM deste dispositivo
export async function obterTokenFCM() {
  if (!pushConfigurado() || !('serviceWorker' in navigator)) return null
  try {
    const registration = await registrarServiceWorkerFCM()
    const atual = localStorage.getItem(PREFIX_TOKEN)
    if (atual) return atual

    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration || undefined
    })
    if (token) {
      localStorage.setItem(PREFIX_TOKEN, token)
      return token
    }
    return null
  } catch (err) {
    console.warn('[PUSH] Erro ao obter token FCM:', err)
    return null
  }
}

// Limpa o token salvo deste dispositivo (logout)
export function limparTokenFCM() {
  localStorage.removeItem(PREFIX_TOKEN)
}

// Salva o token do usuário no Firestore (dentro do tenant), para a portaria
// conseguir notificar o morador.
export async function salvarTokenUsuario(tenantId, userUid, info = {}) {
  const token = await obterTokenFCM()
  if (!token || !tenantId || !userUid) return null
  try {
    const { doc, setDoc } = await import('firebase/firestore')
    const { db } = await import('../firebase/config.js')
    await setDoc(doc(db, 'tenants', tenantId, 'pushTokens', userUid), {
      token,
      uid: userUid,
      dispositivo: info.dispositivo || 'desconhecido',
      atualizadoEm: new Date().toISOString()
    }, { merge: true })
    return token
  } catch (err) {
    console.warn('[PUSH] Erro ao salvar token no Firestore:', err)
    return null
  }
}

// Envia push para todos os dispositivos de um tenant.
// Caminho principal: Cloud Function (FCM v1 via Admin SDK) — não precisa de
// "Server key". Fallback: API legada do FCM (só funciona com chave AAAA...).
export async function enviarPushTenant(tenantId, titulo, corpo, url = '/') {
  if (!pushConfigurado() || !tenantId) return false

  // 1) Cloud Function — método moderno e seguro (valida tenant no servidor)
  try {
    const enviar = httpsCallable(obterFuncoes(), 'enviarNotificacao')
    const resultado = await enviar({ titulo, corpo, url })
    const dados = resultado?.data || {}
    if (dados.enviados > 0) return true
    // Sem tokens registrados ainda — nada a enviar
    if (dados.enviados === 0 && (dados.totalTokens === 0 || dados.falhas === 0)) return false
  } catch (err) {
    console.warn('[PUSH] Cloud Function falhou, tentando API legada:', err?.message || err)
  }

  // 2) Fallback: API legada (apenas se existir uma Server key válida)
  if (String(FCM_SERVER_KEY || '').startsWith('AAAA')) {
    try {
      const { collection, getDocs } = await import('firebase/firestore')
      const { db } = await import('../firebase/config.js')

      const snapshot = await getDocs(collection(db, 'tenants', tenantId, 'pushTokens'))
      const tokens = snapshot.docs.map((d) => d.data().token).filter(Boolean)
      if (tokens.length === 0) return false

      const respostas = await Promise.all(tokens.map((token) => enviarPushParaToken(token, titulo, corpo, url)))
      return respostas.some(Boolean)
    } catch (err) {
      console.warn('[PUSH] Erro ao enviar push do tenant:', err)
      return false
    }
  }

  return false
}

// Envia o push diretamente para um token via API legada do FCM
export async function enviarPushParaToken(token, titulo, corpo, url = '/') {
  if (!pushConfigurado() || !token) return false
  try {
    const resposta = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${FCM_SERVER_KEY}`
      },
      body: JSON.stringify({
        to: token,
        notification: { title: titulo, body: corpo, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' },
        data: { url, titulo, corpo }
      })
    })
    if (!resposta.ok) {
      console.warn('[PUSH] FCM respondeu', resposta.status, await resposta.text())
      return false
    }
    return true
  } catch (err) {
    console.warn('[PUSH] Erro no envio FCM:', err)
    return false
  }
}

// Notificação de nova encomenda para o tenant
export async function notificarEncomendaPush(tenantId, encomenda) {
  const titulo = '📦 Nova encomenda recebida'
  const corpo = `${encomenda.destinatario || ''}${encomenda.unidade ? ' · ' + encomenda.unidade : ''}${encomenda.transportadora ? ' · ' + encomenda.transportadora : ''}`.trim() || 'Nova encomenda na portaria'
  return enviarPushTenant(tenantId, titulo, corpo, '/#/portaria/encomendas')
}

// Notificação de novo visitante para o tenant
export async function notificarVisitantePush(tenantId, visitante) {
  const titulo = '👤 Visitante na portaria'
  const corpo = `${visitante.nome || ''}${visitante.unidade ? ' · ' + visitante.unidade : ''}${visitante.motivo ? ' · ' + visitante.motivo : ''}`.trim() || 'Visitante na portaria'
  return enviarPushTenant(tenantId, titulo, corpo, '/#/portaria/visitantes')
}

// Listener para notificação em primeiro plano (app aberto)
export function ativarListenerFrente() {
  if (!pushConfigurado()) return () => {}
  try {
    return onMessage(messaging, (payload) => {
      const dados = payload?.data || {}
      const titulo = dados.titulo || payload?.notification?.title || 'Nova notificação'
      const corpo = dados.corpo || payload?.notification?.body || ''
      if (Notification.permission === 'granted') {
        new Notification(titulo, { body: corpo, icon: '/icons/icon-192.png' })
      }
    })
  } catch (err) {
    console.warn('[PUSH] Erro no listener foreground:', err)
    return () => {}
  }
}