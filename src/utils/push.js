// Utilidade de Web Push via Firebase Cloud Messaging (FCM)
// Funciona mesmo com o app FECHADO no celular, pois o push é enviado
// pelo servidor FCM e exibido pelo service worker único (src/sw.js).

import { getToken, onMessage } from 'firebase/messaging'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { messaging, FCM_VAPID_KEY, app } from '../firebase/config.js'
import { solicitarPermissao } from './notificacao.js'

const PREFIX_TOKEN = 'condo_fcm_token_v2_'
let funcoes = null

function obterFuncoes() {
  if (!funcoes) funcoes = getFunctions(app)
  return funcoes
}

export function pushConfigurado() {
  return Boolean(FCM_VAPID_KEY && FCM_VAPID_KEY !== 'SUA_VAPID_KEY_AQUI')
}

// Retorna o registro do ÚNICO service worker do app (registrado em main.jsx).
// Não registramos um segundo SW aqui: dois SWs no mesmo escopo "/" competem
// entre si e um acaba substituindo o outro, fazendo o push parar de
// funcionar com o app fechado. O src/sw.js já cuida do Firebase Messaging.
export async function registrarServiceWorkerFCM() {
  if (!('serviceWorker' in navigator)) return null
  try {
    // Garante que o SW principal já está registrado (caso esta função seja
    // chamada antes do listener de "load" em main.jsx terminar).
    const existente = await navigator.serviceWorker.getRegistration('/')
    const registration = existente || (await navigator.serviceWorker.register('/sw.js', { scope: '/' }))
    // Espera o SW ficar ativo — getToken() precisa de um registration.active
    const pronto = await navigator.serviceWorker.ready
    console.log('[PUSH] Usando SW único já ativo:', pronto.scope)
    return registration.active ? registration : pronto
  } catch (err) {
    console.warn('[PUSH] Falha ao obter SW registrado:', err)
    return null
  }
}

// Gera (ou reutiliza) o token FCM deste dispositivo.
export async function obterTokenFCM() {
  if (!pushConfigurado() || !('serviceWorker' in navigator)) return null
  try {
    const permissao = await solicitarPermissao()
    if (permissao !== 'granted') {
      console.warn('[PUSH] Permissão de notificação não concedida:', permissao)
      return null
    }
    const registration = await registrarServiceWorkerFCM()
    if (!registration) {
      console.warn('[PUSH] SW do FCM indisponível (precisa de HTTPS ou localhost)')
      return null
    }
    const atual = localStorage.getItem(PREFIX_TOKEN)
    if (atual) return atual
    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration
    })
    if (token) {
      console.log('[PUSH] Token FCM obtido com sucesso')
      localStorage.setItem(PREFIX_TOKEN, token)
      return token
    }
    console.warn('[PUSH] getToken retornou null — verifique VAPID key')
    return null
  } catch (err) {
    console.warn('[PUSH] Erro ao obter token FCM:', err.code, err.message)
    localStorage.removeItem(PREFIX_TOKEN)
    return null
  }
}

// Limpa o token salvo deste dispositivo (logout)
export function limparTokenFCM() {
  localStorage.removeItem(PREFIX_TOKEN)
}

// Salva o token do usuário no Firestore (dentro do tenant)
export async function salvarTokenUsuario(tenantId, userUid, info = {}) {
  const token = await obterTokenFCM()
  if (!token || !tenantId || !userUid) {
    console.warn('[PUSH] Sem token ou dados — documento NÃO salvo')
    return null
  }
  try {
    const { doc, setDoc } = await import('firebase/firestore')
    const { db } = await import('../firebase/config.js')
    await setDoc(doc(db, 'tenants', tenantId, 'pushTokens', userUid), {
      token,
      uid: userUid,
      dispositivo: info.dispositivo || 'desconhecido',
      atualizadoEm: new Date().toISOString()
    }, { merge: true })
    console.log('[PUSH] Token salvo no Firestore para', userUid)
    return token
  } catch (err) {
    console.warn('[PUSH] Erro ao salvar token no Firestore:', err)
    return null
  }
}

// Envia push para todos os dispositivos do tenant (via Cloud Function)
export async function enviarPushTenant(tenantId, titulo, corpo, url = '/') {
  try {
    const func = httpsCallable(obterFuncoes(), 'enviarNotificacao')
    const dados = await func({ titulo, corpo, url, tenantId })
    console.log('[PUSH] Cloud Function respondeu:', dados)
    return dados?.enviados > 0
  } catch (err) {
    console.warn('[PUSH] Cloud Function falhou:', err?.message || err)
  }
  return false
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