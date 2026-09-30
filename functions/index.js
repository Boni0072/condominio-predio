// Cloud Function para enviar notificações push via FCM v1 (API moderna).
// Não precisa de "Server key": o admin SDK usa as credenciais do projeto.
//
// Callable function chamada pelo frontend quando a portaria registra uma
// encomenda/visitante. A função só envia para o tenant do usuário autenticado
// (valida pelo token de autenticação — não confia em dados do cliente).

import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https'
import {
  API_MERCADO_PAGO,
  boletoEstaPago,
  completarPagador,
  construirUrlWebhookMercadoPago,
  extrairDadosBoletoResposta,
  extrairDadosWebhookMercadoPago,
  mensagemDeErroMercadoPago,
  montarPagamentoBoleto,
  pagadorCompleto
} from './mercadopagoBoleto.js'

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

  // Monta a mensagem para FCM v1.
  // IMPORTANTE: o envio é SOMENTE com o bloco "data" (sem "notification").
  // Quem renderiza a notificação é o onBackgroundMessage do service worker
  // único (src/sw.js). Enviar também o bloco "notification" fazia o FCM
  // disparar a notificação automática E o SW mostrar outra (duplicadas),
  // além de carregar ícones com URL relativa que alguns navegadores recusam
  // quando a notificação "vem pronta" do servidor — com dados apenas, a
  // exibição é 100% controlada por nós e funciona igual em Android/iOS.
  const mensagens = tokens.map((token) => ({
    token,
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

// =====================================================================
// Boleto REGISTRADO no Mercado Pago
// =====================================================================
//
// O código de barras/linha digitável de um boleto registrado só existe de
// verdade depois que o banco (via Mercado Pago) registra a cobrança. Este
// arquivo é o único lugar do sistema que fala com a API do Mercado Pago,
// porque a chamada exige o Access Token — uma credencial SECRETA que nunca
// pode chegar ao navegador (todo o bundle do app é público).
//
// O Access Token é cadastrado pelo síndico em Pagamentos › Configurar Contas ›
// "Boleto registrado (Mercado Pago)" e fica em config_privada/{tenantId}, um
// documento que só o síndico (e o master) podem LER pelas regras do Firestore.
// Como alternativa de operação, a função também aceita a variável de ambiente
// MERCADO_PAGO_ACCESS_TOKEN (útil quando o token é definido no deploy).
//
// O resultado (código de barras, linha digitável, URL do boleto e status) é
// gravado pela própria função na cobrança em tenants/{tenantId}/boletos — o
// Admin SDK ignora as regras, então o MORADOR continua sem permissão de
// escrita na coleção e ainda assim passa a ver o boleto registrado.

const PERFIS_GESTORES_PAGAMENTO = ['sindico', 'zelador', 'portaria']
const COLECOES_BOLETO = ['boletos', 'cobrancas']

// Autentica a chamada do boleto registrado e resolve o tenant. Gestores
// (síndico, zelador, portaria) registram qualquer cobrança do condomínio; o
// Resolve quem está chamando (usuário, condomínio e papel). A titularidade de
// uma cobrança é conferida por cobrancaDoMorador; telas de gestão usam
// contextoGestorPagamento. O tenant NUNCA vem do payload para usuário comum
// (só o master pode escolher).
async function contextoPagamento(request) {
  const auth = request.auth
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Faça login para gerar o boleto registrado.')
  }
  const userSnap = await db.collection('users').doc(auth.uid).get()
  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'Perfil de usuário não encontrado.')
  }
  const perfil = userSnap.data()
  const email = String(auth.token.email || '').toLowerCase()
  const eMaster = email === 'ander.fj@hotmail.com' // mesmo master das regras do Firestore

  let tenantId = perfil.condominioId
  if (!tenantId && eMaster && request.data?.tenantId) {
    tenantId = String(request.data.tenantId)
  }
  if (!tenantId) {
    throw new HttpsError('failed-precondition', 'Usuário sem condomínio vinculado — não há cobrança para registrar.')
  }
  const eGestor = eMaster || PERFIS_GESTORES_PAGAMENTO.includes(perfil.role)
  return { uid: auth.uid, email, perfil, tenantId, eMaster, eGestor }
}

