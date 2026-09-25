import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { db } from '../../firebase/config.js'
import { addDoc, collection, updateDoc, doc } from 'firebase/firestore'
import { PERFIS_GESTORES_PAGAMENTO } from '../pagamentos/tipos.js'
import { formatarValorBoleto, gerarNossoNumero } from '../pagamentos/boletoUtils.js'
import {
  chaveMensalidadeFixa,
  chaveMetragensTipos,
  chaveTiposExtras,
  statusEfetivoCobranca,
  ROTULO_STATUS_COBRANCA,
  CLASSE_BADGE_COBRANCA
} from './cobrancaUtils.js'
import {
  somaAprovacoesMes,
  aprovacoesDoMes,
  mesAprovadoPorAssinaturas
} from '../orcamento/orcamentoUtils.js'
import {
  COLECAO_BOLETOS,
  colecaoDoRegistro,
  normalizarUnidade,
  construirDestinatariosCobranca
} from '../pagamentos/cobrancas.js'
import { useCobrancas } from '../pagamentos/useCobrancas.js'
import { getMonthKey, uid, nowISO, load, save } from '../../utils/storage.js'

// Sistema de COBRANÇA dos moradores: as cotas mensais usam a mesma coleção
// de Pagamentos (tenants/{id}/boletos), garantindo que pagamento, consulta e
// baixa sejam atualizados em tempo real em todas as telas.


const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

const mesAtual = () => new Date().toISOString().slice(0, 7)

// '2026-09' → 'Setembro/2026'
function rotuloMes(mesRef) {
  const [ano, mes] = String(mesRef || '').split('-')
  const indice = Number(mes) - 1
  if (!ano || indice < 0 || indice > 11) return String(mesRef || '')
  return `${NOMES_MESES[indice]}/${ano}`
}

