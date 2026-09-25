import { load, save } from '../../utils/storage.js'

export const COLECAO_BOLETOS = 'boletos'
export const COLECAO_COBRANCAS_LEGADAS = 'cobrancas'

// "Cobrança mensal", "Minhas cobranças" e Pagamentos usam esta mesma chave e
// coleção. A chave antiga é mantida apenas para leitura/migração de dados.
export const chaveCobrancas = (condominioId) => `${condominioId}_boletos`
export const chaveCobrancasLegadas = (condominioId) => `${condominioId}_cobrancas`

export function normalizarEmail(valor) {
  return String(valor || '').trim().toLowerCase()
}

export function normalizarUnidade(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function idDoUsuario(usuario) {
  return String(usuario?.uid || usuario?.id || '').trim()
}

// Converte registros antigos para o vocabulário único usado em Pagamentos.
export function normalizarStatusCobranca(status) {
  if (status === 'paga' || status === 'pago') return 'pago'
  if (status === 'cancelada' || status === 'cancelado') return 'cancelado'
  if (status === 'vencido' || status === 'vencida') return 'vencido'
  return 'gerado'
}

function valorDaCobranca(valor) {
  const direto = Number(valor)
  if (Number.isFinite(direto)) return direto
  const texto = String(valor || '').trim().replace(/R\$\s?/gi, '').replace(/\s/g, '')
  if (!texto) return 0
  const brasileiro = Number(texto.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(brasileiro) ? brasileiro : 0
}

// Resumo das cobranças emitidas na tela "Cobrança mensal". O `cotaRef` é a
// referência do mês usada na geração das cotas; assim, boletos avulsos ou
// outros débitos da coleção de Pagamentos não entram no orçamento anual.
// `pagas` conta as cobranças do mês com status "pago" (modal de detalhamento).
export function resumoCobrancasDoMes(cobrancas = [], mesRef = '') {
  const referencia = String(mesRef || '').trim()
  if (!referencia) return { quantidade: 0, pagas: 0, total: 0 }

  const registros = (Array.isArray(cobrancas) ? cobrancas : []).filter((cobranca) => (
    !cobranca?.removido
    && String(cobranca?.cotaRef || '') === referencia
    && normalizarStatusCobranca(cobranca?.status) !== 'cancelado'
  ))
  const pagas = registros.filter((cobranca) => normalizarStatusCobranca(cobranca?.status) === 'pago')

  return {
    quantidade: registros.length,
    pagas: pagas.length,
    total: registros.reduce((soma, cobranca) => soma + valorDaCobranca(cobranca?.valor), 0)
  }
}

export function idBoletoMigrado(cobranca) {
  const id = String(cobranca?.id || '').replace(/[^A-Za-z0-9_-]/g, '_')
  return id ? `cota_${id}` : ''
}

function origemDoRegistro(registro) {
  return registro?._origemColecao === COLECAO_COBRANCAS_LEGADAS
    ? COLECAO_COBRANCAS_LEGADAS
    : COLECAO_BOLETOS
}

function normalizarRegistro(registro, origem) {
  if (!registro) return null
  return {
    ...registro,
    status: normalizarStatusCobranca(registro.status),
    pagoEm: registro.pagoEm || registro.pagaEm || '',
    _origemColecao: origem
  }
}

export function mesmoDestinatario(primeiro, segundo) {
  if (primeiro.moradorUserId && segundo.moradorUserId && String(primeiro.moradorUserId) === String(segundo.moradorUserId)) return true
  if (primeiro.moradorId && segundo.moradorId && String(primeiro.moradorId) === String(segundo.moradorId)) return true
  const emailPrimeiro = normalizarEmail(primeiro.moradorEmail || primeiro.email)
  const emailSegundo = normalizarEmail(segundo.moradorEmail || segundo.email)
  if (emailPrimeiro && emailPrimeiro === emailSegundo) return true
  const unidadePrimeiro = normalizarUnidade(primeiro.moradorUnidade || primeiro.unidade)
  const unidadeSegundo = normalizarUnidade(segundo.moradorUnidade || segundo.unidade)
  return Boolean(unidadePrimeiro) && unidadePrimeiro === unidadeSegundo
}

function foiMigrada(principal, legado) {
  const idMigrado = idBoletoMigrado(legado)
  if ((principal?.id && principal.id === idMigrado) ||
      (principal?.cobrancaOrigemId && String(principal.cobrancaOrigemId) === String(legado.id)) ||
      (legado?.migradoComoBoleto && principal?.id === legado.migradoComoBoleto)) return true
  // Protege contra registros antigos ainda não marcados durante a migração.
  return Boolean(principal?.cotaRef) && principal.cotaRef === legado?.cotaRef && mesmoDestinatario(principal, legado)
}

// Junta as coleções sem repetir a mesma cota. O registro canônico em "boletos"
// sempre tem prioridade sobre a cópia antiga em "cobrancas".
export function mesclarCobrancas(principais = [], legadas = []) {
  const canonicos = (Array.isArray(principais) ? principais : [])
    .map((item) => normalizarRegistro(item, COLECAO_BOLETOS))
    .filter(Boolean)
  const antigos = (Array.isArray(legadas) ? legadas : [])
    .map((item) => normalizarRegistro(item, COLECAO_COBRANCAS_LEGADAS))
    .filter(Boolean)
  return [
    ...canonicos,
    ...antigos.filter((antigo) => !canonicos.some((item) => foiMigrada(item, antigo)))
  ]
}

export function colecaoDoRegistro(registro) {
  return origemDoRegistro(registro)
}

export function carregarCobrancasLocais(condominioId) {
  if (!condominioId) return []
  const cache = load(chaveCobrancas(condominioId), []) || []
  const legadasCache = cache.filter((item) => item?._origemColecao === COLECAO_COBRANCAS_LEGADAS)
  const principaisCache = cache.filter((item) => item?._origemColecao !== COLECAO_COBRANCAS_LEGADAS)
  return mesclarCobrancas(
    principaisCache,
    [...legadasCache, ...(load(chaveCobrancasLegadas(condominioId), []) || [])]
  )
}

export function salvarCobrancasLocais(condominioId, registros) {
  if (!condominioId) return
  save(chaveCobrancas(condominioId), Array.isArray(registros) ? registros : [])
}

// Relação morador/conta: uma unidade do cadastro pode ter uma conta mesmo
// quando o e-mail mudou. A correspondência por e-mail tem prioridade; a unidade
// completa o vínculo quando não há e-mail coincidente. As demais contas da mesma
// unidade não geram uma segunda cota — o rateio é por unidade.
export function construirDestinatariosCobranca(moradores = [], usuarios = []) {
  const contas = (Array.isArray(usuarios) ? usuarios : [])
    .filter((u) => ['morador', 'conselheiro'].includes(u.role))
    .map((u) => ({
      ...u,
      _id: idDoUsuario(u),
      _email: normalizarEmail(u.email),
      _unidade: normalizarUnidade(u.unidade)
    }))
    .filter((u) => u._id)
  // Agrupa o cadastro por unidade: dois moradores do mesmo apartamento geram
  // uma cota, e todas as contas daquele apartamento conseguem encontrá-la.
  const cadastrosUnicos = new Map()
  for (const morador of (Array.isArray(moradores) ? moradores : []).filter((m) => m?.id)) {
    const unidade = normalizarUnidade(morador.unidade)
    const chave = unidade ? `unidade:${unidade}` : `morador:${morador.id}`
    const anterior = cadastrosUnicos.get(chave)
    if (!anterior || (!normalizarEmail(anterior.email) && normalizarEmail(morador.email))) {
      cadastrosUnicos.set(chave, morador)
    }
  }
  const cadastros = [...cadastrosUnicos.values()]

  const jaVinculadas = new Set()
  const doCadastro = cadastros.map((m) => {
    const email = normalizarEmail(m.email)
    const unidade = normalizarUnidade(m.unidade)
    const candidatos = contas.filter((u) => (
      (email && u._email === email) || (unidade && u._unidade === unidade)
    ))
    const principal = candidatos.find((u) => email && u._email === email) || candidatos[0] || null
    candidatos.forEach((u) => jaVinculadas.add(u._id))
    return {
      key: `mor:${m.id}`,
      moradorId: m.id,
      moradorUserId: principal?._id || '',
      nome: m.nome || principal?.nome || 'Sem nome',
      unidade: m.unidade || principal?.unidade || '',
      email: m.email || principal?.email || '',
      quartos: m.quartos ?? principal?.quartos ?? 1,
      vagas: m.vagas ?? principal?.vagas ?? 0
    }
  })

  const semCadastro = []
  const gruposPorUnidade = new Map()
  for (const conta of contas) {
    if (jaVinculadas.has(conta._id)) continue
    if (!conta._unidade) {
      semCadastro.push(conta)
      continue
    }
    const atuais = gruposPorUnidade.get(conta._unidade) || []
    atuais.push(conta)
    gruposPorUnidade.set(conta._unidade, atuais)
  }
  for (const grupo of gruposPorUnidade.values()) semCadastro.push(grupo[0])

  return [
    ...doCadastro,
    ...semCadastro.map((u) => ({
      key: `usr:${u._id}`,
      moradorId: '',
      moradorUserId: u._id,
      nome: u.nome || u.email || 'Usuário',
      unidade: u.unidade || '',
      email: u.email || '',
      quartos: u.quartos ?? 1,
      vagas: u.vagas ?? 0
    }))
  ]
}

export function cobrancaPertenceAoUsuario(cobranca, usuario) {
  if (!cobranca || !usuario) return false
  const ids = new Set([usuario.uid, usuario.id].filter(Boolean).map(String))
  if (cobranca.moradorUserId && ids.has(String(cobranca.moradorUserId))) return true
  if (cobranca.moradorId && ids.has(String(cobranca.moradorId))) return true

  const email = normalizarEmail(usuario.email)
  const emailCobranca = normalizarEmail(cobranca.moradorEmail || cobranca.email)
  if (email && email === emailCobranca) return true

  const unidade = normalizarUnidade(usuario.unidade)
  const unidadeCobranca = normalizarUnidade(cobranca.moradorUnidade || cobranca.unidade)
  return Boolean(unidade) && unidade === unidadeCobranca
}