// Cobraça pertence ao morador logado? MESMA regra de
// src/components/pagamentos/cobrancas.js (cobrancaPertenceAoUsuario): vale o
// vínculo explícito (moradorUserId/moradorId/uid), o e-mail, a UNIDADE do
// apartamento ou o nome do cadastro. Se o servidor fosse mais estrito que a
// tela, o morador veria a cobrança na lista e levaria "sem permissão" ao
// tentar abrir/conferir o próprio boleto — por isso a unidade também vale aqui.
function cobrancaDoMorador(cobranca, contexto) {
  const dados = cobranca || {}
  const uid = String(contexto.uid || '')
  const perfil = contexto.perfil || {}
  for (const campo of ['moradorUserId', 'moradorId', 'usuarioId', 'uid', 'userId', 'destinatarioId']) {
    const valor = dados[campo]
    if (valor && (String(valor) === uid || String(valor) === String(perfil.uid || ''))) return true
  }
  const normalizar = (texto) => String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const meusNomes = [perfil.nome, perfil.displayName, perfil.nomeCompleto, contexto.email]
    .map(normalizar).filter(Boolean)
  const nomesDoRegistro = [dados.destinatario, dados.moradorNome, dados.moradorEmail, dados.email]
    .map(normalizar).filter(Boolean)
  if (meusNomes.some((meu) => nomesDoRegistro.some((nome) => nome === meu || nome.includes(meu) || meu.includes(nome)))) {
    return true
  }
  // E-mail e unidade (mesma comparação "101" == "Apto 101" usada no app).
  const somenteAlfanum = (texto) => normalizar(texto).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
  const meuEmail = String(contexto.email || '').trim().toLowerCase()
  const emailDoRegistro = String(dados.moradorEmail || dados.email || '').trim().toLowerCase()
  if (meuEmail && meuEmail === emailDoRegistro) return true
  const minhaUnidade = somenteAlfanum(perfil.unidade)
  const unidadeDoRegistro = somenteAlfanum(dados.moradorUnidade || dados.unidade)
  return Boolean(minhaUnidade) && Boolean(unidadeDoRegistro) && minhaUnidade === unidadeDoRegistro
}

// Autentica a chamada e garante que quem pediu é gestor do condomínio — quem
// registra o boleto é a administração; o morador só consulta e paga.
// O tenant NUNCA vem do payload para usuário comum (só o master pode escolher).
async function contextoGestorPagamento(request) {
  const contexto = await contextoPagamento(request)
  if (!contexto.eGestor) {
    throw new HttpsError(
      'permission-denied',
      'O boleto registrado é emitido pela administração do condomínio. Assim que o boleto for registrado, a linha digitável e o código de barras aparecem em "Meus Pagamentos" para você pagar.'
    )
  }
  return contexto
}