// Vencimento padrão: dia 10 do mês seguinte ao de referência.
function vencimentoPadrao(mesRef) {
  const [ano, mes] = String(mesRef || '').split('-').map(Number)
  if (!ano || !mes) return new Date().toISOString().split('T')[0]
  const data = new Date(ano, mes, 10) // mês seguinte (mes já é 1-based)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

// Rateio PROPORCIONAL à metragem (m²) de cada unidade — quem ocupa mais
// espaço paga mais. A metragem é definida por TIPO de apartamento na tabela
// de rateio (ex.: "2 quartos = 65 m²"); cada unidade herda a metragem do seu
// tipo. Cada morador recebe (metragem / metragemTotal) do valor total.
// A diferença inteira em centavos é distribuída uma a uma, das maiores para
// as menores frações (método do maior resto), garantindo que a soma feche o
// total exato.
function ratearPorMetragem(totalCents, itens) {
  const itensOk = itens.map((item, indice) => ({
    indice,
    metros: Math.max(0, Number(item.metragem) || 0)
  }))
  const somaMetros = itensOk.reduce((soma, p) => soma + p.metros, 0)
  if (somaMetros <= 0) return itens.map(() => 0)
  const exatos = itensOk.map((p) => (totalCents * p.metros) / somaMetros)
  const bases = exatos.map((exato) => Math.floor(exato))
  let resto = totalCents - bases.reduce((soma, base) => soma + base, 0)
  // Distribui o resto para as maiores frações decimais (maior resto).
  const ordem = itensOk
    .map((p, i) => ({ indice: p.indice, fracao: exatos[i] - bases[i] }))
    .sort((a, b) => b.fracao - a.fracao)
  const extras = {}
  for (const { indice } of ordem) {
    if (resto <= 0) break
    extras[indice] = 1
    resto--
  }
  return bases.map((base, i) => (base + (extras[i] || 0)) / 100)
}

// Aceita "1.234,56" ou "1234.56" vindo de input.
function numeroDe(valor) {
  if (typeof valor === 'number') return valor
  const numero = Number(String(valor || '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(numero) ? numero : 0
}

// Valor em reais com mais casas decimais (até 4) — usado para exibir quanto
// vale 1 m² do rateio sem esconder a dízima (ex.: R$ 25,8333/m²).
function formatarValorPreciso(valor, casas = 4) {
  const numero = Number(valor)
  return (Number.isFinite(numero) ? numero : 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: casas
  })
}

// Tipo de apartamento de uma unidade: agrupa por número de quartos e, quando
// houver, por vagas de garagem (ex.: "3 quartos + 1 vaga"). Studio/quitinete
// sem quarto aparece como "Studio (sem quarto)". A METRAGEM PADRÃO é uma
// estimativa a partir do tipo (30 m² de área comum + 25 m² por quarto +
// 12,5 m² por vaga) — serve como ponto de partida, mas o valor que vale é o
// definido na tabela de rateio (coluna "Metragem (m²) por unidade").
function tipoApto(quartos, vagas) {
  const q = Number(quartos)
  const v = Number(vagas)
  const quartosOk = Number.isFinite(q) ? Math.max(0, Math.trunc(q)) : 1
  const vagasOk = Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : 0
  const nomeQuartos = quartosOk === 0
    ? 'Studio (sem quarto)'
    : `${quartosOk} quarto${quartosOk > 1 ? 's' : ''}`
  const nomeVagas = vagasOk > 0 ? ` + ${vagasOk} vaga${vagasOk > 1 ? 's' : ''}` : ''
  return {
    chave: `${quartosOk}q-${vagasOk}v`,
    rotulo: `${nomeQuartos}${nomeVagas}`,
    quartos: quartosOk,
    vagas: vagasOk,
    metragemPadrao: 30 + quartosOk * 25 + vagasOk * 12.5
  }
}

// Limite de quartos e vagas por unidade — o mesmo do cadastro em Usuários.
// Usado para montar as opções do seletor "adicionar tipo" da tabela de rateio.
const MAX_QUARTOS_VAGAS = 20

// Opções dos seletores de tipo de apartamento (0 a MAX_QUARTOS_VAGAS).
const OPCOES_QUARTOS_TIPO = Array.from({ length: MAX_QUARTOS_VAGAS + 1 }, (_, n) => ({
  valor: n,
  rotulo: n === 0 ? 'Studio (sem quarto)' : `${n} quarto${n > 1 ? 's' : ''}`
}))
const OPCOES_VAGAS_TIPO = Array.from({ length: MAX_QUARTOS_VAGAS + 1 }, (_, n) => ({
  valor: n,
  rotulo: n === 0 ? 'Sem vaga' : `${n} vaga${n > 1 ? 's' : ''}`
}))

// Metragem (m²) com até 2 casas, sem zeros à toa (ex.: "65 m²", "42,5 m²").
function formatarMetros(valor) {
  const numero = Number(valor)
  const ok = Number.isFinite(numero) ? numero : 0
  return `${ok.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m²`
}

// Percentual do rateio com 2 casas (ex.: "16,67%").
function formatarPercentual(valor) {
  const numero = Number(valor)
  return `${(Number.isFinite(numero) ? numero : 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}%`
}

// O rateio é 100% pela METRAGEM (m²): cada tipo tem sua metragem definida na
// tabela (editável na coluna "Metragem (m²) por unidade"). Quem ocupa mais
// espaço paga mais — sem peso digitado à mão fora da metragem.

export default function GerarCotas() {
  const { userProfile } = useAuth()
  const { moradores, usuarios, despesas, orcamentos = [], aprovacoes = [] } = useApp()

  const [mesRef, setMesRef] = useState(mesAtual)
  const [incluirDespesas, setIncluirDespesas] = useState(true)
  // Orçamento APROVADO do mês entra no rateio somado às despesas, outras
  // despesas e fundo de reserva (pedido do condomínio).
  const [incluirOrcamento, setIncluirOrcamento] = useState(true)
  const [outrasDespesas, setOutrasDespesas] = useState('')
  const [fundoReserva, setFundoReserva] = useState('')
  const [dataVencimento, setDataVencimento] = useState(() => vencimentoPadrao(mesAtual()))
  const [descricao, setDescricao] = useState(() => `Cota condominial ${rotuloMes(mesAtual())}`)
  const [isentos, setIsentos] = useState({})
  // Seção "Cobrança mensal dos moradores" inicia recolhida para não ocupar
  // a tela; o cabeçalho segue visível com o botão Expandir/Recolher.
  const [secaoAberta, setSecaoAberta] = useState(false)
  const [previaAberta, setPreviaAberta] = useState(false)
  // Mensalidade fixa do condomínio: quando ativada, o total a ratear deixa de
  // ser calculado pelas despesas do mês e passa a ser o valor definido aqui.
  // Também fica salva no navegador por condomínio (é uma configuração que se
  // repete todo mês).
  const [usarMensalidadeFixa, setUsarMensalidadeFixa] = useState(
    () => Boolean((load(chaveMensalidadeFixa(userProfile?.condominioId), null) || {}).ativo)
  )
  const [mensalidadeFixa, setMensalidadeFixa] = useState(() => {
    const salvo = load(chaveMensalidadeFixa(userProfile?.condominioId), null) || {}
    return salvo.valor ? String(salvo.valor) : ''
  })
  // Tipos de apartamento adicionados manualmente na tabela de rateio — além
  // dos que já existem no cadastro — para deixar definido o coeficiente de um
  // tipo que ainda não tem unidade. Persistidos no navegador por condomínio.
  const [tiposExtras, setTiposExtras] = useState(
    () => load(chaveTiposExtras(userProfile?.condominioId), []) || []
  )
  const [novoTipoQuartos, setNovoTipoQuartos] = useState(1)
  const [novoTipoVagas, setNovoTipoVagas] = useState(0)
  // A mesma fonte de dados é usada por Configurações e Pagamentos.
  const [gerando, setGerando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [tipoMsg, setTipoMsg] = useState('success')

  const condominioId = userProfile?.condominioId
  const podeGerar = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role) && Boolean(condominioId)
  const {
    cobrancas,
    atualizarLocal,
    carregando: carregandoCobrancas,
    erroSincronizacao,
    firestoreAtivo
  } = useCobrancas({ ativo: podeGerar })

  // Persiste a mensalidade fixa (ativação + valor) por condomínio.
  useEffect(() => {
    if (condominioId) {
      save(chaveMensalidadeFixa(condominioId), { ativo: usarMensalidadeFixa, valor: mensalidadeFixa })
    }
  }, [usarMensalidadeFixa, mensalidadeFixa, condominioId])

  // Persiste os tipos adicionados manualmente na tabela de rateio.
  useEffect(() => {
    if (condominioId) save(chaveTiposExtras(condominioId), tiposExtras)
  }, [tiposExtras, condominioId])

  // Ao trocar o mês de referência, reaplica vencimento e descrição padrão.
  useEffect(() => {
    setDataVencimento(vencimentoPadrao(mesRef))
    setDescricao(`Cota condominial ${rotuloMes(mesRef)}`)
  }, [mesRef])


  // Destinatários: cadastro de moradores + contas de usuário com login. O
  // vínculo é por e-mail ou unidade e ambos os IDs são guardados na cobrança.
  const destinatarios = useMemo(
    () => construirDestinatariosCobranca(moradores, usuarios),
    [moradores, usuarios]
  )

  // Despesas lançadas no mês de referência. Usa 'data' com fallback para
  // 'criadoEm', igual à página Despesas — sem esse fallback, um lançamento sem
  // data ficaria fora da soma e a cota apareceria zerada.
  const despesasDoMes = useMemo(
    () => (despesas || []).filter((d) => !d.removido && getMonthKey(d.data || d.criadoEm) === mesRef),
    [despesas, mesRef]
  )
  const somaDespesasMes = despesasDoMes.reduce((soma, d) => soma + (Number(d.valor) || 0), 0)

  // Orçamento APROVADO do mês de referência: só entra no rateio com ≥3
  // assinaturas de usuários distintos (mês validado). O valor é a soma dos
  // sub-itens com ≥2 aprovações e menos de 2 rejeições (regra de "Orçado").
  const [anoOrc, mesOrc] = String(mesRef || '').split('-').map(Number)
  const orcamentosDoMes = useMemo(
    () => (orcamentos || []).filter((o) => Number(o.ano) === Number(anoOrc) && Number(o.mes) === Number(mesOrc)),
    [orcamentos, anoOrc, mesOrc]
  )
  const aprovacoesDoMesRef = useMemo(
    () => aprovacoesDoMes(aprovacoes || [], anoOrc, mesOrc),
    [aprovacoes, anoOrc, mesOrc]
  )
  const orcamentoMesAprovado = mesAprovadoPorAssinaturas(aprovacoesDoMesRef)
  const somaOrcamentoAprovadoMes = orcamentoMesAprovado
    ? somaAprovacoesMes(orcamentosDoMes, aprovacoesDoMesRef)
    : 0

  // Meses (diferentes do escolhido) que têm despesas lançadas — usados para
  // explicar na tela por que o total a ratear está zerado.
  const despesasOutrosMeses = useMemo(() => {
    const mapa = {}
    for (const d of despesas || []) {
      if (d.removido) continue
      const chave = getMonthKey(d.data || d.criadoEm)
      if (!chave || chave === mesRef) continue
      if (!mapa[chave]) mapa[chave] = { mes: chave, lancamentos: 0, total: 0 }
      mapa[chave].lancamentos += 1
      mapa[chave].total += Number(d.valor) || 0
    }
    return Object.values(mapa).sort((a, b) => b.mes.localeCompare(a.mes))
  }, [despesas, mesRef])

  const totalDespesasMes =
    (incluirDespesas ? somaDespesasMes : 0) +
    (incluirOrcamento ? somaOrcamentoAprovadoMes : 0) +
    numeroDe(outrasDespesas) + numeroDe(fundoReserva)

  // Mensalidade fixa ativada e válida substitui o total calculado pelas despesas.
  const valorMensalidadeFixa = numeroDe(mensalidadeFixa)
  const mensalidadeFixaAtiva = usarMensalidadeFixa && valorMensalidadeFixa > 0
  const totalCotas = mensalidadeFixaAtiva ? valorMensalidadeFixa : totalDespesasMes

  const ativos = destinatarios.filter((d) => !isentos[d.key])

  // Metragens definidas por tipo de apartamento na tabela de rateio — o que
  // vale no cálculo. Quando um tipo ainda não tem metragem própria, usa a
  // metragem padrão estimada dele (30 + 25/quarto + 12,5/vaga).
  // Persistidas no navegador por condomínio; "Restaurar metragens padrão"
  // limpa as definidas e volta para a estimativa.
  const [metragensTipos, setMetragensTipos] = useState(
    () => load(chaveMetragensTipos(userProfile?.condominioId), {}) || {}
  )

  // Persiste as metragens definidas na tabela de rateio.
  useEffect(() => {
    if (condominioId) save(chaveMetragensTipos(condominioId), metragensTipos)
  }, [metragensTipos, condominioId])

  // Metragem efetiva de um tipo: definida na tabela ou a estimativa padrão.
  const metragemDoTipo = useCallback((tipo) => {
    const definida = Number(
      String(metragensTipos[tipo.chave] ?? '').replace(/\./g, '').replace(',', '.')
    )
    if (Number.isFinite(definida) && definida > 0) return definida
    return tipo.metragemPadrao
  }, [metragensTipos])

  // Quartos, vagas e tipo de apartamento da unidade de um destinatário — lidos
  // do cadastro de moradores ou da conta de usuário. Usa "??" para respeitar
  // 0 quartos (studio/quitinete). A metragem que vale no rateio é a definida
  // na tabela para o tipo da unidade (ou a estimativa padrão dele).
  const dadosDoDestinatario = useCallback((d) => {
    const m = (moradores || []).find((x) => x.id === d.moradorId)
    const u = (usuarios || []).find((x) => String(x.id) === String(d.moradorUserId) || String(x.uid) === String(d.moradorUserId))
    const quartos = Number(m?.quartos ?? u?.quartos ?? d.quartos ?? 1)
    const vagas = Number(m?.vagas ?? u?.vagas ?? d.vagas ?? 0)
    const tipo = tipoApto(quartos, vagas)
    return { quartos, vagas, tipo, metragem: metragemDoTipo(tipo) }
  }, [moradores, usuarios, metragemDoTipo])

  // Números da fórmula exibida na tela: soma das metragens das unidades que
  // entram no rateio e quanto vale 1 m².
  const somaMetros = ativos.reduce(
    (soma, d) => soma + dadosDoDestinatario(d).metragem, 0
  )
  const valorPorMetro = somaMetros > 0 ? totalCotas / somaMetros : 0

  // Cota já gerada para este mês quando existe cobrança com o mesmo cotaRef
  // e o mesmo destinatário (id do cadastro, uid da conta, e-mail ou unidade).
  const jaGerado = (item) => cobrancas.some((c) => !c.removido
    && c.cotaRef === mesRef
    && ((item.moradorId && c.moradorId === item.moradorId)
      || (item.moradorUserId && c.moradorUserId === item.moradorUserId)
      || (item.email && String(c.moradorEmail || '').trim().toLowerCase() === item.email.trim().toLowerCase())
      || (item.unidade && normalizarUnidade(c.moradorUnidade) === normalizarUnidade(item.unidade))))

  // Cobranças já geradas para o mês de referência (listagem com baixa).
  const cobrancasDoMes = useMemo(() => cobrancas
    .filter((c) => !c.removido && c.cotaRef === mesRef)
    .sort((a, b) => String(a.moradorNome || '').localeCompare(String(b.moradorNome || ''))),
  [cobrancas, mesRef])

  // Prévia com valores por destinatário: rateio PROPORCIONAL À METRAGEM (m²)
  // de cada unidade (centavos pelo método do maior resto).
  const previa = useMemo(() => {
    const ativosComMetragem = destinatarios
      .filter((d) => !isentos[d.key])
      .map((d) => ({ ...d, ...dadosDoDestinatario(d) }))
    const valores = ratearPorMetragem(Math.round(totalCotas * 100), ativosComMetragem)
    const valorPorKey = {}
    ativosComMetragem.forEach((item, indice) => { valorPorKey[item.key] = valores[indice] })
    return destinatarios.map((d) => {
      const isento = Boolean(isentos[d.key])
      const { quartos, vagas, tipo, metragem } = dadosDoDestinatario(d)
      return {
        ...d,
        tipo,
        quartos: isento ? 0 : quartos,
        vagas: isento ? 0 : vagas,
        metragem: isento ? 0 : metragem,
        isento,
        valor: isento ? 0 : valorPorKey[d.key] ?? 0,
        jaGerado: jaGerado(d)
      }
    })
  }, [destinatarios, isentos, totalCotas, cobrancas, mesRef, dadosDoDestinatario])

  // Tabela de rateio por TIPO DE APARTAMENTO: quantas unidades de cada tipo
  // participam, a metragem (m²) definida na tabela, o percentual do rateio e
  // o valor por unidade. Parte dos valores já calculados na prévia, então a
  // soma das linhas fecha exatamente o total a ratear.
  const tiposRateio = useMemo(() => {
    const mapa = {}
    for (const p of previa) {
      if (p.isento) continue
      const chave = p.tipo.chave
      if (!mapa[chave]) {
        mapa[chave] = { ...p.tipo, unidades: 0, metragem: p.metragem, soma: 0 }
      }
      mapa[chave].unidades += 1
      mapa[chave].soma += p.valor
    }
    const linhas = Object.values(mapa).sort((a, b) => (a.quartos - b.quartos) || (a.vagas - b.vagas))
    const somaMetrosTipo = linhas.reduce((soma, l) => soma + l.metragem * l.unidades, 0)
    return linhas.map((l) => {
      const metrosTotal = l.metragem * l.unidades
      return {
        ...l,
        metrosTotal,
        percentual: somaMetrosTipo > 0 ? (metrosTotal / somaMetrosTipo) * 100 : 0,
        valorUnidade: l.unidades > 0 ? l.soma / l.unidades : 0
      }
    })
  }, [previa])

  const unidadesNoRateio = tiposRateio.reduce((soma, linha) => soma + linha.unidades, 0)

  // Linhas exibidas na tabela de rateio: TODOS os tipos que existem no
  // cadastro (com unidades, percentual e valor reais) + os tipos adicionados
  // manualmente no seletor. Para um tipo adicionado que ainda tem 0 unidade a
  // tabela mostra uma SIMULAÇÃO com 1 unidade hipotética: qual seria o % e o
  // valor da cota se existisse uma unidade desse tipo — marcada com o badge
  // "simulado" e com um asterisco nos números. A simulação NÃO entra no Total
  // nem na prévia: é só para conferir a metragem/percentual/valor do tipo
  // antes de cadastrá-lo.
  const linhasTabela = useMemo(() => {
    const porChave = {}
    for (const linha of tiposRateio) porChave[linha.chave] = linha
    for (const extra of tiposExtras) {
      const tipo = tipoApto(extra?.quartos, extra?.vagas)
      if (porChave[tipo.chave]) continue
      const metragem = metragemDoTipo(tipo)
      const somaComExtra = somaMetros + metragem
      porChave[tipo.chave] = {
        ...tipo,
        unidades: 0,
        metragem,
        metrosTotal: 0,
        soma: 0,
        percentual: 0,
        valorUnidade: 0,
        extra: true,
        // Simulação: 1 unidade deste tipo somada às unidades reais.
        pctSimulado: somaComExtra > 0 ? (metragem / somaComExtra) * 100 : 0,
        valorSimulado: somaComExtra > 0 && totalCotas > 0 ? (totalCotas * metragem) / somaComExtra : 0,
        metrosSomaSimulada: somaComExtra
      }
    }
    return Object.values(porChave).sort((a, b) => (a.quartos - b.quartos) || (a.vagas - b.vagas))
  }, [tiposRateio, tiposExtras, somaMetros, totalCotas, metragemDoTipo])

  // Adiciona o tipo escolhido nos seletores (ignora se esse tipo já está na
  // tabela — inclusive quando já existe no cadastro).
  function adicionarTipo() {
    const tipo = tipoApto(novoTipoQuartos, novoTipoVagas)
    setTiposExtras((atual) =>
      atual.some((e) => tipoApto(e?.quartos, e?.vagas).chave === tipo.chave)
        ? atual
        : [...atual, { quartos: tipo.quartos, vagas: tipo.vagas }]
    )
  }

  function removerTipo(chave) {
    setTiposExtras((atual) =>
      atual.filter((e) => tipoApto(e?.quartos, e?.vagas).chave !== chave)
    )
  }

  const pendentes = previa.filter((p) => !p.isento && !p.jaGerado)
  const jaGeradosCount = previa.filter((p) => p.jaGerado).length
  const somaRateada = previa.reduce((soma, p) => soma + p.valor, 0)

  async function gerarCotas() {
    if (!podeGerar || pendentes.length === 0) return
    if (!dataVencimento) {
      setMensagem('Informe a data de vencimento das cobranças.')
      setTipoMsg('error')
      return
    }
    setGerando(true)
    setMensagem('')
    const locais = [...cobrancas]
    const emitidoPor = userProfile?.nome || userProfile?.email || 'sistema'
    let criados = 0
    let falhas = 0

    for (const item of pendentes) {
      const dados = {
        moradorId: item.moradorId,
        moradorUserId: item.moradorUserId,
        moradorNome: item.nome,
        moradorUnidade: item.unidade,
        moradorEmail: item.email,
        descricao: descricao.trim() || `Cota condominial ${rotuloMes(mesRef)}`,
        valor: item.valor,
        dataVencimento,
        status: 'gerado',
        tipo: 'mensalidade',
        nossoNumero: gerarNossoNumero(),
        observacoes: '',
        pagoEm: '',
        baixaPor: '',
        emitidoPor,
        cotaRef: mesRef,
        // Rastreabilidade do rateio: tipo/metragem da unidade, total rateado
        // e a origem do total (despesas do mês ou mensalidade fixa).
        tipoApartamento: item.tipo?.rotulo || '',
        metragemRateio: item.metragem,
        metrosTotalRateio: somaMetros,
        cotaTotal: totalCotas,
        cotaOrigem: mensalidadeFixaAtiva ? 'mensalidade-fixa' : 'despesas+orcamento',
        cotaDetalhe: mensalidadeFixaAtiva ? null : {
          despesas: incluirDespesas ? somaDespesasMes : 0,
          orcamentoAprovado: incluirOrcamento ? somaOrcamentoAprovadoMes : 0,
          orcamentoMesAprovado,
          outrasDespesas: numeroDe(outrasDespesas),
          fundoReserva: numeroDe(fundoReserva)
        },
      }
      try {
        if (firestoreAtivo) {
          await addDoc(collection(db, 'tenants', condominioId, COLECAO_BOLETOS), {
            ...dados, criadoEm: nowISO(), atualizadoEm: nowISO(), condominioId, removido: false
          })
        } else {
          throw new Error('sem-firestore')
        }
      } catch (erro) {
        if (erro?.message !== 'sem-firestore') {
          console.error('Erro ao gerar cobrança para', item.nome, erro)
          falhas++
          continue
        }
        // Sem Firestore: mantém as cobranças neste dispositivo (a lista local
        // é substituída assim que o Firestore volta a responder).
        locais.push({ ...dados, id: uid(), criadoEm: nowISO(), atualizadoEm: nowISO(), removido: false })
      }
      criados++
    }

    if (!firestoreAtivo && criados > 0) {
      atualizarLocal(locais)
    }

    const ignorados = jaGeradosCount
    setMensagem(
      `${criados} cobrança(s) gerada(s) para ${rotuloMes(mesRef)}` +
      (ignorados ? ` · ${ignorados} já existente(s) foram ignorado(s)` : '') +
      (falhas ? ` · ${falhas} falha(s) — tente novamente` : '') +
      (firestoreAtivo ? '' : ' (salvas neste dispositivo)')
    )
    setTipoMsg(falhas ? 'error' : firestoreAtivo ? 'success' : 'info')
    setGerando(false)
  }

  // Baixa da cobrança: paga, reabrir ou cancelar (síndico/zelador/portaria).
  async function atualizarStatusCobranca(cobranca, novoStatus) {
    if (novoStatus === 'cancelado' && !window.confirm(`Cancelar a cobrança de ${cobranca.moradorNome}?`)) return
    const alteracao = { status: novoStatus, atualizadoEm: nowISO() }
    if (novoStatus === 'pago') {
      alteracao.pagoEm = nowISO()
      alteracao.baixaPor = userProfile?.nome || userProfile?.email || 'sistema'
    } else {
      alteracao.pagoEm = ''
    }
    if (firestoreAtivo) {
      try {
        await updateDoc(doc(db, 'tenants', condominioId, colecaoDoRegistro(cobranca), cobranca.id), alteracao)
        return
      } catch (erro) {
        console.error('Erro ao atualizar cobrança:', erro)
        setMensagem('Não foi possível atualizar a cobrança. Verifique a conexão e tente novamente.')
        setTipoMsg('error')
        return
      }
    }
    atualizarLocal((atuais) => atuais.map((c) => (
      c.id === cobranca.id ? { ...c, ...alteracao } : c
    )))
  }

  // Edição de uma cobrança gerada: valor, vencimento, descrição, observações.
  // Status continua sob o controle dos botões de baixa/reabrir/cancelar.
  const [editando, setEditando] = useState(null)

  function numeroDeForm(valor) {
    const numero = Number(String(valor || '').replace(/\\./g, '').replace(',', '.'))
    return Number.isFinite(numero) ? numero : 0
  }

  async function atualizarCobranca(cobranca, partes) {
    const agora = nowISO()
    const alteracao = { ...partes, atualizadoEm: agora }
    if (firestoreAtivo) {
      try {
        await updateDoc(doc(db, 'tenants', condominioId, colecaoDoRegistro(cobranca), cobranca.id), alteracao)
        return
      } catch (erro) {
        console.error('Erro ao editar cobrança:', erro)
        setMensagem('Não foi possível editar a cobrança. Verifique a conexão e tente novamente.')
        setTipoMsg('error')
        return
      }
    }
    atualizarLocal((atuais) => atuais.map((c) => (
      c.id === cobranca.id ? { ...c, ...alteracao } : c
    )))
  }

  // Exclusão lógica da cobrança: sai das listagens (administração e
  // "Minhas cobranças") sem apagar o histórico gravado no Firestore.
  async function excluirCobranca(cobranca) {
    const nome = cobranca.moradorNome || 'morador'
    const valor = formatarValorBoleto(cobranca.valor)
    if (!window.confirm(`Excluir a cobrança de ${nome} (${valor})?`)) return
    const alteracao = { removido: true, removidoEm: nowISO(), atualizadoEm: nowISO() }
    if (firestoreAtivo) {
      try {
        await updateDoc(doc(db, 'tenants', condominioId, colecaoDoRegistro(cobranca), cobranca.id), alteracao)
        setMensagem('Cobrança excluída.')
        setTipoMsg('success')
      } catch (erro) {
        console.error('Erro ao excluir cobrança:', erro)
        setMensagem('Não foi possível excluir a cobrança. Verifique a conexão e tente novamente.')
        setTipoMsg('error')
      }
    } else {
      atualizarLocal((atuais) => atuais.map((c) => (
        c.id === cobranca.id ? { ...c, ...alteracao } : c
      )))
      setMensagem('Cobrança excluída neste dispositivo.')
      setTipoMsg('info')
    }
    if (editando?.id === cobranca.id) setEditando(null)
  }

  function abrirFormulario(cobranca) {
    setEditando({
      id: cobranca.id,
      valor: String(cobranca.valor || '0').replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
      dataVencimento: cobranca.dataVencimento || '',
      descricao: cobranca.descricao || '',
      observacoes: cobranca.observacoes || '',
    })
  }

  function cancelarFormulario() {
    setEditando(null)
  }


  if (!podeGerar) return null

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h3>Cobrança mensal dos moradores</h3>
        <button
          type="button"
          className="btn btn-ghost btn-small"
          onClick={() => setSecaoAberta((aberto) => !aberto)}
          aria-expanded={secaoAberta}
        >
          {secaoAberta ? '▾ Recolher' : '▸ Expandir'}
        </button>
      </div>
      {secaoAberta && (
      <div className="card-body">
        <p className="hint" style={{ marginBottom: 12, color: 'var(--ink-soft)', fontSize: 15.6 }}>
          Calcula a cota de cada morador do mês e gera as cobranças de uma vez.
          Cada morador acompanha as cobranças dele aqui nas Configurações
          ("Minhas cobranças") e a administração dá a baixa quando forem quitadas.
        </p>

        {erroSincronizacao && (
          <div className="alert alert-error" style={{ marginBottom: 12 }}>{erroSincronizacao}</div>
        )}
        {carregandoCobrancas && <div className="loading">Sincronizando cobranças...</div>}

        {mensagem && (
          <div className={'alert ' + (tipoMsg === 'error' ? 'alert-error' : tipoMsg === 'success' ? 'alert-success' : 'alert-info')}>
            {mensagem}
          </div>
        )}

        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="cota-mes">Mês de referência</label>
            <input id="cota-mes" type="month" value={mesRef} onChange={(e) => setMesRef(e.target.value)} className="input" />
          </div>
          <div className="form-group">
            <label htmlFor="cota-vencimento">Vencimento</label>
            <input id="cota-vencimento" type="date" value={dataVencimento} onChange={(e) => setDataVencimento(e.target.value)} className="input" />
          </div>
          <div className="form-group">
            <label htmlFor="cota-outras">Outras despesas a ratear (R$)</label>
            <input id="cota-outras" type="text" inputMode="decimal" value={outrasDespesas} onChange={(e) => setOutrasDespesas(e.target.value)} placeholder="0,00" className="input" />
          </div>
          <div className="form-group">
            <label htmlFor="cota-reserva">Fundo de reserva (R$)</label>
            <input id="cota-reserva" type="text" inputMode="decimal" value={fundoReserva} onChange={(e) => setFundoReserva(e.target.value)} placeholder="0,00" className="input" />
          </div>
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="cota-descricao">Descrição nas cobranças</label>
            <input id="cota-descricao" type="text" value={descricao} onChange={(e) => setDescricao(e.target.value)} className="input" />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={incluirDespesas}
            onChange={(e) => setIncluirDespesas(e.target.checked)}
          />
          <span>
            Somar as despesas lançadas no sistema para {rotuloMes(mesRef)} (
            {despesasDoMes.length} lançamento(s) — {formatarValorBoleto(somaDespesasMes)})
          </span>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={incluirOrcamento}
            onChange={(e) => setIncluirOrcamento(e.target.checked)}
          />
          <span>
            Somar o orçamento aprovado de {rotuloMes(mesRef)} (
            {orcamentoMesAprovado
              ? `aprovado — ${formatarValorBoleto(somaOrcamentoAprovadoMes)}`
              : 'mês ainda sem as 3 aprovações — R$ 0,00'})
          </span>
        </label>

        <div
          style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8,
            background: 'var(--paper)', border: '1px solid var(--line)'
          }}
        >
          <div>
            Total a ratear: <strong>{formatarValorBoleto(totalCotas)}</strong>
            {' '}· {ativos.length} morador(es) incluído(s) ·{' '}
            {formatarMetros(somaMetros)} no rateio
            {mensalidadeFixaAtiva && ' (mensalidade fixa)'}
          </div>

          {/* Explica por que tudo aparece como R$ 0,00 quando não há valor a ratear */}
          {totalCotas <= 0 && (
            <div
              style={{
                marginTop: 8, padding: '8px 10px', borderRadius: 6,
                background: 'var(--brass-soft)', border: '1px solid var(--brass)',
                fontSize: 13, lineHeight: 1.6
              }}
            >
              <strong>
                Nenhum valor a ratear em {rotuloMes(mesRef)} — por isso as cotas ficam em R$ 0,00.
              </strong>{' '}
              Não há despesas lançadas neste mês, orçamento aprovado, outras despesas/fundo de reserva informados, e a
              mensalidade fixa está desativada. Para o rateio ter valor, lance as despesas em{' '}
              <strong>Despesas</strong> (com a data no mês de referência) ou ative{' '}
              <strong>“Fixar uma mensalidade do condomínio”</strong> na tabela logo abaixo.
              {despesasOutrosMeses.length > 0 && (
                <>
                  {' '}Existem lançamentos em{' '}
                  {despesasOutrosMeses.slice(0, 3).map((m, indice) => (
                    <React.Fragment key={m.mes}>
                      {indice > 0 && ', '}
                      <strong>{rotuloMes(m.mes)}</strong> ({m.lancamentos} ·{' '}
                      {formatarValorBoleto(m.total)})
                    </React.Fragment>
                  ))}{' '}
                  — confira o mês de referência no topo do formulário.
                </>
              )}
            </div>
          )}

          {/* Fórmula e regras do rateio — sempre visíveis para conferir a cota */}
          <div
            style={{
              marginTop: 8,
              paddingTop: 8,
              borderTop: '1px dashed var(--line)',
              fontSize: 13,
              lineHeight: 1.7
            }}
          >
            <div>
              <strong>Fórmula:</strong> cota da unidade ={' '}
              <em>Total a ratear × metragem da unidade ÷ soma das metragens</em> — quem
              ocupa mais espaço (mais m²) paga uma parcela maior da mensalidade
            </div>
            <div style={{ color: 'var(--ink-soft)' }}>
              {mensalidadeFixaAtiva ? (
                <>
                  Total deste mês: <strong>mensalidade fixa do condomínio</strong> de{' '}
                  {formatarValorBoleto(totalCotas)} — as despesas lançadas
                  ({formatarValorBoleto(totalDespesasMes)}) não entram neste rateio
                </>
              ) : (
                <>
                  Total deste mês: {incluirDespesas ? formatarValorBoleto(somaDespesasMes) : formatarValorBoleto(0)} de despesas
                  {' '}+ {incluirOrcamento ? formatarValorBoleto(somaOrcamentoAprovadoMes) : formatarValorBoleto(0)} de orçamento aprovado
                  {' '}+ {formatarValorBoleto(numeroDe(outrasDespesas))} de outras despesas
                  {' '}+ {formatarValorBoleto(numeroDe(fundoReserva))} de fundo de reserva
                  {' '}= {formatarValorBoleto(totalCotas)}
                </>
              )}
            </div>
            <div style={{ color: 'var(--ink-soft)' }}>
              Neste rateio: {formatarValorBoleto(totalCotas)} ÷ {formatarMetros(somaMetros)} ={' '}
              <strong>{formatarValorPreciso(valorPorMetro)}/m²</strong> — cada unidade recebe
              esse valor multiplicado pela metragem dela
            </div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--ink-soft)' }}>
              <li>
                A metragem é definida por <strong>tipo de apartamento</strong> na tabela
                abaixo (coluna “Metragem (m²) por unidade”) e vale para todas as
                unidades daquele tipo — quartos e vagas servem só para identificar o
                tipo (ex.: “2 quartos”).
              </li>
              <li>
                Ao gerar a tabela pela primeira vez, a metragem já vem preenchida com
                uma estimativa (30 m² de área comum + 25 m² por quarto + 12,5 m² por
                vaga) — ajuste para a metragem real de cada tipo antes de gerar.
              </li>
              <li>
                <strong>100% das unidades participam</strong>: todo tipo de apartamento entra no
                rateio, e quem tem mais metragem paga uma parcela maior da mensalidade.
              </li>
              <li>
                Com a <strong>mensalidade fixa do condomínio</strong> ativada, o total a ratear passa
                a ser esse valor informado, em vez das despesas do mês.
              </li>
              <li>
                Unidades marcadas como <strong>Isento</strong> na prévia saem da soma das metragens e
                ficam com R$ 0,00.
              </li>
              <li>
                Os centavos que não dividem exato são distribuídos pelo{' '}
                <strong>método do maior resto</strong> (maiores frações), para que a soma das cotas
                feche exatamente o total a ratear — sem sobra nem falta de centavo.
              </li>
            </ul>
          </div>
        </div>

        {/* Tabela de rateio por TIPO DE APARTAMENTO + opção de mensalidade fixa */}
        <div
          style={{
            marginTop: 12, padding: '10px 14px', borderRadius: 8,
            background: 'var(--paper)', border: '1px solid var(--line)'
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>
              Rateio por tipo de apartamento
              <span className="badge badge-gray" style={{ marginLeft: 8 }}>
                {unidadesNoRateio} unidade(s) · {formatarMetros(somaMetros)}
              </span>
              {totalCotas <= 0 && (
                <span className="badge badge-orange" style={{ marginLeft: 8 }}>
                  sem valor a ratear — cotas em R$ 0,00
                </span>
              )}
            </strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setTiposExtras([])}
                disabled={tiposExtras.length === 0}
                title="Remove os tipos adicionados manualmente (os do cadastro continuam)"
              >
                Limpar tipos adicionados
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8, fontSize: 13 }}>
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={usarMensalidadeFixa}
                onChange={(e) => setUsarMensalidadeFixa(e.target.checked)}
              />
              <span>
                <strong>Fixar uma mensalidade do condomínio</strong> — em vez das despesas do mês,
                rateia este valor fixo
              </span>
            </label>
            {usarMensalidadeFixa && (
              <div className="field" style={{ marginTop: 8, maxWidth: 240 }}>
                <label htmlFor="mensalidade-fixa">Mensalidade fixa (R$)</label>
                <input
                  id="mensalidade-fixa"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={mensalidadeFixa}
                  onChange={(e) => setMensalidadeFixa(e.target.value)}
                />
                {valorMensalidadeFixa <= 0 && (
                  <span className="hint">Informe um valor maior que zero para usar a mensalidade fixa.</span>
                )}
              </div>
            )}
          </div>

          {/* Adicionar qualquer tipo de apartamento (quartos × vagas) para
              conferir antecipadamente a metragem, o percentual e o valor
              que ele teria no rateio. */}
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <div className="field" style={{ margin: 0, maxWidth: 190 }}>
              <label htmlFor="novo-tipo-quartos">Adicionar tipo — quartos</label>
              <select
                id="novo-tipo-quartos"
                value={novoTipoQuartos}
                onChange={(e) => setNovoTipoQuartos(Number(e.target.value))}
              >
                {OPCOES_QUARTOS_TIPO.map((o) => (
                  <option key={`q-${o.valor}`} value={o.valor}>{o.rotulo}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ margin: 0, maxWidth: 160 }}>
              <label htmlFor="novo-tipo-vagas">Vagas de garagem</label>
              <select
                id="novo-tipo-vagas"
                value={novoTipoVagas}
                onChange={(e) => setNovoTipoVagas(Number(e.target.value))}
              >
                {OPCOES_VAGAS_TIPO.map((o) => (
                  <option key={`v-${o.valor}`} value={o.valor}>{o.rotulo}</option>
                ))}
              </select>
            </div>
            <button type="button" className="btn btn-ghost" onClick={adicionarTipo}>
              Adicionar tipo
            </button>
            <span className="hint" style={{ fontSize: 12 }}>
              tipo já listado não é duplicado
            </span>
          </div>

          {linhasTabela.length === 0 ? (
            <p className="hint" style={{ marginTop: 10 }}>
              Nenhum tipo de apartamento na tabela — cadastre os quartos/vagas dos moradores em
              Usuários ou use o seletor acima para adicionar um tipo.
            </p>
          ) : (
            <div style={{ marginTop: 10, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--ink-soft)' }}>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>Tipo de apartamento</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>Unidades</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                      Metragem (m²) por unidade
                    </th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>% do rateio</th>
                    <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>Valor por unidade</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasTabela.map((l) => (
                    <tr key={`tipo-${l.chave}`}>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                        {l.rotulo}
                        {l.extra && (
                          <>
                            <span className="badge badge-blue" style={{ marginLeft: 8 }}>adicionado</span>
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              style={{ marginLeft: 6 }}
                              onClick={() => removerTipo(l.chave)}
                              title="Remover este tipo da tabela"
                            >
                              Remover
                            </button>
                          </>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                        {l.unidades}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                        <span
                          className="badge badge-gray"
                          title={`Metragem do tipo ${l.rotulo}`}
                        >
                          {formatarMetros(l.metragem)}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                        {l.unidades > 0 ? (
                          formatarPercentual(l.percentual)
                        ) : (
                          <span title={`Simulação com 1 unidade deste tipo: metragem ${formatarMetros(l.metragem)} ÷ ${formatarMetros(l.metrosSomaSimulada)} de metragem no total`}>
                            {formatarPercentual(l.pctSimulado)}*
                            {' '}<span className="badge badge-gray">simulado</span>
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', textAlign: 'right' }}>
                        {l.unidades > 0 ? (
                          formatarValorBoleto(l.valorUnidade)
                        ) : (
                          <span title="Simulação com 1 unidade deste tipo — não entra no Total nem na prévia">
                            {formatarValorBoleto(l.valorSimulado)}*
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td style={{ padding: '8px', fontWeight: 600 }}>Total</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{unidadesNoRateio}</td>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{formatarMetros(somaMetros)}</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>100,00%</td>
                    <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>
                      {formatarValorBoleto(totalCotas)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <p className="hint" style={{ marginTop: 8 }}>
            A metragem é definida por <strong>tipo de apartamento</strong> e pode ser ajustada
            na tabela acima; ela é usada no cálculo da cota. Cada unidade paga{' '}
            <em>metragem ÷ soma das metragens × total a ratear</em>. Os tipos adicionados no seletor
            mostram com asterisco (*) uma <strong>simulação com 1 unidade hipotética</strong> — o %
            e o valor que 1 unidade desse tipo teria somada às unidades reais (sem entrar no Total
            nem na prévia). Eles passam a valer de verdade no rateio assim que houver uma unidade
            desse tipo no cadastro.
          </p>
        </div>

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-brass"
            onClick={gerarCotas}
            disabled={gerando || pendentes.length === 0 || totalCotas <= 0 || !dataVencimento}
          >
            {gerando ? 'Gerando...' : `Gerar ${pendentes.length} cobrança(s)`}
          </button>
        </div>

        {cobrancasDoMes.length > 0 && (
          <>
            <strong style={{ display: 'block', marginTop: 14, fontSize: 14 }}>
              Cobranças de {rotuloMes(mesRef)}
              <span className="badge badge-gray" style={{ marginLeft: 8 }}>
                {cobrancasDoMes.length} cobrança(s) · {formatarValorBoleto(cobrancasDoMes.reduce((s, c) => s + (Number(c.valor) || 0), 0))}
              </span>
            </strong>
            <div className="boletos-lista" style={{ marginTop: 8 }}>
              {cobrancasDoMes.map((c) => {
                const status = statusEfetivoCobranca(c)
                const emAberto = status === 'pendente' || status === 'vencida'
                return (
                  <React.Fragment key={c.id}>
                  <div key={c.id} className="boleto-item">
                    <div className="boleto-info">
                      <div className="boleto-header">
                        <strong>{c.moradorNome || 'Sem morador'}{c.moradorUnidade ? ` — ${c.moradorUnidade}` : ''}</strong>
                        <span className={`badge ${CLASSE_BADGE_COBRANCA[status] || 'badge-gray'}`}>
                          {ROTULO_STATUS_COBRANCA[status] || status}
                        </span>
                      </div>
                      <div className="boleto-dados">
                        <span>Valor: <strong>{formatarValorBoleto(c.valor)}</strong></span>
                        <span>Vencimento: <strong>{c.dataVencimento || '-'}</strong></span>
                        {status === 'pago' && c.pagoEm && (
                          <span>Pago em: <strong>{new Date(c.pagoEm).toLocaleDateString('pt-BR')}</strong></span>
                        )}
                      </div>
                    </div>
                    <div className="boleto-actions" style={{ alignItems: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-ghost btn-small"
                          onClick={() => abrirFormulario(c)}
                        >
                          Editar
                        </button>
                        {emAberto && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            onClick={() => atualizarStatusCobranca(c, 'pago')}
                          >
                            Marcar como paga
                          </button>
                        )}
                        {(status === 'pago' || status === 'cancelado') && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            onClick={() => atualizarStatusCobranca(c, 'gerado')}
                          >
                            Reabrir
                          </button>
                        )}
                        {emAberto && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-small btn-danger"
                            onClick={() => atualizarStatusCobranca(c, 'cancelado')}
                          >
                            Cancelar
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-small btn-danger"
                          onClick={() => excluirCobranca(c)}
                        >
                          Excluir
                        </button>
                    </div>
                  </div>
                  {editando?.id === c.id && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: '10px 14px',
                        borderRadius: 8,
                        background: 'var(--paper)',
                        border: '1px solid var(--line)'
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--ink)' }}>
                        Editar cobrança de {c.moradorNome || 'morador'}
                      </div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label htmlFor={`edit-valor-${c.id}`}>Valor (R$)</label>
                          <input
                            id={`edit-valor-${c.id}`}
                            type="text"
                            inputMode="decimal"
                            value={editando.valor}
                            onChange={(e) => setEditando((a) => a && { ...a, valor: e.target.value })}
                            className="input"
                          />
                        </div>
                        <div className="form-group">
                          <label htmlFor={`edit-vencimento-${c.id}`}>Vencimento</label>
                          <input
                            id={`edit-vencimento-${c.id}`}
                            type="date"
                            value={editando.dataVencimento}
                            onChange={(e) => setEditando((a) => a && { ...a, dataVencimento: e.target.value })}
                            className="input"
                          />
                        </div>
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                          <label htmlFor={`edit-descricao-${c.id}`}>Descrição</label>
                          <input
                            id={`edit-descricao-${c.id}`}
                            type="text"
                            value={editando.descricao}
                            onChange={(e) => setEditando((a) => a && { ...a, descricao: e.target.value })}
                            className="input"
                          />
                        </div>
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                          <label htmlFor={`edit-obs-${c.id}`}>Observações</label>
                          <textarea
                            id={`edit-obs-${c.id}`}
                            rows={2}
                            value={editando.observacoes}
                            onChange={(e) => setEditando((a) => a && { ...a, observacoes: e.target.value })}
                            className="input"
                          />
                        </div>
                      </div>
                      <div className="form-actions" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="btn btn-brass"
                          onClick={() => {
                            const valor = numeroDeForm(editando.valor)
                            if (!editando.dataVencimento) {
                              alert('Informe a data de vencimento.')
                              return
                            }
                            if (valor <= 0) {
                              alert('Informe um valor maior que zero.')
                              return
                            }
                            atualizarCobranca(c, {
                              valor,
                              dataVencimento: editando.dataVencimento,
                              descricao: editando.descricao.trim(),
                              observacoes: editando.observacoes.trim()
                            })
                            cancelarFormulario()
                          }}
                        >
                          Salvar alterações
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={cancelarFormulario}
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  </React.Fragment>
                )
              })}
            </div>
          </>
        )}

        {destinatarios.length === 0 ? (
          <div className="empty">
            <p>Nenhum morador cadastrado.</p>
            <span>Cadastre moradores (ou crie contas de usuário) para gerar as cotas.</span>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 14,
                gap: 8,
                flexWrap: 'wrap'
              }}
            >
              <strong style={{ fontSize: 14 }}>
                Prévia do rateio — {rotuloMes(mesRef)}
                {jaGeradosCount > 0 && (
                  <span className="badge badge-gray" style={{ marginLeft: 8 }}>
                    {jaGeradosCount} já gerado(s)
                  </span>
                )}
              </strong>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => setPreviaAberta((aberto) => !aberto)}
                aria-expanded={previaAberta}
              >
                {previaAberta ? '▾ Recolher' : '▸ Expandir'}
              </button>
            </div>
            {previaAberta && (
              <>
                <div className="boletos-lista" style={{ marginTop: 8 }}>
                  {previa.map((p) => (
                    <div key={p.key} className="boleto-item">
                      <div className="boleto-info">
                        <div className="boleto-header">
                          <strong>{p.nome}{p.unidade ? ` — ${p.unidade}` : ''}</strong>
                          {!p.isento && p.quartos > 0 && (
                            <span className="badge badge-blue">{p.quartos} quarto{p.quartos > 1 ? 's' : ''}</span>
                          )}
                          {!p.isento && p.vagas > 0 && (
                            <span className="badge badge-gray">{p.vagas} vaga{p.vagas > 1 ? 's' : ''} de garagem</span>
                          )}
                          {p.isento && <span className="badge badge-gray">Isento</span>}
                          {p.jaGerado && <span className="badge badge-green">Cobrança já gerada</span>}
                        </div>
                        {p.email && (
                          <div className="boleto-dados">
                            <span>{p.email}</span>
                          </div>
                        )}
                        <div className="boleto-dados" style={{ fontSize: 12 }}>
                          <span>
                            {p.isento
                              ? `Isento — fora da soma das metragens (${formatarMetros(somaMetros)})`
                              : `${formatarValorBoleto(totalCotas)} × metragem ${formatarMetros(p.metragem)} `
                                + `(${p.tipo?.rotulo || 'tipo de apartamento'}) ÷ ${formatarMetros(somaMetros)} `
                                + `= ${formatarValorBoleto(p.valor)}`}
                          </span>
                        </div>
                      </div>
                      <div className="boleto-actions" style={{ alignItems: 'center' }}>
                        <strong>{p.isento ? '—' : formatarValorBoleto(p.valor)}</strong>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={p.isento}
                            onChange={(e) => setIsentos((atual) => ({ ...atual, [p.key]: e.target.checked }))}
                          />
                          Isento
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="hint" style={{ marginTop: 8, color: 'var(--ink-soft)', fontSize: 14 }}>
                  Soma das cotas da prévia: {formatarValorBoleto(somaRateada)}
                  {pendentes.length === 0 && jaGeradosCount > 0 && ' — todos os moradores já possuem cota para este mês.'}
                </p>
              </>
            )}
          </>
        )}
      </div>
      )}
    </div>
  )
}

