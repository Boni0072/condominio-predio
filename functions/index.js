// Cloud Function para enviar notificações push via FCM v1 (API moderna).
// Não precisa de "Server key": o admin SDK usa as credenciais do projeto.
//
// Callable function chamada pelo frontend quando a portaria registra uma
// encomenda/visitante. A função só envia para o tenant do usuário autenticado
// (valida pelo token de autenticação — não confia em dados do cliente).

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

initializeApp()

const db = getFirestore()
const messaging = getMessaging()

// Envia push para todos os dispositivos do tenant do usuário autenticado.
// cors: true permite a chamada pelo navegador (localhost e domínio publicado).
export const enviarNotificacao = onCall({ cors: true }, async (request) => {
  const auth = request.auth
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Faça login para enviar notificações.')
  }

  const { titulo, corpo, url } = request.data || {}
  if (!titulo || !corpo) {
    throw new HttpsError('invalid-argument', 'Informe titulo e corpo.')
  }

  // Busca o perfil do usuário para descobrir o tenant (NUNCA confiar no payload)
  const userSnap = await db.collection('users').doc(auth.uid).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'Perfil de usuário não encontrado.')
  }
  const email = String(auth.token.email || '').toLowerCase()
  const eMaster = email === 'ander.fj@hotmail.com' // mesmo master validado nas regras do Firestore

  // O master é global (condominioId null) e pode indicar o tenant do payload.
  // Usuários comuns SEMPRE usam o condomínio do próprio perfil — o payload é ignorado.
  let tenantId = userSnap.data().condominioId
  if (!tenantId && eMaster && request.data?.tenantId) {
    tenantId = String(request.data.tenantId)
  }
  if (!tenantId) {
    throw new HttpsError('failed-precondition', 'Usuário sem condomínio vinculado.')
  }

  // Lê os tokens de push de TODOS os dispositivos do tenant.
  // Dedupe por token: o mesmo token pode existir em 2 documentos (o legado
  // "uid" e o novo "uid__dispositivo") — sem dedupe o morador receberia a
  // mesma notificação em dobro.
  let pares = [] // [{ doc, token }]
  try {
    const snap = await db.collection('tenants').doc(tenantId).collection('pushTokens').get()
    const vistos = new Set()
    pares = snap.docs
      .map((d) => ({ doc: d, token: d.data().token }))
      .filter((p) => {
        if (!p.token) return false
        if (vistos.has(p.token)) return false
        vistos.add(p.token)
        return true
      })
  } catch (err) {
    console.warn('Erro ao ler pushTokens:', err)
  }
  const tokens = pares.map((p) => p.token)
  if (tokens.length === 0) {
    return { enviados: 0, totalTokens: 0 }
  }

  // Monta a mensagem para FCM v1
  const mensagens = tokens.map((token) => ({
    token,
    notification: {
      title: titulo,
      body: corpo,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png'
    },
    data: { url: url || '/', titulo, corpo },
    webpush: {
      fcmOptions: { link: url || '/' }
    }
  }))

  // Envia em lote
  const respostas = await messaging.sendEach(mensagens)

  const sucessos = respostas.responses.filter((r) => r.success).length
  const falhas = respostas.responses.length - sucessos

  // Só apaga o documento do token em erros PERMANENTES (app desinstalado,
  // subscription expirada, sender trocado). Falhas TRANSITÓRIAS (rede,
  // indisponibilidade, quota) NÃO apagam: antes, qualquer falha removia o
  // token do Firestore e o documento "sumia" — parecia que o push nunca
  // tinha sido salvo, e o aparelho deixava de receber notificações para
  // sempre até abrir o app de novo.
  const CODIGOS_PERMANENTES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/unregistered',
    'messaging/mismatched-credential',
    'messaging/sender-id-mismatch',
    'messaging/invalid-argument'
  ])

  let removidos = 0
  if (falhas > 0) {
    const batch = db.batch()
    pares.forEach((p, i) => {
      const resposta = respostas.responses[i]
      if (resposta.success) return
      const codigo = resposta.error?.code || 'desconhecido'
      console.warn(
        `[PUSH] Falha ao enviar para token ${String(p.token).slice(0, 12)}...: ${codigo} — ${resposta.error?.message || ''}`
      )
      if (CODIGOS_PERMANENTES.has(codigo)) {
        batch.delete(p.doc.ref)
        removidos++
      }
    })
    if (removidos > 0) {
      await batch.commit().catch((err) => console.warn('Erro ao limpar tokens inválidos:', err))
    }
  }

  return { enviados: sucessos, falhas, totalTokens: tokens.length, removidos }
})