// Credenciais do Mercado Pago do condomínio (documento privado) com fallback
// para a variável de ambiente do deploy.
async function credenciaisMercadoPago(tenantId) {
  let dados = null
  try {
    const snap = await db.collection('config_privada').doc(tenantId).get()
    if (snap.exists) dados = snap.data()
  } catch (erro) {
    console.warn('[MERCADO PAGO] Não foi possível ler config_privada:', erro?.message || erro)
  }
  const accessToken = String(dados?.accessToken || process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim()
  return {
    accessToken,
    publicKey: String(dados?.publicKey || '').trim(),
    urlNotificacao: String(dados?.urlNotificacao || '').trim()
  }
}

function colecaoDoBoleto(valor) {
  const nome = String(valor || '').trim()
  return COLECOES_BOLETO.includes(nome) ? nome : 'boletos'
}

// Grava os números oficiais na cobrança. Nunca apaga campos existentes
// ({ merge: true }) e não cria documento novo se a cobrança não existir.
async function gravarBoletoRegistrado({ tenantId, colecao, boletoId, registro, pagador }) {
  const ref = db.collection('tenants').doc(tenantId).collection(colecao).doc(boletoId)
  const snap = await ref.get()
  if (!snap.exists) {
    console.warn(`[MERCADO PAGO] Cobrança ${colecao}/${boletoId} não existe — números não gravados.`)
    return false
  }
  const agora = new Date().toISOString()
  const dados = {
    codigoBarras: registro.codigoBarras,
    linhaDigitavel: registro.linhaDigitavel,
    mercadoPagoId: registro.paymentId,
    mercadoPagoReferencia: registro.referencia,
    mercadoPagoStatus: registro.status,
    mercadoPagoStatusDetalhe: registro.statusDetalhe,
    mercadoPagoRegistradoEm: agora,
    atualizadoEm: agora
  }
  if (registro.urlBoleto) dados.urlBoleto = registro.urlBoleto
  if (registro.vencimento) dados.mercadoPagoVencimento = registro.vencimento
  if (registro.instituicaoFinanceira) dados.mercadoPagoBanco = registro.instituicaoFinanceira
  if (pagador) {
    const nome = String(pagador.nome || '').trim()
    const documento = String(pagador.documento || '').replace(/\D/g, '')
    const email = String(pagador.email || '').trim().toLowerCase()
    const cep = String(pagador.cep || '').replace(/\D/g, '')
    const logradouro = String(pagador.logradouro || '').trim()
    const numero = String(pagador.numero || '').trim()
    const bairro = String(pagador.bairro || '').trim()
    const cidade = String(pagador.cidade || '').trim()
    const uf = String(pagador.uf || '').trim().toUpperCase().slice(0, 2)
    if (nome) dados.pagadorNome = nome
    if (documento) dados.pagadorDocumento = documento
    if (email) dados.pagadorEmail = email
    if (cep) dados.pagadorCep = cep
    // Endereço do pagador: exigido pelo Mercado Pago/BACEN na emissão do
    // boleto e reusado na 2ª via (fica gravado junto da cobrança).
    if (logradouro) dados.pagadorLogradouro = logradouro
    if (numero) dados.pagadorNumero = numero
    if (bairro) dados.pagadorBairro = bairro
    if (cidade) dados.pagadorCidade = cidade
    if (uf) dados.pagadorUf = uf
  }
  await ref.set(dados, { merge: true })
  return true
}

async function chamarApiMercadoPago(caminho, { accessToken, metodo = 'GET', corpo, idempotencia }) {
  const cabecalhos = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json'
  }
  if (corpo) cabecalhos['Content-Type'] = 'application/json'
  // A chave de idempotência evita COBRANÇA DUPLICADA: repetir a mesma
  // requisição (clique duplo, queda de rede, nova tentativa) devolve o mesmo
  // pagamento em vez de criar outro boleto.
  if (idempotencia) cabecalhos['X-Idempotency-Key'] = String(idempotencia).slice(0, 120)

  const resposta = await fetch(`${API_MERCADO_PAGO}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined
  })
  const json = await resposta.json().catch(() => null)
  return { ok: resposta.ok, http: resposta.status, json }
}

// ---------- Pagador do boleto montado no servidor ----------
// O Mercado Pago exige nome completo, CPF/CNPJ, e-mail e endereço completo do
// pagador. Para o gestor não redigitar nada a cada cobrança, o bloco é montado
// a partir do que o sistema já sabe (functions/mercadopagoBoleto.js >
// completarPagador): a própria ficha da cobrança (pagador* de um registro
// anterior, morador*) + o endereço cadastrado do condomínio (é lá que o morador
// mora). O que o formulário enviar continua tendo prioridade (correção manual).
//
// usarCadastro=false: os dados PESSOAIS de quem está clicando (o síndico) NUNCA
// viram os do devedor — o pagador sai da ficha da cobrança, nunca do perfil de
// quem registra.
async function resolverPagadorBoleto({ contexto, cobranca, payload }) {
  let condominio = {}
  try {
    const snap = await db.collection('tenants').doc(contexto.tenantId).get()
    if (snap.exists) condominio = snap.data() || {}
  } catch (erro) {
    console.warn('[MERCADO PAGO] Não foi possível ler o cadastro do condomínio:', erro?.message || erro)
  }
  const pagador = completarPagador({ payload, cobranca, condominio, usarCadastro: false })
  const checagem = pagadorCompleto(pagador)
  if (!checagem.ok) {
    // failed-precondition + details: a tela reconhece o caso e destaca exatamente
    // os campos que faltam, em vez de um erro genérico.
    throw new HttpsError(
      'failed-precondition',
      `${checagem.erros.join(' ')} Complete os dados do pagador e registre novamente.`,
      { faltamDadosPagador: true, erros: checagem.erros }
    )
  }
  return pagador
}

// Registra (gera) o boleto de uma cobrança no Mercado Pago e grava o código de
// barras de 44 dígitos + linha digitável de 47 na própria cobrança.
// Payload: { boletoId, colecao, valor, descricao, dataVencimento, pagador }
// Quem pode chamar: somente a ADMINISTRAÇÃO (síndico/zelador/portaria e master).
// O morador não registra nada — ele abre o boleto já registrado em "Meus
// Pagamentos" e paga (linha digitável, código de barras e link oficial).
export const gerarBoletoMercadoPago = onCall({ cors: true }, async (request) => {
  const contexto = await contextoGestorPagamento(request)
  const dados = request.data || {}
  const boletoId = String(dados.boletoId || '').trim()
  if (!boletoId) {
    throw new HttpsError('invalid-argument', 'Informe a cobrança que receberá o boleto registrado.')
  }
  const colecao = colecaoDoBoleto(dados.colecao)

  // Carrega a cobrança (o valor/vencimento gravados nela são a referência).
  const refCobranca = db.collection('tenants').doc(contexto.tenantId).collection(colecao).doc(boletoId)
  const snapCobranca = await refCobranca.get()
  if (!snapCobranca.exists) {
    throw new HttpsError('not-found', 'Cobrança não encontrada no condomínio.')
  }
  const cobranca = snapCobranca.data() || {}
  if (String(cobranca.status || '').toLowerCase() === 'pago') {
    throw new HttpsError('failed-precondition', 'Esta cobrança já está paga.')
  }

  // Reuso idempotente: se a cobrança já tem o código oficial, devolve o que
  // está gravado em vez de emitir outro boleto no banco (evita duplicidade no
  // clique duplo ou quando o morador abre a 2ª via).
  const barrasGravadas = String(cobranca.codigoBarras || '').replace(/\D/g, '')
  if (barrasGravadas.length === 44) {
    return {
      boletoId,
      colecao,
      paymentId: String(cobranca.mercadoPagoId || ''),
      codigoBarras: barrasGravadas,
      linhaDigitavel: String(cobranca.linhaDigitavel || '').replace(/\D/g, ''),
      urlBoleto: String(cobranca.urlBoleto || ''),
      referencia: String(cobranca.mercadoPagoReferencia || ''),
      status: String(cobranca.mercadoPagoStatus || 'pending'),
      statusDetalhe: String(cobranca.mercadoPagoStatusDetalhe || ''),
      vencimento: String(cobranca.mercadoPagoVencimento || cobranca.dataVencimento || ''),
      instituicaoFinanceira: String(cobranca.mercadoPagoBanco || ''),
      salvo: true,
      reutilizado: true
    }
  }

  const credenciais = await credenciaisMercadoPago(contexto.tenantId)
  if (!credenciais.accessToken) {
    throw new HttpsError(
      'failed-precondition',
      'O Access Token do Mercado Pago ainda não foi cadastrado. Abra Pagamentos › Configurar Contas › "Boleto registrado (Mercado Pago)".'
    )
  }

  const urlPadraoNotificacao = construirUrlWebhookMercadoPago('portaria-condominio-8fbc9', contexto.tenantId)

  // Os dados do pagador saem da ficha da cobrança + endereço do condomínio; o
  // que o formulário do gestor enviou tem prioridade (correção manual).
  const pagador = await resolverPagadorBoleto({ contexto, cobranca, payload: dados })
  const { corpo, erros, vencimento } = montarPagamentoBoleto({
    valor: dados.valor ?? cobranca.valor,
    descricao: dados.descricao ?? cobranca.descricao,
    dataVencimento: dados.dataVencimento ?? cobranca.dataVencimento,
    pagador,
    // Conciliação: o mesmo identificador volta no extrato/webhook do Mercado Pago.
    referenciaExterna: `${contexto.tenantId}-${boletoId}`,
    urlNotificacao: dados.urlNotificacao || credenciais.urlNotificacao || urlPadraoNotificacao
  })
  if (erros.length) {
    throw new HttpsError('invalid-argument', erros.join(' '))
  }

  const { ok, http, json } = await chamarApiMercadoPago('/v1/payments', {
    accessToken: credenciais.accessToken,
    metodo: 'POST',
    corpo,
    idempotencia: `${contexto.tenantId}-${boletoId}`
  })
  if (!ok) {
    console.error('[MERCADO PAGO] Emissão recusada:', JSON.stringify(json || {}).slice(0, 800))
    throw new HttpsError(
      'failed-precondition',
      mensagemDeErroMercadoPago(json) || `O Mercado Pago recusou a emissão do boleto (HTTP ${http}).`
    )
  }

  const registro = extrairDadosBoletoResposta(json)
  if (!registro.codigoBarras && !registro.linhaDigitavel) {
    console.error('[MERCADO PAGO] Resposta sem código de barras:', JSON.stringify(json || {}).slice(0, 800))
    throw new HttpsError(
      'failed-precondition',
      'O Mercado Pago não devolveu o código de barras desta cobrança. Confira se o boleto está habilitado na conta.'
    )
  }

  let salvo = false
  try {
    salvo = await gravarBoletoRegistrado({
      tenantId: contexto.tenantId,
      colecao,
      boletoId,
      registro,
      pagador
    })
  } catch (erro) {
    console.error('[MERCADO PAGO] Boleto gerado, mas não foi possível gravar na cobrança:', erro?.message || erro)
  }
  // Os dados do pagador usados ficam gravados na própria cobrança (campos
  // pagador*), prontos para reaproveitar na 2ª via.
  console.log(`[MERCADO PAGO] Boleto ${registro.paymentId} gerado para ${colecao}/${boletoId} (tenant ${contexto.tenantId})`)
  return { ...registro, boletoId, colecao, vencimento, salvo }
})

// Função auxiliar para consultar o Mercado Pago e atualizar a cobrança correspondente
// (usada tanto pelo botão manual "Conferir pagamento" quanto pelo Webhook automático).
async function processarAtualizacaoPagamentoMercadoPago({ tenantId, paymentId, boletoId, colecao, accessToken }) {
  if (!accessToken) {
    throw new Error('Access Token do Mercado Pago não configurado.')
  }
  if (!paymentId) {
    throw new Error('ID do pagamento no Mercado Pago não informado.')
  }

  const { ok, http, json } = await chamarApiMercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`, {
    accessToken
  })
  if (!ok) {
    console.error('[MERCADO PAGO] Falha ao consultar pagamento:', http, JSON.stringify(json || {}).slice(0, 500))
    throw new Error(mensagemDeErroMercadoPago(json) || `HTTP ${http} ao consultar pagamento.`)
  }

  const registro = extrairDadosBoletoResposta(json)
  const pago = boletoEstaPago(registro.status)
  const agora = new Date().toISOString()
  const alteracao = {
    mercadoPagoStatus: registro.status,
    mercadoPagoStatusDetalhe: registro.statusDetalhe,
    mercadoPagoConsultadoEm: agora
  }
  if (registro.linhaDigitavel) alteracao.linhaDigitavel = registro.linhaDigitavel
  if (registro.codigoBarras) alteracao.codigoBarras = registro.codigoBarras
  if (registro.urlBoleto) alteracao.urlBoleto = registro.urlBoleto

  // Se boletoId e colecao não foram fornecidos diretamente, tenta localizar a cobrança
  // no Firestore pelo external_reference ("tenantId-boletoId") ou pelo mercadoPagoId.
  let refCobrança = null
  let cobrancaAtual = null
  let idEncontrado = boletoId
  let colecaoEncontrada = colecaoDoBoleto(colecao)

  if (tenantId && idEncontrado) {
    const r = db.collection('tenants').doc(tenantId).collection(colecaoEncontrada).doc(idEncontrado)
    const snap = await r.get()
    if (snap.exists) {
      refCobrança = r
      cobrancaAtual = snap.data()
    }
  }

  // Se ainda não achou a referência e temos o external_reference retornado pela API
  if (!refCobrança && json?.external_reference) {
    const extRef = String(json.external_reference).trim()
    const partes = extRef.split('-')
    if (partes.length >= 2) {
      const extTenant = partes[0]
      const extBoletoId = partes.slice(1).join('-')
      const targetTenant = tenantId || extTenant
      for (const col of COLECOES_BOLETO) {
        const r = db.collection('tenants').doc(targetTenant).collection(col).doc(extBoletoId)
        const snap = await r.get()
        if (snap.exists) {
          refCobrança = r
          cobrancaAtual = snap.data()
          idEncontrado = extBoletoId
          colecaoEncontrada = col
          break
        }
      }
    }
  }

  // Fallback: busca por mercadoPagoId dentro do tenant
  if (!refCobrança && tenantId) {
    for (const col of COLECOES_BOLETO) {
      const q = await db.collection('tenants').doc(tenantId).collection(col)
        .where('mercadoPagoId', '==', String(paymentId))
        .limit(1)
        .get()
      if (!q.empty) {
        refCobrança = q.docs[0].ref
        cobrancaAtual = q.docs[0].data()
        idEncontrado = q.docs[0].id
        colecaoEncontrada = col
        break
      }
    }
  }

  let baixaAutomatica = false
  if (refCobrança && cobrancaAtual) {
    if (pago && cobrancaAtual.status !== 'pago') {
      alteracao.status = 'pago'
      alteracao.pagoEm = json?.date_approved || agora
      alteracao.atualizadoEm = agora
      baixaAutomatica = true
      console.log(`[MERCADO PAGO] Baixa automática efetuada na cobrança ${colecaoEncontrada}/${idEncontrado} do condomínio ${tenantId}!`)
    }
    await refCobrança.set(alteracao, { merge: true })
  } else {
    console.warn(`[MERCADO PAGO] Cobrança referente ao pagamento ${paymentId} não encontrada para atualização direta.`)
  }

  return {
    boletoId: idEncontrado,
    colecao: colecaoEncontrada,
    paymentId,
    pago,
    status: registro.status,
    statusDetalhe: registro.statusDetalhe,
    baixaAutomatica,
    alteracao
  }
}

