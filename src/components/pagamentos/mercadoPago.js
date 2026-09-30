// Integração do app com o boleto REGISTRADO no Mercado Pago.
//
// O app NUNCA chama a API do Mercado Pago diretamente: toda emissão passa
// pelas Cloud Functions `gerarBoletoMercadoPago` e
// `sincronizarBoletoMercadoPago` (functions/index.js), que guardam o Access
// Token no servidor — credencial secreta que não pode chegar ao navegador.
//
// Aqui ficam:
//  - o cadastro das credenciais do condomínio (documento privado config_privada/
//    {condominioId}, que só o síndico e o master conseguem ler);
//  - as chamadas às funções e a tradução das mensagens de erro;
//  - o reuso das validações puras de functions/mercadopagoBoleto.js — as MESMAS
//    que o servidor executa — para avisar o usuário antes de enviar.
import { doc, getDoc, getDocFromServer, setDoc, deleteDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { app, db } from '../../firebase/config.js'
import { nowISO } from '../../utils/storage.js'
import {
  ajustarVencimentoBoleto,
  boletoEstaPago,
  completarPagador,
  construirUrlWebhookMercadoPago,
  dividirNome,
  documentoValido,
  ehTokenTesteMercadoPago,
  emailValido,
  extrairDadosBoletoResposta,
  extrairDadosWebhookMercadoPago,
  formatarCep,
  formatarUf,
  modoCredencialMercadoPago,
  montarPagamentoBoleto,
  pagadorCompleto,
  somenteDigitos,
  statusMercadoPagoLegivel,
  tipoDocumentoBoleto,
  validarEnderecoPagador,
  validarPagador,
  VALOR_MINIMO_BOLETO,
  valorDoBoleto
} from '../../../functions/mercadopagoBoleto.js'

// As telas usam as mesmas regras puras do servidor (uma única fonte de verdade).
export {
  ajustarVencimentoBoleto,
  boletoEstaPago,
  completarPagador,
  construirUrlWebhookMercadoPago,
  dividirNome,
  documentoValido,
  ehTokenTesteMercadoPago,
  emailValido,
  extrairDadosBoletoResposta,
  extrairDadosWebhookMercadoPago,
  formatarCep,
  formatarUf,
  modoCredencialMercadoPago,
  montarPagamentoBoleto,
  pagadorCompleto,
  somenteDigitos,
  statusMercadoPagoLegivel,
  tipoDocumentoBoleto,
  validarEnderecoPagador,
  validarPagador,
  VALOR_MINIMO_BOLETO,
  valorDoBoleto
}

// Documento privado das credenciais (fora de tenants/** de propósito — ver
// firestore.rules) e perfis autorizados pelas regras.
export const COLECAO_CREDENCIAIS = 'config_privada'
export const PERFIS_CREDENCIAIS_MERCADO_PAGO = ['sindico']
export const ROTULO_CREDENCIAL = 'Access Token (APP_USR-… ou TEST-…)'
export const DOC_CONFIG_PAGAMENTOS = 'config_pix'
export const ID_CONFIG_PAGAMENTOS = 'principal'

let funcoes = null

function obterFuncoes() {
  if (!funcoes) funcoes = getFunctions(app)
  return funcoes
}

// O síndico cadastrou os dados do Mercado Pago? A flag pública (sem o token)
// vive no documento de configuração de pagamentos que TODOS os moradores leem.
export function mercadoPagoAtivo(config) {
  return config?.mercadoPagoAtivo === true
}

// Uma cobrança com código de barras OFICIAL (44 dígitos) é um boleto
// registrado de verdade: os números vieram do banco (Mercado Pago), não do
// app. A linha digitável (47) é derivada do próprio código de barras quando a
// resposta da API não a trouxe — antes exigíamos as duas e uma resposta
// parcial fazia o boleto registrado voltar a aparecer como demonstração.
export function boletoRegistrado(boleto) {
  return somenteDigitos(boleto?.codigoBarras).length === 44
}

// Valor numérico da cobrança para o registro (aceita "250,00" ou número).
export function valorDoBoletoRegistrado(valor) {
  return valorDoBoleto(valor)
}

export function statusBoletoRegistrado(boleto) {
  const rotulo = statusMercadoPagoLegivel(boleto?.mercadoPagoStatus)
  if (rotulo) return rotulo
  return boletoRegistrado(boleto) ? 'Registrado' : 'Não registrado'
}

// ---------- Endereço do pagador (obrigatório no boleto) ----------

// Completa rua/bairro/cidade/UF a partir do CEP consultando o ViaCEP (base
// pública dos Correios). É um atalho de digitação: se a consulta falhar, o
// gestor preenche o endereço à mão e o boleto continua sendo registrado.
// O Mercado Pago exige esses campos desde 30/09/2024 (regra do BACEN).
export async function buscarEnderecoPorCep(cep) {
  const digitos = somenteDigitos(cep).slice(0, 8)
  if (digitos.length !== 8) {
    throw new Error('Informe um CEP com 8 dígitos para completar o endereço.')
  }
  let dados = null
  try {
    const resposta = await fetch(`https://viacep.com.br/ws/${digitos}/json/`)
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
    dados = await resposta.json()
  } catch (erro) {
    console.warn('Não foi possível consultar o CEP no ViaCEP:', erro?.message || erro)
    throw new Error('Não foi possível consultar o CEP agora — preencha o endereço manualmente.')
  }
  if (!dados || dados.erro) {
    throw new Error('CEP não encontrado — confira o número ou preencha o endereço manualmente.')
  }
  return {
    cep: formatarCep(digitos),
    logradouro: String(dados.logradouro || '').trim(),
    bairro: String(dados.bairro || '').trim(),
    cidade: String(dados.localidade || '').trim(),
    uf: formatarUf(dados.uf)
  }
}

// ---------- Credenciais (só o síndico) ----------

export async function carregarCredenciaisMercadoPago(condominioId, { doServidor = false, lancarErro = false } = {}) {
  if (!condominioId) return null
  try {
    const ler = doServidor ? getDocFromServer : getDoc
    const snap = await ler(doc(db, COLECAO_CREDENCIAIS, condominioId))
    if (!snap.exists()) return null
    return { id: snap.id, ...snap.data() }
  } catch (erro) {
    // permission-denied é o esperado para zelador/portaria/morador: as regras
    // permitem a leitura apenas do síndico (e do master).
    console.warn('Credenciais do Mercado Pago não acessíveis para este perfil:', erro?.code || erro)
    if (lancarErro) throw erro
    return null
  }
}

export async function salvarCredenciaisMercadoPago({ condominioId, accessToken, publicKey, atualizadoPor }) {
  const token = String(accessToken || '').trim()
  // Aceita produção (APP_USR-...) e teste (TEST-... da conta Vendedor de
  // teste). Qualquer outro prefixo é erro de colagem na certa.
  if (!token) throw new Error('Informe o Access Token do Mercado Pago (produção APP_USR-… ou teste TEST-…).')
  if (!/^(APP_USR-|TEST-)/i.test(token)) {
    throw new Error('Esse token não parece do Mercado Pago: use o Access Token de produção (APP_USR-…) ou o de teste (TEST-…).')
  }
  if (!condominioId) throw new Error('Usuário sem condomínio vinculado.')
  await setDoc(
    doc(db, COLECAO_CREDENCIAIS, condominioId),
    {
      accessToken: token,
      publicKey: String(publicKey || '').trim(),
      atualizadoEm: nowISO(),
      atualizadoPor: String(atualizadoPor || '')
    },
    { merge: true }
  )
  // Flag pública (sem segredo) que o morador lê para saber que o condomínio
  // emite boleto registrado.
  await setDoc(
    doc(db, 'tenants', condominioId, DOC_CONFIG_PAGAMENTOS, ID_CONFIG_PAGAMENTOS),
    {
      mercadoPagoAtivo: true,
      mercadoPagoPublicKey: String(publicKey || '').trim(),
      mercadoPagoAtualizadoEm: nowISO()
    },
    { merge: true }
  )
}

export async function removerCredenciaisMercadoPago(condominioId) {
  if (!condominioId) return
  await deleteDoc(doc(db, COLECAO_CREDENCIAIS, condominioId))
  await setDoc(
    doc(db, 'tenants', condominioId, DOC_CONFIG_PAGAMENTOS, ID_CONFIG_PAGAMENTOS),
    { mercadoPagoAtivo: false, mercadoPagoPublicKey: '', mercadoPagoAtualizadoEm: nowISO() },
    { merge: true }
  )
}

// ---------- Pré-preenchimento do formulário do pagador ----------

// Quem REGISTRA o boleto é a administração (síndico/zelador/portaria). Para ela
// não redigitarem tudo a cada cobrança, o formulário parte do que o sistema já
// sabe: a ficha da cobrança (morador*/pagador* de um registro anterior) e o
// endereço do condomínio — é lá que o devedor mora. Os dados PESSOAIS de quem
// está clicando (o síndico) NÃO entram nunca: o CPF dele não pode virar o do
// morador (usarCadastro: false).
// A montagem é a MESMA da Cloud Function (completarPagador), então o que a tela
// mostra é exatamente o que o servidor usaria se o campo ficasse em branco.
export function pagadorSugerido({ boleto, condominio } = {}) {
  return completarPagador({ cobranca: boleto, condominio, usarCadastro: false })
}

// Os dados já bastam para o Mercado Pago emitir? Mesma checagem do servidor —
// a tela usa para avisar o que falta antes de chamar a Cloud Function.
export function pagadorEstaCompleto(pagador) {
  return pagadorCompleto(pagador).ok
}

// ---------- Chamadas às Cloud Functions ----------

export async function gerarBoletoRegistrado({ boletoId, colecao, valor, descricao, dataVencimento, pagador, urlNotificacao, tenantId }) {
  const funcao = httpsCallable(obterFuncoes(), 'gerarBoletoMercadoPago')
  const resposta = await funcao({
    boletoId,
    colecao,
    valor,
    descricao,
    dataVencimento,
    pagador,
    urlNotificacao,
    tenantId
  })
  return resposta?.data || {}
}

export async function sincronizarBoletoRegistrado({ boletoId, colecao, paymentId, tenantId }) {
  const funcao = httpsCallable(obterFuncoes(), 'sincronizarBoletoMercadoPago')
  const resposta = await funcao({ boletoId, colecao, paymentId, tenantId })
  return resposta?.data || {}
}

// Traduz o erro do callable para uma frase que o síndico/morador entende —
// inclusive o caso mais comum em desenvolvimento: função ainda não publicada.
export function mensagemErroMercadoPago(erro) {
  const codigo = String(erro?.code || '')
  if (codigo.includes('unauthenticated')) return 'Sua sessão expirou. Entre novamente para falar com o Mercado Pago.'
  if (codigo.includes('permission-denied')) {
    return 'Você só pode gerar o boleto das suas próprias cobranças. Para as demais, procure a administração.'
  }
  if (codigo.includes('not-found') || codigo.includes('unimplemented')) {
    return 'A função de boleto do Mercado Pago não está publicada no Firebase. Rode "firebase deploy --only functions".'
  }
  if (codigo.includes('unavailable') || codigo.includes('internal')) {
    return 'Não foi possível falar com o serviço de boleto agora. Verifique a conexão e tente novamente.'
  }
  const mensagem = String(erro?.message || erro || '').trim()
  return mensagem || 'Não foi possível concluir a operação com o Mercado Pago.'
}