// Utilitário compartilhado: deriva um sufixo seguro de ID a partir do
// dispositivo informado pelo cliente (letras/números/hífen, máx. 48 chars).
function sufixoDispositivo(valor) {
  const limpo = String(valor || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return limpo || 'device'
}

// Registra/atualiza o token de push do usuário autenticado usando o ADMIN SDK.
// Não passa pelas regras do Firestore: mesmo que as regras publicadas estejam
// desatualizadas, o perfil esteja estranho ou o cliente tenha perdido a
// permissão de escrita, o token é gravado. O tenant é derivado do perfil do
// usuário LIDO NO SERVIDOR — o cliente nunca escolhe onde gravar.
export const registrarPushToken = onCall({ cors: true }, async (request) => {
  const auth = request.auth
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Faça login para registrar o token de notificações.')
  }

  const { token, dispositivo, dispositivoId } = request.data || {}
  if (!token || typeof token !== 'string' || token.length < 32) {
    throw new HttpsError('invalid-argument', 'Token FCM inválido ou ausente.')
  }

  const userSnap = await db.collection('users').doc(auth.uid).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'Perfil de usuário não encontrado.')
  }
  const perfil = userSnap.data()
  const email = String(auth.token.email || '').toLowerCase()
  const eMaster = email === 'ander.fj@hotmail.com'

  let tenantId = perfil.condominioId
  if (!tenantId && eMaster && request.data?.tenantId) {
    tenantId = String(request.data.tenantId)
  }
  if (!tenantId) {
    throw new HttpsError('failed-precondition', 'Usuário sem condomínio vinculado — não há onde salvar o token.')
  }

  // Um documento POR DISPOSITIVO: celular e notebook do mesmo usuário convivem.
  const docId = `${auth.uid}__${sufixoDispositivo(dispositivoId)}`
  const ref = db.collection('tenants').doc(tenantId).collection('pushTokens').doc(docId)

  await ref.set(
    {
      token,
      uid: auth.uid,
      email,
      dispositivo: String(dispositivo || dispositivoId || 'desconhecido'),
      origem: 'cloud-function',
      atualizadoEm: new Date().toISOString()
    },
    { merge: true }
  )

  console.log(`[PUSH] Token registrado via Admin SDK: tenants/${tenantId}/pushTokens/${docId}`)
  return { ok: true, docId, tenantId }
})

// Diagnóstico com dados REAIS do servidor (o console do navegador só mostra o
// lado do cliente). Retorna o próprio perfil + os pushTokens do tenant com o
// token MASCARADO. O master pode inspecionar qualquer tenant via tenantId.
export const diagnosticoPush = onCall({ cors: true }, async (request) => {
  const auth = request.auth
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Faça login para executar o diagnóstico.')
  }
  const email = String(auth.token.email || '').toLowerCase()
  const eMaster = email === 'ander.fj@hotmail.com'

  const userSnap = await db.collection('users').doc(auth.uid).get()
  const perfil = userSnap.exists ? userSnap.data() : null

  let tenantId = perfil?.condominioId || null
  if (!tenantId && eMaster && request.data?.tenantId) {
    tenantId = String(request.data.tenantId)
  }

  const mascarar = (t) =>
    t ? `${String(t).slice(0, 14)}…${String(t).slice(-6)} (${String(t).length} chars)` : null

  const resultado = {
    uid: auth.uid,
    email,
    eMaster,
    perfil: perfil
      ? {
          role: perfil.role || null,
          nome: perfil.nome || null,
          condominioId: perfil.condominioId || null,
          status: perfil.status || null,
          acessos: Array.isArray(perfil.acessos) ? perfil.acessos : null
        }
      : null,
    tenantId
  }

  if (tenantId) {
    const tenantSnap = await db.collection('tenants').doc(tenantId).get()
    resultado.tenantExiste = tenantSnap.exists
    resultado.tenantNome = tenantSnap.exists ? tenantSnap.data().nome || null : null
    try {
      const snap = await db.collection('tenants').doc(tenantId).collection('pushTokens').get()
      resultado.pushTokens = snap.docs.map((d) => ({
        id: d.id,
        uid: d.data().uid || null,
        dispositivo: d.data().dispositivo || null,
        origem: d.data().origem || null,
        atualizadoEm: d.data().atualizadoEm || null,
        token: mascarar(d.data().token)
      }))
    } catch (err) {
      resultado.pushTokensErro = err?.message || String(err)
    }
  }

  return resultado
})