// Consulta o status do boleto no Mercado Pago e dá baixa automática na
// cobrança quando o pagamento é aprovado. Payload: { boletoId, colecao, paymentId? }
// Quem pode chamar: GESTOR (qualquer cobrança) ou o próprio MORADOR (somente
// nas cobranças dele — mesma regra do gerarBoletoMercadoPago).
export const sincronizarBoletoMercadoPago = onCall({ cors: true }, async (request) => {
  const contexto = await contextoPagamento(request)
  const dados = request.data || {}
  const boletoId = String(dados.boletoId || '').trim()
  if (!boletoId) {
    throw new HttpsError('invalid-argument', 'Informe a cobrança que será conferida.')
  }
  const colecao = colecaoDoBoleto(dados.colecao)

  const credenciais = await credenciaisMercadoPago(contexto.tenantId)
  if (!credenciais.accessToken) {
    throw new HttpsError(
      'failed-precondition',
      'O Access Token do Mercado Pago ainda não foi cadastrado. Abra Pagamentos › Configurar Contas › "Boleto registrado (Mercado Pago)".'
    )
  }

  const ref = db.collection('tenants').doc(contexto.tenantId).collection(colecao).doc(boletoId)
  const snap = await ref.get()
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Cobrança não encontrada no condomínio.')
  }
  const cobranca = snap.data() || {}
  // Morador só confere as PRÓPRIAS cobranças; gestor confere qualquer uma.
  if (!contexto.eGestor && !cobrancaDoMorador(cobranca, contexto)) {
    throw new HttpsError('permission-denied', 'Esta cobrança não pertence ao seu cadastro.')
  }
  const paymentId = String(dados.paymentId || cobranca.mercadoPagoId || '').trim()
  if (!paymentId) {
    throw new HttpsError(
      'failed-precondition',
      'Esta cobrança ainda não tem boleto registrado no Mercado Pago.'
    )
  }

  try {
    const resultado = await processarAtualizacaoPagamentoMercadoPago({
      tenantId: contexto.tenantId,
      paymentId,
      boletoId,
      colecao,
      accessToken: credenciais.accessToken
    })
    return resultado
  } catch (erro) {
    console.error('[MERCADO PAGO] Falha na sincronização do boleto:', erro?.message || erro)
    throw new HttpsError(
      'failed-precondition',
      erro?.message || 'Não foi possível consultar o boleto no Mercado Pago.'
    )
  }
})

