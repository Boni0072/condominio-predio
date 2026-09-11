// src/components/orcamento/orcamentoUtils.js
// Lógica compartida para el flujo de aprobación del orçado (presupuesto).
//
// Regra do condomínio:
//  • O MÊS fica "APROVADO" com ≥3 assinaturas de usuários distintos (banner no
//    Orcamento.jsx — validação global do período).
//  • O total "Orçado" do mês soma os sub-itens com ≥2 aprovações de usuários
//    distintos E menos de 2 rejeições ("✗ Não aprovar").
//  • Itens com <2 aprovações ou com ≥2 rejeições ficam de fora.

// Chave única por item previsto: orcamentoId + itemId
export function chavePrevisto(orcamentoId, itemId) {
  return `${orcamentoId || 'orc'}::${itemId || 'item'}`
}

// Id usado para registrar/agrupar las aprobaciones de un sub-item
export function previstoIdDe(previsto, indice) {
  return previsto?.id || `idx-${indice}`
}

// Filtra aprobaciones para un mes/año concreto
export function aprovacoesDoMes(aprovacoes, anoRef, mesRef) {
  return aprovacoes
    .filter((a) => Number(a.ano) === Number(anoRef) && Number(a.mes) === Number(mesRef))
    .sort((a, b) => new Date(a.criadoEm || 0) - new Date(b.criadoEm || 0))
}

function descNorm(desc) {
  return String(desc || '').trim().toLowerCase()
}

// Registros de voto de um sub-item:
//  1) chave exata (orcamentoId + itemId)
//  2) fallback: mesmo orçamento + mesma descrição (item recriado com id novo)
//  3) fallback: votos órfãos de orçamentos que não existem mais
//     (idsOrcamentosValidos = Set com os ids dos orçamentos do período)
export function registrosDoItem(aprovMes, orcamentoId, itemId, descricao, idsOrcamentosValidos) {
  const lista = aprovMes || []
  const chave = chavePrevisto(orcamentoId, itemId)
  const exatos = lista.filter((a) => chavePrevisto(a.orcamentoId, a.itemId) === chave)
  if (exatos.length > 0) return exatos
  const desc = descNorm(descricao)
  if (!desc) return []
  const mesmoOrc = lista.filter((a) => a.orcamentoId === orcamentoId && descNorm(a.itemDescricao) === desc)
  if (mesmoOrc.length > 0) return mesmoOrc
  if (!idsOrcamentosValidos) return []
  return lista.filter((a) => !idsOrcamentosValidos.has(a.orcamentoId) && descNorm(a.itemDescricao) === desc)
}

// Resumo { total, aprovados, rejeitados } dos votos de um sub-item (usado pela UI)
export function resumoVotosItem(aprovMes, orcamentoId, itemId, descricao, idsOrcamentosValidos) {
  const registros = registrosDoItem(aprovMes, orcamentoId, itemId, descricao, idsOrcamentosValidos)
  const aprovados = registros.filter((a) => a.aprovado !== false).length
  const rejeitados = registros.length - aprovados
  return { total: registros.length, aprovados, rejeitados }
}

// Alias de compatibilidade com a UI (ícones ✓/✗ por item)
export const iconesAprovadosDOIxa = resumoVotosItem

// O item conta no total quando tem ≥2 aprovações E menos de 2 rejeições
export function aceitacaoItem(aprovMes, orcamentoId, itemId, descricao, idsOrcamentosValidos) {
  const r = resumoVotosItem(aprovMes, orcamentoId, itemId, descricao, idsOrcamentosValidos)
  return { ...r, aceito: r.aprovados >= 2 && r.rejeitados < 2 }
}

// Total "Orçado" do mês: soma dos sub-itens com ≥2 aprovações e <2 rejeições.
// Votos órfãos (orçamento recriado com id novo) são recuperados por
// descrição + valor e atribuídos ao primeiro sub-item equivalente.
export function somaAprovacoesMes(orcamentosMes, aprovMes) {
  const orcamentos = orcamentosMes || []
  const votos = aprovMes || []
  const idsConhecidos = new Set(orcamentos.map((o) => o.id))
  const orfaos = votos.filter((a) => !idsConhecidos.has(a.orcamentoId))
  const orfaosConsumidos = new Set()

  const contarOrfaos = (descricao, valorItem) => {
    let aprovadosOrfaos = 0
    let rejeitadosOrfaos = 0
    const descPura = descNorm(descricao)
    if (!descPura) return { aprovados: 0, rejeitados: 0 }
    orfaos.forEach((o) => {
      if (orfaosConsumidos.has(o.id)) return
      if (descNorm(o.itemDescricao) !== descPura) return
      if (Number(o.itemValor) > 0 && Math.abs((Number(o.itemValor) || 0) - (Number(valorItem) || 0)) > 0.009) return
      orfaosConsumidos.add(o.id)
      if (o.aprovado === false) rejeitadosOrfaos += 1
      else aprovadosOrfaos += 1
    })
    return { aprovados: aprovadosOrfaos, rejeitados: rejeitadosOrfaos }
  }

  return orcamentos.reduce((total, item) => {
    if (Array.isArray(item.itens) && item.itens.length > 0) {
      // descrições duplicadas dentro do mesmo orçamento não usam o fallback
      const descritivos = item.itens.map((p) => descNorm(p?.descricao))
      const repetidas = new Set(descritivos.filter((d, i) => d && descritivos.indexOf(d) !== i))
      return total + item.itens.reduce((sub, previsto, indice) => {
        const itemId = previstoIdDe(previsto, indice)
        const valorItem = Number(previsto?.valor) || 0
        const descricao = repetidas.has(descNorm(previsto?.descricao)) ? '' : previsto?.descricao
        const r = resumoVotosItem(votos, item.id, itemId, descricao)
        const orf = contarOrfaos(previsto?.descricao, valorItem)
        const aprovados = r.aprovados + orf.aprovados
        const rejeitados = r.rejeitados + orf.rejeitados
        return (aprovados >= 2 && rejeitados < 2) ? sub + valorItem : sub
      }, 0)
    }
    const valorItem = Number(item.valor) || 0
    const r = aceitacaoItem(votos, item.id, 'item', '')
    const orf = contarOrfaos('', valorItem)
    const aprovados = r.aprovados + orf.aprovados
    const rejeitados = r.rejeitados + orf.rejeitados
    return (aprovados >= 2 && rejeitados < 2) ? total + valorItem : total
  }, 0)
}