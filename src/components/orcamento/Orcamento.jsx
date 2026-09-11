import React, { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import AssinaturaModal from './AssinaturaModal.jsx'
import { formatCurrency, formatDate, formatDateTime, getMonthKey } from '../../utils/storage.js'
import { chavePrevisto, previstoIdDe, aprovacoesDoMes, iconesAprovadosDOIxa, resumoVotosItem, registrosDoItem, somaAprovacoesMes } from './orcamentoUtils.js'

const CATEGORIAS = [
  { id: 'manutencao', label: 'Manutenção', icon: '🔧' },
  { id: 'limpeza', label: 'Limpeza', icon: '🧹' },
  { id: 'seguranca', label: 'Segurança', icon: '🛡️' },
  { id: 'agua', label: 'Água', icon: '💧' },
  { id: 'luz', label: 'Energia', icon: '⚡' },
  { id: 'gas', label: 'Gás', icon: '🔥' },
  { id: 'jardinagem', label: 'Jardinagem', icon: '🌿' },
  { id: 'piscina', label: 'Piscina', icon: '🏊' },
  { id: 'elevador', label: 'Elevador', icon: '🛗' },
  { id: 'outros', label: 'Outros', icon: '📦' }
]

const TIPOS_COMPROVANTE = [
  { id: 'nota', label: 'Nota fiscal' },
  { id: 'recibo', label: 'Recibo' },
  { id: 'cupom', label: 'Cupom fiscal' }
]

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

function dinheiro(valor) {
  return formatCurrency(Number(valor) || 0)
}

export function OrcamentoModal({ mes, ano, orcado, despesas, onFechar, orcamentosDoAno = [], aprovacoes = [] }) {
  const [despesaDetalhada, setDespesaDetalhada] = useState(null)
  const realizado = despesas.reduce((total, despesa) => total + (Number(despesa.valor) || 0), 0)
  const orcadoCategoria = despesaDetalhada
    ? (() => {
      const orcamentoCat = orcamentosDoAno.find((item) => Number(item.mes) === Number(mes) && item.categoria === despesaDetalhada.categoria)
      return orcamentoCat ? somaAprovacoesMes([orcamentoCat], aprovacoesDoMes(aprovacoes, ano, mes)) : null
    })()
    : null
  const diferenca = orcado - realizado
  const porCategoria = CATEGORIAS.map((categoria) => {
    const itens = despesas.filter((despesa) => despesa.categoria === categoria.id)
    return {
      ...categoria,
      total: itens.reduce((total, despesa) => total + (Number(despesa.valor) || 0), 0),
      itens
    }
  }).filter((categoria) => categoria.itens.length > 0)

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal orcamento-modal" role="dialog" aria-modal="true" aria-labelledby="orcamento-modal-titulo">
        <div className="modal-header">
          <div>
            <h2 id="orcamento-modal-titulo">Gastos de {MESES[mes - 1]} de {ano}</h2>
            <p className="sub">Detalhamento do realizado no período · clique em um gasto para ver os detalhes</p>
          </div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="modal-body">
          <div className="orcamento-modal-resumo">
            <div><span>Orçado</span><strong>{dinheiro(orcado)}</strong></div>
            <div><span>Realizado</span><strong>{dinheiro(realizado)}</strong></div>
            <div className={diferenca < 0 ? 'estourado' : ''}><span>{diferenca < 0 ? 'Estourado' : 'Saldo'}</span><strong>{dinheiro(Math.abs(diferenca))}</strong></div>
          </div>
          {despesas.length === 0 ? (
            <p className="empty">Nenhum gasto lançado neste mês.</p>
          ) : (
            <div className="orcamento-detalhes">
              {porCategoria.map((categoria) => (
                <section key={categoria.id} className="orcamento-detalhe-categoria">
                  <div className="orcamento-detalhe-cabecalho">
                    <strong>{categoria.label}</strong>
                    <span>{dinheiro(categoria.total)}</span>
                  </div>
                  {categoria.itens.map((despesa) => {
                    const orcadoCategoriaMes = orcamentosDoAno.find((item) => item.categoria === categoria.id && Number(item.mes) === Number(mes))
                    const orcadoItem = orcadoCategoriaMes ? somaAprovacoesMes([orcadoCategoriaMes], aprovacoesDoMes(aprovacoes, ano, mes)) : 0
                    const acima = orcadoItem > 0 && (Number(despesa.valor) || 0) > orcadoItem
                    return (
                      <button
                        type="button"
                        className="orcamento-gasto orcamento-gasto-botao"
                        key={despesa.id}
                        onClick={() => setDespesaDetalhada(despesa)}
                        aria-label={`Ver detalhes de ${despesa.descricao}`}
                        title="Ver detalhes da despesa"
                      >
                        <span>
                          {orcadoItem > 0 && (
                            <span
                              className={`despesa-seta-pill${acima ? ' acima' : ' abaixo'}`}
                              role="img"
                              aria-label={`${acima ? 'Acima' : 'Abaixo'} do orçamento de ${categoria.label} (${orcadoItem.toFixed(2).replace('.', ',')})`}
                              title={`${acima ? 'Acima' : 'Abaixo'} do orçamento de ${categoria.label}: ${dinheiro(orcadoItem)}`}
                            >
                              {acima ? '↗' : '↘'}
                            </span>
                          )}
                          {despesa.descricao}
                        </span>
                        <strong>{dinheiro(despesa.valor)}</strong>
                      </button>
                    )
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Fechar</button>
        </div>
      </div>

      {despesaDetalhada && <DespesaDetalheModal despesa={despesaDetalhada} orcadoCategoria={orcadoCategoria} onFechar={() => setDespesaDetalhada(null)} />}
    </div>
  )
}

function DespesaDetalheModal({ despesa, orcadoCategoria, onFechar }) {
  const categoria = CATEGORIAS.find((item) => item.id === despesa.categoria)
  const temOrcamento = Number(orcadoCategoria) > 0
  const acimaDoOrcamento = temOrcamento && (Number(despesa.valor) || 0) > Number(orcadoCategoria)
  const temComprovantes = Boolean(despesa.comprovanteAntes || despesa.comprovanteDepois || despesa.comprovante || despesa.comprovantePagamento)

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal despesa-detalhe-modal" role="dialog" aria-modal="true" aria-labelledby="despesa-detalhe-titulo">
        <div className="modal-header">
          <div>
            <h2 id="despesa-detalhe-titulo">{categoria?.icon} {despesa.descricao}</h2>
            <p className="sub">{categoria?.label || 'Outros'} · {despesa.tipo === 'material' ? 'Material' : 'Serviço'}</p>
          </div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="modal-body">
          <div className="despesa-detalhe-valor">
            <span>Valor</span>
            <strong>{dinheiro(despesa.valor)}</strong>
          </div>
          <div className={`despesa-detalhe-situacao${!temOrcamento ? ' sem' : acimaDoOrcamento ? ' acima' : ' dentro'}`}>
            <span className="despesa-detalhe-situacao-icone" aria-hidden="true">{!temOrcamento ? 'ℹ️' : acimaDoOrcamento ? '⚠️' : '✅'}</span>
            <div>
              <strong>{!temOrcamento ? 'Sem orçamento' : acimaDoOrcamento ? 'Acima do orçamento' : 'Abaixo do orçamento'}</strong>
              <span>{temOrcamento ? `Orçado para ${categoria?.label || 'a categoria'} neste mês: ${dinheiro(orcadoCategoria)}` : 'Nenhum valor orçado para esta categoria neste mês.'}</span>
            </div>
          </div>
          <div className="despesa-detalhe-grid">
            <div className="despesa-detalhe-campo">
              <span>Data</span>
              <strong>{despesa.data ? formatDate(despesa.data) : '—'}</strong>
            </div>
            <div className="despesa-detalhe-campo">
              <span>Fornecedor</span>
              <strong>{despesa.fornecedor || '—'}</strong>
            </div>
            <div className="despesa-detalhe-campo">
              <span>Categoria</span>
              <strong>{categoria ? `${categoria.icon} ${categoria.label}` : 'Outros'}</strong>
            </div>
            <div className="despesa-detalhe-campo">
              <span>Tipo</span>
              <strong>{despesa.tipo === 'material' ? 'Material' : 'Serviço'}</strong>
            </div>
            {despesa.criadoEm && (
              <div className="despesa-detalhe-campo despesa-detalhe-largo">
                <span>Registrado em</span>
                <strong>{formatDateTime(despesa.criadoEm)}</strong>
              </div>
            )}
          </div>
          {despesa.observacoes && (
            <div className="despesa-detalhe-obs">
              <span>Observações</span>
              <p>{despesa.observacoes}</p>
            </div>
          )}
          {temComprovantes && (
            <div className="despesa-detalhe-comprovantes">
              <span>Comprovantes</span>
              <div className="despesa-comprovante">
                {(despesa.comprovanteAntes || despesa.comprovante) && (
                  <a href={despesa.comprovanteAntes || despesa.comprovante} target="_blank" rel="noreferrer">
                    <img src={despesa.comprovanteAntes || despesa.comprovante} alt="Comprovante antes" className="comprovante-thumb-small" />
                    <small>{despesa.categoria === 'manutencao' ? 'Antes' : (TIPOS_COMPROVANTE.find((tipo) => tipo.id === despesa.comprovanteTipo)?.label || 'Comprovante')}</small>
                  </a>
                )}
                {despesa.comprovanteDepois && (
                  <a href={despesa.comprovanteDepois} target="_blank" rel="noreferrer">
                    <img src={despesa.comprovanteDepois} alt="Comprovante depois" className="comprovante-thumb-small" />
                    <small>Depois</small>
                  </a>
                )}
                {despesa.comprovantePagamento && (
                  <a href={despesa.comprovantePagamento} target="_blank" rel="noreferrer">
                    <img src={despesa.comprovantePagamento} alt="Comprovante de pagamento" className="comprovante-thumb-small" />
                    <small>{TIPOS_COMPROVANTE.find((tipo) => tipo.id === despesa.comprovantePagamentoTipo)?.label || 'Pagamento'}</small>
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  )
}

export default function Orcamento() {
  const { userProfile } = useAuth()
  const {
    despesas, orcamentos, salvarOrcamento, removerOrcamento,
    aprovacoes, erroAprovacao, aprovarOrcamento, removerAprovacaoOrcamento, alternarConviteAprovacao,
    podeAprovarOrcamento, podeConvidarAprovadores, usuarios
  } = useApp()
  const anoAtual = new Date().getFullYear()
  const mesAtual = new Date().getMonth() + 1
  const [periodo, setPeriodo] = useState(`${anoAtual}-${String(mesAtual).padStart(2, '0')}`)
  const [form, setForm] = useState({ mes: mesAtual, categoria: 'manutencao' })
  const [mesDetalhado, setMesDetalhado] = useState(null)
  const [formAberto, setFormAberto] = useState(false)
  const [itens, setItens] = useState([])
  const [itemTexto, setItemTexto] = useState('')
  const [itemValor, setItemValor] = useState('')
  const [erro, setErro] = useState('')
  const [categoriasAbertas, setCategoriasAbertas] = useState({})
  const [editandoId, setEditandoId] = useState(null)
  const [votos, setVotos] = useState({})
  const [firmaAberta, setFirmaAberta] = useState(false)

  const ano = Number(periodo.split('-')[0]) || anoAtual
  const mesFiltro = Number(periodo.split('-')[1]) || mesAtual
                            const orcamentosDoAno = orcamentos.filter((item) => Number(item.ano) === Number(ano))
  const orcamentosDoPeriodo = orcamentosDoAno.filter((item) => Number(item.mes) === mesFiltro)
  const meses = useMemo(() => MESES.map((nome, indice) => {
    const mes = indice + 1
    const chave = `${ano}-${String(mes).padStart(2, '0')}`
    const itensOrcados = orcamentosDoAno.filter((item) => Number(item.mes) === mes)
    const gastos = despesas.filter((despesa) => getMonthKey(despesa.data || despesa.criadoEm) === chave)
    return {
      mes,
      nome,
      orcado: somaAprovacoesMes(itensOrcados, aprovacoesDoMes(aprovacoes, ano, mes)),
      realizado: gastos.reduce((total, item) => total + (Number(item.valor) || 0), 0),
      gastos
    }
  }), [ano, orcamentosDoAno, despesas, aprovacoes])
  const maiorValor = Math.max(1, ...meses.flatMap((item) => [item.orcado, item.realizado]))
  const mesSelecionado = meses.find((item) => item.mes === mesDetalhado)
  const podeEditar = ['sindico', 'zelador'].includes(userProfile?.role)
  const podeAprovar = podeAprovarOrcamento()
  const podeConvidar = podeConvidarAprovadores()
  const ROLE_APROVADOR = { sindico: 'Síndico', zelador: 'Zelador', portaria: 'Portaria / Porteiro', conselheiro: 'Conselheiro', morador: 'Morador' }
  const aprovacoesDoPeriodo = aprovacoes
    .filter((a) => Number(a.ano) === Number(ano) && Number(a.mes) === mesFiltro)
    .sort((a, b) => new Date(a.criadoEm || 0) - new Date(b.criadoEm || 0))
      const moradoresConvidados = usuarios.filter((u) => u.role === 'morador')
  const idsOrcamentosValidos = new Set(orcamentosDoPeriodo.map((o) => o.id))

  // Regra do orçado (ver orcamentoUtils.js): o total do mês soma os sub-itens
  // que NÃO têm nenhum voto de rejeição; as 3+ assinaturas validam o mês.

  function esMio(a) {
    return (a.usuarioId && a.usuarioId === userProfile?.uid) || (a.usuarioEmail && a.usuarioEmail === userProfile?.email)
  }

  // Agrupa as aprovações em "firmas": uma assinatura pode decidir vários
  // itens de uma vez, então agrupamos os registros que compartilham o
  // mesmo usuário, data/hora e assinatura.
  const firmasDoPeriodo = useMemo(() => {
    const grupos = new Map()
    aprovacoesDoPeriodo.forEach((a) => {
      const chaveUsuario = a.usuarioId || a.usuarioEmail || a.usuarioNome || 'anonimo'
             const chave = `${chaveUsuario}||${a.criadoEm || ''}||${(a.assinatura || '').slice(0, 64)}`
      if (!grupos.has(chave)) {
        grupos.set(chave, {
          chave,
          usuarioNome: a.usuarioNome,
          usuarioRole: a.usuarioRole,
          usuarioId: a.usuarioId,
          usuarioEmail: a.usuarioEmail,
          criadoEm: a.criadoEm,
          assinatura: a.assinatura,
          itens: []
        })
      }
      grupos.get(chave).itens.push(a)
    })
    return [...grupos.values()].sort((x, y) => new Date(x.criadoEm || 0) - new Date(y.criadoEm || 0))
  }, [aprovacoesDoPeriodo])

  // Regra do condomínio: o orçamento do mês só é considerado APROVADO com
  // pelo menos 3 assinaturas (usuários distintos).
  const aprovadoresDistintos = new Set(
    firmasDoPeriodo.map((f) => f.usuarioId || f.usuarioEmail || f.usuarioNome || f.chave)
  )
  const totalAprovadores = aprovadoresDistintos.size
  const podeFirmar = totalAprovadores < 3
  const orcamentoAprovado = totalAprovadores >= 3

  function desfazerFirma(firma) {
    firma.itens.forEach((r) => removerAprovacaoOrcamento(r.orcamentoId, r.itemId, r.ano, r.mes))
  }

  function aprovacoesDoPrevisto(orcamentoId, itemId, descricao) {
    return registrosDoItem(aprovacoesDoPeriodo, orcamentoId, itemId, descricao, idsOrcamentosValidos)
  }

  function resumoPrevisto(orcamentoId, itemId, descricao) {
    return resumoVotosItem(aprovacoesDoPeriodo, orcamentoId, itemId, descricao, idsOrcamentosValidos)
  }

  // Votos já guardados por este utilizador no período (por item previsto)
  const votosExistentes = {}
  aprovacoesDoPeriodo.filter(esMio).forEach((a) => {
    if (a.orcamentoId) votosExistentes[chavePrevisto(a.orcamentoId, a.itemId)] = a.aprovado !== false ? 'aprobar' : 'rechazar'
  })

  function votoDePrevisto(orcamentoId, itemId, descricao) {
    const chave = chavePrevisto(orcamentoId, itemId)
    if (votos[chave]) return votos[chave]
    if (votosExistentes[chave]) return votosExistentes[chave]
    // Fallback: voto meu gravado sob chave antiga (item recriado), casando pela descrição
    const desc = String(descricao || '').trim().toLowerCase()
    if (!desc) return undefined
    const meus = registrosDoItem(aprovacoesDoPeriodo, orcamentoId, itemId, descricao, idsOrcamentosValidos).filter(esMio)
    const meu = meus[meus.length - 1]
    return meu ? (meu.aprovado !== false ? 'aprobar' : 'rechazar') : undefined
  }

  function selecionarPrevisto(orcamentoId, itemId, valor) {
    const chave = chavePrevisto(orcamentoId, itemId)
    setVotos((atuais) => {
      const novo = { ...atuais }
      if (!valor) delete novo[chave]
      else novo[chave] = valor
      return novo
    })
  }

  // Controlo de aprovação por ITEM PREVISTO (ex.: 1 - reforma do portão, 2 - reforma do telhado)
  // Layout em 3 colunas: descrição | valor | decisão (o registo de votos ocupa a linha de baixo)
  function renderDecisaoPrevisto(item, previsto, indice) {
    const itemId = previstoIdDe(previsto, indice)
    const voto = votoDePrevisto(item.id, itemId, previsto.descricao)
    const resumo = resumoPrevisto(item.id, itemId, previsto.descricao)
    const selectId = `aprov-${item.id}-${itemId}`
    return (
      <>
        <div className="orcamento-aprovacion-opciones">
          <label className="orcamento-aprovacion-select-label" htmlFor={selectId}>Decisão</label>
          <select
            id={selectId}
            className={`orcamento-aprovacion-select${voto === 'aprobar' ? ' aprobar' : voto === 'rechazar' ? ' rechazar' : ''}`}
            value={voto || ''}
            onChange={(e) => selecionarPrevisto(item.id, itemId, e.target.value)}
            aria-label={`Aprovação do item ${indice + 1} - ${previsto.descricao}`}
          >
            <option value="">Selecionar…</option>
            <option value="aprobar">✓ Aprovar</option>
            <option value="rechazar">✗ Não aprovar</option>
          </select>
        </div>
        {resumo.total > 0 && (
          <div className="orcamento-aprovacion-registros">
            {aprovacoesDoPrevisto(item.id, itemId, previsto.descricao).map((a) => (
              <span key={a.id}>
                {a.aprovado ? '✓' : '✗'} {a.usuarioNome} · {a.aprovado ? 'aprovado' : 'não aprovado'} {a.criadoEm ? new Date(a.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            ))}
          </div>
        )}
      </>
    )
  }

  function itensDoOrcamento(anoRef, mesRef, categoriaRef) {
    const existente = orcamentos.find((item) => Number(item.ano) === Number(anoRef) && Number(item.mes) === Number(mesRef) && item.categoria === categoriaRef)
    return Array.isArray(existente?.itens) ? existente.itens : []
  }

  function adicionarItem() {
    const descricao = itemTexto.trim()
    if (!descricao) return
    const valor = Number(itemValor) > 0 ? Number(itemValor) : 0
    setItens((atual) => [...atual, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, descricao, valor }])
    setItemTexto('')
    setItemValor('')
    setErro('')
  }

  function removerItem(id) {
    setItens((atual) => atual.filter((item) => item.id !== id))
  }

  function alternarCategoria(id) {
    setCategoriasAbertas((atual) => ({ ...atual, [id]: !atual[id] }))
  }

  function iniciarEdicao(item) {
    setEditandoId(item.id)
    setForm({ mes: Number(item.mes), categoria: item.categoria })
    setItemTexto('')
    setItemValor('')
    setErro('')
    setItens(Array.isArray(item.itens) ? item.itens : [])
    setFormAberto(true)
  }

  function cancelarEdicao() {
    setEditandoId(null)
  }

  function handleSubmit(e) {
    e.preventDefault()
    const total = itens.reduce((acc, item) => acc + (Number(item.valor) || 0), 0)
    if (itens.length === 0) return setErro('Adicione pelo menos um item ao orçamento.')
    if (total <= 0) return setErro('Informe o valor estimado de pelo menos um item.')
    salvarOrcamento({ ano: Number(ano), mes: Number(form.mes), categoria: form.categoria, valor: total, itens })
    setEditandoId(null)
    setItens([])
    setItemTexto('')
    setItemValor('')
    setErro('')
  }

  if (!['sindico', 'zelador', 'conselheiro'].includes(userProfile?.role) && !podeAprovarOrcamento()) {
    return <div className="page"><div className="login-erro">Você não tem permissão para acessar o orçamento anual.</div></div>
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Orçamento anual</h2>
          <p className="sub">Planeje por categoria e acompanhe o que foi realizado mês a mês.</p>
        </div>
        <label className="orcamento-ano">
          <span>Mês/Ano</span>
          <input
            type="month"
            value={periodo}
            onChange={(e) => {
              if (!e.target.value) return
              setPeriodo(e.target.value)
              const [novoAno, novoMes] = e.target.value.split('-').map(Number)
              setForm((atual) => ({ ...atual, mes: novoMes || atual.mes }))
              setItens(itensDoOrcamento(novoAno, novoMes || form.mes, form.categoria))
              setEditandoId(null)
            }}
          />
        </label>
      </div>

      <div className="orcamento-layout">
        {podeEditar && (
          <div className="card orcamento-form">
          <div className="panel-header">
            <h3>Definir orçamento</h3>
            <button
              type="button"
              className="btn btn-ghost btn-small"
              onClick={() => {
                const abrindo = !formAberto
                setFormAberto(abrindo)
                if (abrindo) {
                  setItemTexto('')
                  setErro('')
                  setItens(itensDoOrcamento(ano, form.mes, form.categoria))
                }
              }}
              aria-expanded={formAberto}
            >
              {formAberto ? 'Recolher' : 'Expandir'}
            </button>
          </div>
          {formAberto && (
            <form onSubmit={handleSubmit}>
              <p className="field-help">O orçamento é a soma do valor estimado dos itens. O mesmo mês e categoria atualizam o valor já cadastrado.</p>
              {erro && <p className="form-erro">{erro}</p>}
              {editandoId && (
                <p className="orcamento-editando">
                  <span>Editando {MESES[form.mes - 1]} · {CATEGORIAS.find((c) => c.id === form.categoria)?.label || form.categoria}</span>
                  <button type="button" className="btn btn-small btn-ghost" onClick={cancelarEdicao}>Cancelar edição</button>
                </p>
              )}
              <div className="field">
                <label htmlFor="orcamento-mes">Mês</label>
                <select id="orcamento-mes" value={form.mes} onChange={(e) => {
                  const novoMes = Number(e.target.value)
                  setForm({ ...form, mes: novoMes })
                  setItens(itensDoOrcamento(ano, novoMes, form.categoria))
                  setEditandoId(null)
                }}>
                  {MESES.map((mes, indice) => <option key={mes} value={indice + 1}>{mes}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="orcamento-categoria">Categoria</label>
                <select id="orcamento-categoria" value={form.categoria} onChange={(e) => {
                  const novaCategoria = e.target.value
                  setForm({ ...form, categoria: novaCategoria })
                  setItens(itensDoOrcamento(ano, form.mes, novaCategoria))
                  setEditandoId(null)
                }}>
                  {CATEGORIAS.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="orcamento-item">Itens previstos</label>
                <div className="orcamento-item-input">
                  <input
                    id="orcamento-item"
                    type="text"
                    value={itemTexto}
                    onChange={(e) => setItemTexto(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        adicionarItem()
                      }
                    }}
                    placeholder="Ex.: Reforma do portão"
                  />
                  <input
                    className="orcamento-item-valor"
                    type="number"
                    min="0"
                    step="0.01"
                    value={itemValor}
                    onChange={(e) => setItemValor(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        adicionarItem()
                      }
                    }}
                    placeholder="0,00"
                    aria-label="Valor estimado do item"
                  />
                  <button type="button" className="btn btn-ghost btn-small" onClick={adicionarItem} disabled={!itemTexto.trim()}>Adicionar</button>
                </div>
                {itens.length > 0 ? (
                  <>
                    <ul className="orcamento-itens-previstos">
                      {itens.map((item, indice) => (
                        <li key={item.id}>
                          <span>{indice + 1} - {item.descricao}</span>
                          <strong>{dinheiro(item.valor)}</strong>
                          <button type="button" className="orcamento-item-remover" onClick={() => removerItem(item.id)} aria-label={`Remover item ${indice + 1}`}>×</button>
                        </li>
                      ))}
                    </ul>
                    <p className="orcamento-itens-total">Total estimado dos itens: <strong>{dinheiro(itens.reduce((total, item) => total + (Number(item.valor) || 0), 0))}</strong></p>
                  </>
                ) : (
                  <p className="field-help">Ex.: 1 - reforma do portão (R$ 1.500,00) · 2 - reforma do telhado (R$ 800,00)</p>
                )}
              </div>
              <button type="submit" className="btn btn-brass btn-block">Salvar orçamento</button>
            </form>
          )}
        </div>
        )}

        {(!podeEditar || formAberto) && (
          <div className="card orcamento-lista-configurada">
            <div className="panel-header">
              <div><h3>Valores configurados</h3><p className="field-help">{orcamentosDoPeriodo.length} item(ns) em {MESES[mesFiltro - 1]} de {ano}</p></div>
            </div>
            {orcamentosDoPeriodo.length === 0 ? <p className="empty-state">Nenhum orçamento definido para este mês.</p> : (
              <div className="orcamento-categorias">
                {CATEGORIAS.map((categoria) => {
                  const registros = orcamentosDoPeriodo.filter((item) => item.categoria === categoria.id).sort((a, b) => a.mes - b.mes)
                  if (registros.length === 0) return null
                  const aberto = !!categoriasAbertas[categoria.id]
                  return (
                    <section key={categoria.id} className="orcamento-categoria-grupo">
                      <button type="button" className="orcamento-categoria-cabecalho" onClick={() => alternarCategoria(categoria.id)} aria-expanded={aberto}>
                        <span className="orcamento-categoria-seta" aria-hidden="true">{aberto ? '▾' : '▸'}</span>
                        <span className="orcamento-categoria-nome">{categoria.label}</span>
                        <small>{registros.length} item(ns)</small>
                        <strong className="orcamento-categoria-total">{dinheiro(somaAprovacoesMes(registros, aprovacoesDoMes(aprovacoes, ano, mesFiltro)))}</strong>
                      </button>
                      {aberto && (
                        <div className="orcamento-itens">
                          {registros.map((item) => (
                            <div className={`orcamento-item${editandoId === item.id ? ' orcamento-item-editando' : ''}`} key={item.id}>
                              <div><strong>{MESES[item.mes - 1]}</strong></div>
                              <strong>{dinheiro(item.valor)}</strong>
                              {podeEditar && (
                                <div className="orcamento-item-acoes">
                                  <button type="button" className="btn btn-small btn-ghost" onClick={() => iniciarEdicao(item)}>Editar</button>
                                  <button type="button" className="btn btn-small btn-danger" onClick={() => {
                                    if (editandoId === item.id) setEditandoId(null)
                                    removerOrcamento(item.id)
                                  }}>Remover</button>
                                </div>
                              )}
                              {Array.isArray(item.itens) && item.itens.length > 0 && (
                                <>
                                  <div className="orcamento-item-lista-cabecalho" aria-hidden="true">
                                    <span>Item</span>
                                    <span className="orcamento-item-lista-valor-titulo">Valor</span>
                                    <span>Decisão</span>
                                  </div>
                                  <ul className="orcamento-item-lista orcamento-item-lista-aprovacao">
                                  {item.itens.map((previsto, indice) => (
                                    <li key={previsto.id || indice}>
                                      <span>{indice + 1} - {previsto.descricao}</span>
                                      {Number(previsto.valor) > 0 ? <strong>{dinheiro(previsto.valor)}</strong> : <strong>—</strong>}
                                      {podeAprovar ? renderDecisaoPrevisto(item, previsto, indice) : (() => {
                                        const r = iconesAprovadosDOIxa(aprovacoesDoPeriodo, item.id, previstoIdDe(previsto, indice), previsto.descricao, idsOrcamentosValidos)
                                        return r.total > 0 && (
                                          <span className="orcamento-item-aprovacion-icones" title={`${r.aprovados} aprovado(s)${r.rejeitados > 0 ? `, ${r.rejeitados} rejeitado(s)` : ''}`}>
                                            ✓{r.aprovados}{r.rejeitados > 0 ? ` ✗${r.rejeitados}` : ''}
                                          </span>
                                        )
                                      })()}
                                    </li>
                                  ))}
                                </ul>
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {podeAprovar && (
        <section className="card orcamento-firmar">
          <div className="panel-header">
            <div>
              <h3>Firmar aprovação</h3>
              <p className="field-help">
                Escolha Aprovar ou Não aprovar em cada item acima e depois firme uma única vez para registrar sua decisão.
              </p>
            </div>
          </div>
          <div className="orcamento-firmar-resumen">
            {Object.keys(votos).length === 0 ? (
              <span>Nenhum item decidido ainda. Selecione Aprovar ou Não aprovar em pelo menos um item.</span>
            ) : (
              <span>{Object.keys(votos).length} item(ns) decidido(s): {Object.values(votos).filter((v) => v === 'aprobar').length} aprovado(s) · {Object.values(votos).filter((v) => v === 'rechazar').length} não aprovado(s)</span>
            )}
          </div>
          <div className="orcamento-firmar-acciones">
            <button
              type="button"
              className="btn btn-brass"
              disabled={Object.keys(votos).length === 0}
              onClick={() => setFirmaAberta(true)}
            >
              ✍ Firmar e guardar aprovação
            </button>
          </div>
        </section>
      )}

      {podeAprovar && (
        <section className="card orcamento-aprovacao">
          <div className="panel-header">
            <div>
              <h3>Aprovações registradas</h3>
              <p className="field-help">
                {MESES[mesFiltro - 1]} de {ano} · {firmasDoPeriodo.length} assinatura(s) registrada(s) · {totalAprovadores} de 3 aprovador(es) necessário(s)
                {orcamentoAprovado ? ' · ✓ Orçamento APROVADO' : ' · Aguardando aprovações'}
              </p>
            </div>
          </div>
          {erroAprovacao && <div className="login-erro">{erroAprovacao}</div>}
          {orcamentoAprovado ? (
            <p className="orcamento-aprovado-banner" role="status">
              ✓ Orçamento de {MESES[mesFiltro - 1]} de {ano} APROVADO com {totalAprovadores} assinaturas.
            </p>
          ) : (
            <p className="field-help">Faltam {Math.max(0, 3 - totalAprovadores)} assinatura(s) de usuários distintos para aprovar o orçamento deste mês.</p>
          )}
          {firmasDoPeriodo.length === 0 ? (
            <p className="empty-state">Nenhuma aprovação registrada para este mês.</p>
          ) : (
            <div className="orcamento-aprovacao-lista">
              {firmasDoPeriodo.map((firma) => {
                const totalAprov = firma.itens.filter((r) => r.aprovado !== false).length
                const totalRej = firma.itens.length - totalAprov
                return (
                  <div key={firma.chave} className="orcamento-aprovacao-item">
                    <span>
                      ✍ <strong>{firma.usuarioNome}</strong> · {ROLE_APROVADOR[firma.usuarioRole] || firma.usuarioRole || 'Usuário'}
                      <small> · {firma.itens.length} item(ns): {totalAprov} aprovado(s){totalRej > 0 ? ` · ${totalRej} não aprovado(s)` : ''}</small>
                    </span>
                    <small>
                      assinou em {firma.criadoEm ? new Date(firma.criadoEm).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                    </small>
                    <ul className="orcamento-aprovacao-itens-firma">
                      {firma.itens.map((r) => (
                        <li key={r.id}>
                          {r.aprovado !== false ? '✓' : '✗'} {r.itemDescricao || 'Item'}{Number(r.itemValor) > 0 ? ` (${dinheiro(r.itemValor)})` : ''}
                        </li>
                      ))}
                    </ul>
                    {firma.assinatura && <img src={firma.assinatura} alt="Assinatura" className="orcamento-assinatura-thumb" />}
                    {firma.usuarioId && firma.usuarioId === userProfile?.uid && (
                      <button type="button" className="btn btn-small btn-warning" onClick={() => desfazerFirma(firma)}>Desfazer</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {podeConvidar && moradoresConvidados.length > 0 && (
        <section className="card orcamento-convites">
          <div className="panel-header">
            <div>
              <h3>Convidar moradores para aprovar</h3>
              <p className="field-help">Moradores convidados passam a acessar o orçamento anual e podem aprovar o mês.</p>
            </div>
          </div>
          <div className="orcamento-convites-lista">
            {moradoresConvidados.map((u) => (
              <div key={u.id} className="orcamento-convite-item">
                <div><strong>{u.nome || (u.email || '').split('@')[0]}</strong>{u.unidade && <span> · {u.unidade}</span>}</div>
                <button
                  type="button"
                  className={`btn btn-small ${u.convidadoParaAprovar ? 'btn-ghost' : 'btn-brass'}`}
                  onClick={() => alternarConviteAprovacao(u)}
                >
                  {u.convidadoParaAprovar ? 'Remover convite' : 'Convidar para aprovar'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card orcamento-grafico-card">
        <div className="panel-header">
          <div><h3>Orçado x realizado</h3><p className="field-help">Clique em um mês para ver os gastos detalhados.</p></div>
          <div className="orcamento-legenda"><span><i className="legenda-orcado" /> Orçado</span><span><i className="legenda-realizado" /> Realizado</span></div>
        </div>
        <div className="orcamento-grafico">
          {meses.map((item) => (
            <button type="button" className="orcamento-mes" key={item.mes} onClick={() => setMesDetalhado(item.mes)} aria-label={`Ver detalhes de ${item.nome}`}>
              <div className="orcamento-barras">
                <span
                  className="barra barra-orcado"
                  data-rotulo={item.orcado > 0 ? dinheiro(item.orcado) : ''}
                  style={{ height: `${item.orcado ? Math.max(5, (item.orcado / maiorValor) * 100) : 0}%` }}
                  title={`Orçado: ${dinheiro(item.orcado)}`}
                />
                <span
                  className={`barra barra-realizado${item.realizado > item.orcado && item.realizado > 0 ? ' barra-estourada' : ''}`}
                  data-rotulo={item.realizado > 0 ? dinheiro(item.realizado) : ''}
                  style={{ height: `${item.realizado ? Math.max(5, (item.realizado / maiorValor) * 100) : 0}%` }}
                  title={`Realizado: ${dinheiro(item.realizado)}`}
                />
              </div>
              <strong>{item.nome.slice(0, 3)}</strong>
              <small>{dinheiro(item.realizado)}</small>
            </button>
          ))}
        </div>
      </section>

      {mesSelecionado && <OrcamentoModal mes={mesSelecionado.mes} ano={ano} orcado={mesSelecionado.orcado} despesas={mesSelecionado.gastos} orcamentosDoAno={orcamentosDoAno} aprovacoes={aprovacoes} onFechar={() => setMesDetalhado(null)} />}

      {firmaAberta && (
        <AssinaturaModal
          titulo="Firmar aprovação do orçamento"
          subtitulo={`${MESES[mesFiltro - 1]} de ${ano} · ${userProfile?.nome || userProfile?.email || ''}`}
          onConfirmar={(assinatura) => {
            const decididos = []
            orcamentosDoPeriodo.forEach((item) => {
              ;(Array.isArray(item.itens) ? item.itens : []).forEach((previsto, indice) => {
                const itemId = previstoIdDe(previsto, indice)
                const voto = votoDePrevisto(item.id, itemId)
                if (voto) decididos.push({ orcamentoId: item.id, itemId, descricao: previsto.descricao, valor: previsto.valor, aprovado: voto === 'aprobar' })
              })
            })
            aprovarOrcamento(decididos, ano, mesFiltro, assinatura)
            setVotos({})
            setFirmaAberta(false)
          }}
          onCancelar={() => setFirmaAberta(false)}
        />
      )}
    </div>
  )
}