// Webhook HTTP do Mercado Pago (chamado pelos servidores do Mercado Pago
// quando um pagamento é criado, atualizado ou aprovado).
//
// URL configurada no Mercado Pago ou enviada via notification_url:
// https://us-central1-portaria-condominio-8fbc9.cloudfunctions.net/webhookMercadoPago?tenantId=...
export const webhookMercadoPago = onRequest({ cors: true }, async (req, res) => {
  // O Mercado Pago envia notificações via POST ou GET
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).send('Método não permitido')
    return
  }

  try {
    const query = req.query || {}
    const body = req.body || {}

    const { tipo, paymentId, eEventoPagamento } = extrairDadosWebhookMercadoPago({ query, body })

    // Se não for evento de pagamento ou não tiver ID, respondemos 200 para liberar a fila
    if (!eEventoPagamento || !paymentId) {
      res.status(200).json({ recebido: true, ignorado: true, motivo: 'Não é evento de pagamento ou ID ausente' })
      return
    }

    let tenantId = String(query.tenantId || '').trim()

    // Se o webhook não recebeu o tenantId explicitamente na query,
    // tentamos descobrir qual condomínio tem essa cobrança através do Access Token
    // ou buscando na collectionGroup / config_privada.
    let accessToken = ''
    if (tenantId) {
      const creds = await credenciaisMercadoPago(tenantId)
      accessToken = creds.accessToken
    }

    // Se não temos o tenantId ou não achou o token pelo tenantId,
    // tenta usar o token global da variável de ambiente (se configurada)
    if (!accessToken && process.env.MERCADO_PAGO_ACCESS_TOKEN) {
      accessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN
    }

    // Se ainda não temos accessToken, varre os condomínios cadastrados em config_privada
    if (!accessToken) {
      const privadosSnap = await db.collection('config_privada').limit(20).get()
      for (const docSnap of privadosSnap.docs) {
        const dados = docSnap.data()
        if (dados?.accessToken) {
          // Testa se esse token consegue consultar o pagamento
          const teste = await chamarApiMercadoPago(`/v1/payments/${encodeURIComponent(paymentId)}`, {
            accessToken: dados.accessToken
          })
          if (teste.ok) {
            accessToken = dados.accessToken
            tenantId = docSnap.id
            break
          }
        }
      }
    }

    if (!accessToken) {
      console.warn(`[MERCADO PAGO WEBHOOK] Não foi possível encontrar o Access Token para processar o pagamento ${paymentId}`)
      // Retorna 200 para evitar que o Mercado Pago fique tentando indefinidamente em caso de token inexistente
      res.status(200).json({ recebido: true, processado: false, motivo: 'Access Token não encontrado' })
      return
    }

    const resultado = await processarAtualizacaoPagamentoMercadoPago({
      tenantId,
      paymentId,
      accessToken
    })

    console.log(`[MERCADO PAGO WEBHOOK] Notificação processada com sucesso: Pagamento ${paymentId}, Status: ${resultado.status}, Baixa automática: ${resultado.baixaAutomatica}`)
    res.status(200).json({ recebido: true, processado: true, resultado })
  } catch (erro) {
    console.error('[MERCADO PAGO WEBHOOK] Erro ao processar notificação:', erro)
    // Retornamos 200 para evitar loop de retentativas infinitas caso seja um erro interno de regra de negócio
    res.status(200).json({ recebido: true, erro: erro?.message || 'Erro interno' })
  }
})
