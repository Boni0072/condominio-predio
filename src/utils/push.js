// Utilidade de Web Push via Firebase Cloud Messaging (FCM)
// Funciona mesmo com o app FECHADO no celular, pois o push é enviado
// pelo servidor FCM e exibido pelo service worker único (src/sw.js).

import { getToken, onMessage } from 'firebase/messaging'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { messaging, FCM_VAPID_KEY, app } from '../firebase/config.js'
import { solicitarPermissao } from './notificacao.js'

const PREFIX_TOKEN = 'condo_fcm_token_v2_'
let funcoes = null

// Último motivo pelo qual não conseguimos obter/salvar o token.
// Serve para o diagnóstico das Configurações mostrar o MOTIVO real da falha
// em vez de apenas "retornou null".
let ultimoErroFCM = null

export function ultimoErroToken() {
  return ultimoErroFCM
}

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
// Com { forcarNovo: true } ignora o cache do localStorage e pede um token
// validado ao FCM (getToken é idempotente: devolve o mesmo token se ele ainda
// é válido, ou um novo se o antigo foi rotacionado).
export async function obterTokenFCM({ forcarNovo = false } = {}) {
  if (!pushConfigurado()) {
    ultimoErroFCM = 'VAPID key não configurada (FCM_VAPID_KEY em src/firebase/config.js)'
    console.warn('[PUSH]', ultimoErroFCM)
    return null
  }
  if (!('serviceWorker' in navigator)) {
    ultimoErroFCM = 'Service Worker não suportado neste navegador'
    console.warn('[PUSH]', ultimoErroFCM)
    return null
  }
  try {
    const permissao = await solicitarPermissao()
    if (permissao !== 'granted') {
      ultimoErroFCM = `Permissão de notificação: "${permissao}" (precisa ser "granted")`
      console.warn('[PUSH]', ultimoErroFCM)
      return null
    }
    const registration = await registrarServiceWorkerFCM()
    if (!registration) {
      ultimoErroFCM = 'Service Worker do FCM indisponível (precisa de HTTPS ou localhost)'
      console.warn('[PUSH]', ultimoErroFCM)
      return null
    }
    // Token salvo anteriormente: devolvido direto (evita rede) quando não é
    // para forçar. Ao salvar no Firestore SEMPRE forçamos, porque o token do
    // localStorage pode estar vencido (o FCM rotaciona tokens e a Cloud
    // Function apaga do Firestore os tokens que falharam no envio — gravar de
    // novo um token morto faria o documento "sumir" a cada notificação).
    if (!forcarNovo) {
      const atual = localStorage.getItem(PREFIX_TOKEN)
      if (atual) return atual
    }
    const token = await getToken(messaging, {
      vapidKey: FCM_VAPID_KEY,
      serviceWorkerRegistration: registration
    })
    if (token) {
      console.log('[PUSH] Token FCM obtido com sucesso')
      localStorage.setItem(PREFIX_TOKEN, token)
      ultimoErroFCM = null
      return token
    }
    ultimoErroFCM = 'getToken retornou vazio — verifique se a VAPID key pertence a este projeto'
    console.warn('[PUSH]', ultimoErroFCM)
    return null
  } catch (err) {
    ultimoErroFCM = `${err?.code || 'erro'}: ${err?.message || err}`
    console.warn('[PUSH] Erro ao obter token FCM:', ultimoErroFCM)
    localStorage.removeItem(PREFIX_TOKEN)
    return null
  }
}

// Limpa o token salvo deste dispositivo (logout)
export function limparTokenFCM() {
  localStorage.removeItem(PREFIX_TOKEN)
}

// Salva o token do usuário no Firestore (dentro do tenant).
// ESTRATÉGIA EM DUAS CAMADAS para nunca mais falhar silenciosamente:
//   1. Grava direto do cliente (documento POR DISPOSITIVO — celular e
//      notebook do mesmo usuário convivem sem se sobrescrever).
//   2. Se qualquer erro ocorrer (regra do Firestore desatualizada,
//      permission-denied, offline, etc.), chama a Cloud Function
//      "registrarPushToken", que grava com o Admin SDK IGNORANDO as regras
//      e deriva o tenant no servidor a partir do perfil do usuário.
export async function salvarTokenUsuario(tenantId, userUid, info = {}) {
  // Sempre pede um token NOVO/validado ao FCM antes de gravar: gravar um token
  // em cache vencido cria um documento que a Cloud Function apaga no primeiro
  // envio falho — parecia que "o pushToken nunca era criado".
  const token = await obterTokenFCM({ forcarNovo: true })
  if (!token || !tenantId || !userUid) {
    console.warn('[PUSH] Documento NÃO salvo —', {
      temToken: Boolean(token),
      tenantId: tenantId || null,
      userUid: userUid || null,
      motivo: ultimoErroFCM || (token ? 'faltou tenantId/uid no perfil' : 'sem token')
    })
    if (tenantId && userUid) ultimoErroFCM = ultimoErroFCM || 'faltou tenantId/uid no perfil'
    return null
  }

  // Chave estável do dispositivo: plataforma + ID aleatório persistido.
  // Dois navegadores na mesma plataforma não brigam pelo mesmo documento.
  let deviceKey = localStorage.getItem('condo_push_device_id')
  if (!deviceKey) {
    deviceKey = Math.random().toString(36).slice(2, 8)
    localStorage.setItem('condo_push_device_id', deviceKey)
  }
  const plataformaBruta = String(info.dispositivo || navigator.platform || 'device')
  const dispositivoId = `${plataformaBruta}-${deviceKey}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'device'
  const docId = `${userUid}__${dispositivoId}`

  const dados = {
    token,
    uid: userUid,
    dispositivo: plataformaBruta,
    origem: 'cliente',
    atualizadoEm: new Date().toISOString()
  }

  // CAMADA 1: gravação direta pelo cliente
  try {
    const { doc, setDoc } = await import('firebase/firestore')
    const { db } = await import('../firebase/config.js')
    await setDoc(doc(db, 'tenants', tenantId, 'pushTokens', docId), dados, { merge: true })
    console.log('[PUSH] Token salvo no Firestore (cliente):', `tenants/${tenantId}/pushTokens/${docId}`)
    ultimoErroFCM = null
    ultimoDocIdSalvo = docId
    return token
  } catch (errCliente) {
    console.warn('[PUSH] Gravação direta falhou, tentando via Cloud Function (Admin SDK):', errCliente?.code || '', errCliente?.message || errCliente)
  }

  // CAMADA 2: fallback via Cloud Function com Admin SDK (ignora regras)
  try {
    const func = httpsCallable(obterFuncoes(), 'registrarPushToken')
    const resposta = await func({ token, dispositivo: plataformaBruta, dispositivoId, tenantId })
    const dadosResp = resposta?.data || {}
    console.log('[PUSH] Token salvo via Cloud Function (Admin SDK):', dadosResp)
    ultimoErroFCM = null
    ultimoDocIdSalvo = dadosResp.docId || docId
    return token
  } catch (errFunc) {
    ultimoErroFCM = `Cliente: ${errCliente?.code || errCliente?.message || errCliente} | Cloud Function: ${errFunc?.message || errFunc}`
    console.warn('[PUSH] Falha nas duas camadas de salvamento:', ultimoErroFCM)
    return null
  }
}

// ID do último documento de token gravado com sucesso (para o diagnóstico).
let ultimoDocIdSalvo = null
export function ultimoDocSalvo() {
  return ultimoDocIdSalvo
}

// Consulta o SERVIDOR (dados reais do Firestore via Admin SDK): perfil do
// usuário, tenant e todos os pushTokens existentes (token mascarado).
// Usado pelo diagnóstico das Configurações — mostra a verdade do servidor,
// não só o que o navegador vê.
export async function diagnosticarPush() {
  try {
    const func = httpsCallable(obterFuncoes(), 'diagnosticoPush')
    const resposta = await func({})
    return resposta?.data || { erro: 'resposta vazia' }
  } catch (err) {
    console.warn('[PUSH] diagnosticoPush falhou:', err?.message || err)
    return { erro: err?.message || String(err) }
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