import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatDateTime, formatDate, formatCurrency, getMonthKey } from '../../utils/storage.js'
import { AvisoEncomendaWhatsApp, moradorDaUnidade } from '../shared/AvisoEncomendaWhatsApp.jsx'
import { OrcamentoModal } from '../orcamento/Orcamento.jsx'

const HOJE = new Date()
  .toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })
  .replace(/^./, (letra) => letra.toUpperCase())

const CATEGORIAS_MURAL = {
  geral: 'Aviso geral',
  manutencao: 'Manutenção',
  urgente: 'Urgente',
  evento: 'Evento'
}

const CATEGORIAS_DESPESA = {
  manutencao: '🔧 Manutenção',
  limpeza: '🧹 Limpeza',
  seguranca: '🛡️ Segurança',
  agua: '💧 Agua',
  energia: '⚡ Energia',
  gas: '🔥 Gás',
  jardinagem: '🌿 Jardinagem',
  piscina: '🏊 Piscina',
  elevador: '🛗 Elevador',
  outros: '📦 Outros'
}

const MESES_ORCAMENTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function KpiCard({ to, num, label, tom }) {
  return (
    <Link to={to} className={'kpi-card' + (tom ? ` ${tom}` : '')}>
      <div className="kpi-num">{num}</div>
      <div className="kpi-label">{label}</div>
    </Link>
  )
}

function noMes(value, periodoMes) {
  return !periodoMes || getMonthKey(value) === periodoMes
}

function NoCondominioList({ periodoMes }) {
  const { visitantes, registrarSaida } = useApp()
  const dentro = visitantes.filter((v) => !v.saida && noMes(v.entrada, periodoMes))

  if (dentro.length === 0) {
    return <div className="empty-state">Nenhum visitante no condomínio agora.</div>
  }

  return (
    <div>
      {dentro.slice(0, 5).map((v) => (
        <div className="log-item" key={v.id}>
          <div className="log-main">
            <div className="log-name">{v.nome}</div>
            <div className="log-meta">
              <span>{v.unidade}</span>
              {v.autorizadoPor && <span>· autorizado por {v.autorizadoPor}</span>}
              <span>· entrada {formatDateTime(v.entrada)}</span>
            </div>
          </div>
          <div className="log-actions">
            <button className="btn btn-ghost btn-small" onClick={() => registrarSaida(v.id)}>
              Registrar saída
            </button>
          </div>
        </div>
      ))}
      {dentro.length > 5 && (
        <div className="list-mais">
          <Link to="/portaria/visitantes">Ver todos os {dentro.length} visitantes…</Link>
        </div>
      )}
    </div>
  )
}

function EncomendasAguardandoList({ periodoMes }) {
  const { encomendas, moradores } = useApp()
  const [encomendaDetalhada, setEncomendaDetalhada] = useState(null)
  const pendentes = encomendas
    .filter((e) => !e.retiradaEm && noMes(e.chegadaEm, periodoMes))
    .sort((a, b) => new Date(a.chegadaEm) - new Date(b.chegadaEm))

  if (pendentes.length === 0) {
    return <div className="empty-state">Nenhuma encomenda aguardando retirada.</div>
  }

  return (
    <div>
      {pendentes.slice(0, 5).map((e) => {
        const morador = moradorDaUnidade(moradores, e.unidade)
        const titulo = e.destinatario || (morador && morador.nome) || e.unidade
        return (
          <div className="log-item" key={e.id}>
            <div className="log-main">
              <div className="log-name">{titulo}</div>
              <div className="log-meta">
                <span>{e.unidade}</span>
                {e.transportadora && <span>· {e.transportadora}</span>}
                <span>· chegou {formatDateTime(e.chegadaEm)}</span>
              </div>
            </div>
            <div className="log-actions">
              <AvisoEncomendaWhatsApp encomenda={e} />
              <button className="btn btn-ghost btn-small" type="button" onClick={() => setEncomendaDetalhada(e)}>
                Abrir
              </button>
            </div>
          </div>
        )
      })}
      {pendentes.length > 5 && (
        <div className="list-mais">
          <Link to="/portaria/encomendas">Ver todas as {pendentes.length} encomendas…</Link>
        </div>
      )}
      {encomendaDetalhada && (
        <div className="modal-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEncomendaDetalhada(null)}>
          <div className="modal encomenda-detalhes-modal" role="dialog" aria-modal="true" aria-labelledby="encomenda-detalhes-titulo">
            <div className="modal-header">
              <div>
                <h2 id="encomenda-detalhes-titulo">Detalhes da encomenda</h2>
                <p className="sub">Informações do recebimento</p>
              </div>
              <button type="button" className="modal-fechar" onClick={() => setEncomendaDetalhada(null)} aria-label="Fechar">×</button>
            </div>
            <div className="modal-body encomenda-detalhes-conteudo">
              <div className="encomenda-detalhes-grid">
                <div><span>Destinatário</span><strong>{encomendaDetalhada.destinatario || 'Não informado'}</strong></div>
                <div><span>Unidade</span><strong>{encomendaDetalhada.unidade}</strong></div>
                <div><span>Transportadora / origem</span><strong>{encomendaDetalhada.transportadora || 'Não informado'}</strong></div>
                <div><span>Chegada</span><strong>{formatDateTime(encomendaDetalhada.chegadaEm)}</strong></div>
                <div><span>Status</span><strong>Aguardando retirada</strong></div>
              </div>
              {encomendaDetalhada.foto && (
                <div className="encomenda-detalhes-foto">
                  <span>Foto da encomenda</span>
                  <a href={encomendaDetalhada.foto} target="_blank" rel="noreferrer">
                    <img src={encomendaDetalhada.foto} alt="Foto da encomenda" />
                  </a>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEncomendaDetalhada(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function AtividadeRecente({ periodoMes }) {
  const { visitantes, encomendas, comunicados } = useApp()
  const eventos = []

  visitantes.forEach((v) => {
    eventos.push({
      quando: v.entrada,
      tipo: 'Visitante',
      tom: 'badge-blue',
      texto: `${v.nome} entrou no condomínio (${v.unidade})`
    })
    if (v.saida) {
      eventos.push({
        quando: v.saida,
        tipo: 'Visitante',
        tom: 'badge-blue',
        texto: `${v.nome} saiu do condomínio`
      })
    }
  })

  encomendas.forEach((e) => {
    eventos.push({
      quando: e.chegadaEm,
      tipo: 'Encomenda',
      tom: 'badge-brick',
      texto: `Encomenda chegou para ${e.unidade}${e.transportadora ? ` (${e.transportadora})` : ''}`
    })
    if (e.retiradaEm) {
      eventos.push({
        quando: e.retiradaEm,
        tipo: 'Retirada',
        tom: 'badge-green',
        texto: `Encomenda retirada em ${e.unidade}${e.assinatura ? ' — com assinatura' : ''}`
      })
    }
  })

  comunicados.forEach((c) => {
    eventos.push({
      quando: c.criadoEm,
      tipo: 'Mural',
      tom: 'badge-green',
      texto: `Comunicado publicado: ${c.titulo}`
    })
  })

  const recentes = eventos
    .filter((evento) => noMes(evento.quando, periodoMes))
    .sort((a, b) => new Date(b.quando) - new Date(a.quando))
    .slice(0, 7)

  if (recentes.length === 0) {
    return <div className="empty-state">Nenhuma atividade registrada ainda.</div>
  }

  return (
    <div>
      {recentes.map((ev, i) => (
        <div className="feed-item" key={i}>
          <span className="feed-hora">{formatDateTime(ev.quando)}</span>
          <span className={`badge ${ev.tom}`}>{ev.tipo}</span>
          <span className="feed-texto">{ev.texto}</span>
        </div>
      ))}
    </div>
  )
}

function UltimosComunicados({ periodoMes }) {
  const { comunicados } = useApp()
  const recentes = [...comunicados]
    .filter((comunicado) => noMes(comunicado.criadoEm, periodoMes))
    .sort((a, b) => new Date(b.criadoEm) - new Date(a.criadoEm))
    .slice(0, 4)

  if (recentes.length === 0) {
    return <div className="empty-state">Nenhum comunicado publicado ainda.</div>
  }

  return (
    <div>
      {recentes.map((c) => (
        <div className="feed-item" key={c.id}>
          <span className="feed-hora">{formatDate(c.criadoEm)}</span>
          <span
            className={`badge ${
              c.categoria === 'urgente' || c.categoria === 'manutencao'
                ? 'badge-brick'
                : c.categoria === 'evento'
                  ? 'badge-blue'
                  : 'badge-green'
            }`}
          >
            {CATEGORIAS_MURAL[c.categoria] || CATEGORIAS_MURAL.geral}
          </span>
          <span className="feed-texto">
            {c.titulo}
            {c.fixado ? ' ●' : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function Painel() {
  const { userProfile } = useAuth()
  const { visitantes, encomendas, moradores, comunicados, despesas, orcamentos } = useApp()
  const somenteLeituraDespesas = userProfile?.role === 'morador'
  const mesAtual = new Date().toISOString().slice(0, 7)
  const [periodoMes, setPeriodoMes] = useState(mesAtual)
  const [despesasAbertas, setDespesasAbertas] = useState(false)
  const [mesOrcamentoDetalhado, setMesOrcamentoDetalhado] = useState(null)
  const visitantesDoPeriodo = visitantes.filter((v) => noMes(v.entrada, periodoMes))
  const visitantesAtivos = visitantesDoPeriodo.filter((v) => !v.saida)
  const encomendasDoPeriodo = encomendas.filter((e) => noMes(e.chegadaEm, periodoMes))
  const moradoresDoPeriodo = moradores.filter((m) => noMes(m.criadoEm, periodoMes))
  const comunicadosDoPeriodo = comunicados.filter((c) => noMes(c.criadoEm, periodoMes))
  const aguardando = encomendasDoPeriodo.filter((e) => !e.retiradaEm).length
  const unidades = new Set(moradoresDoPeriodo.map((m) => String(m.unidade || '').trim().toLowerCase())).size

  // Calcula as despesas dentro do intervalo selecionado
  const despesasMes = despesas.filter((d) => !periodoMes || getMonthKey(d.data || d.criadoEm) === periodoMes)
  const totalMes = despesasMes.reduce((acc, d) => acc + (Number(d.valor) || 0), 0)
  const totalDespesas = totalMes
  const despesasRecentes = [...despesasMes].sort((a, b) => new Date(b.data || b.criadoEm) - new Date(a.data || a.criadoEm)).slice(0, 5)
  const anoOrcamento = new Date().getFullYear()
  const dadosOrcamento = MESES_ORCAMENTO.map((nome, index) => {
    const mes = index + 1
    const chave = `${anoOrcamento}-${String(mes).padStart(2, '0')}`
    const orcado = orcamentos
      .filter((item) => Number(item.ano) === anoOrcamento && Number(item.mes) === mes)
      .reduce((total, item) => total + (Number(item.valor) || 0), 0)
    const realizado = despesas
      .filter((item) => getMonthKey(item.data || item.criadoEm) === chave)
      .reduce((total, item) => total + (Number(item.valor) || 0), 0)
    const gastos = despesas.filter((item) => getMonthKey(item.data || item.criadoEm) === chave)
    return { nome, mes, orcado, realizado, gastos }
  })
  const maiorOrcamento = Math.max(1, ...dadosOrcamento.flatMap((item) => [item.orcado, item.realizado]))

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Painel de controle</h1>
          <p className="sub">Visão geral do condomínio · {HOJE}</p>
        </div>
        <div className="filtro-cabecalho">
          <label className="filtro-periodo">
            <span>Mês</span>
            <input type="month" value={periodoMes} onChange={(e) => setPeriodoMes(e.target.value)} />
          </label>
          <button type="button" className="btn btn-compact btn-ghost" onClick={() => setPeriodoMes('')}>
            Todo o período
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          to="/portaria/visitantes"
          num={visitantesAtivos.length}
          label="visitantes no período"
          tom={visitantesAtivos.length > 0 ? 'alerta' : 'ok'}
        />
        <KpiCard
          to="/portaria/encomendas"
          num={aguardando}
          label="encomendas aguardando retirada"
          tom={aguardando > 0 ? 'alerta' : 'ok'}
        />
        <KpiCard
          to={userProfile?.role === 'sindico' ? '/usuarios' : '/painel'}
          num={moradoresDoPeriodo.length}
          label={`moradores cadastrados · ${unidades} ${unidades === 1 ? 'unidade' : 'unidades'}`}
        />
        <KpiCard to="/mural" num={comunicadosDoPeriodo.length} label="comunicados publicados no mural" />
      </div>

      {['sindico', 'zelador', 'morador'].includes(userProfile?.role) && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <div>
              <h2>Orçamento {anoOrcamento}</h2>
              <p className="field-help">Orçado x realizado por mês</p>
            </div>
            {userProfile?.role !== 'morador' && <Link to="/orcamento" className="btn btn-ghost btn-small">Abrir orçamento</Link>}
          </div>
          <div className="orcamento-grafico orcamento-grafico-painel">
            {dadosOrcamento.map((item) => (
              <button type="button" className="orcamento-mes" key={item.nome} onClick={() => setMesOrcamentoDetalhado(item.mes)} aria-label={`Ver detalhes do orçamento de ${item.nome}`}>
                <div className="orcamento-barras">
                  <span className="barra barra-orcado" style={{ height: `${item.orcado ? Math.max(5, (item.orcado / maiorOrcamento) * 100) : 0}%` }} />
                  <span className={`barra barra-realizado${item.realizado > item.orcado && item.realizado > 0 ? ' barra-estourada' : ''}`} style={{ height: `${item.realizado ? Math.max(5, (item.realizado / maiorOrcamento) * 100) : 0}%` }} />
                </div>
                <strong>{item.nome}</strong>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-header">
          <h2>Despesas do período</h2>
          <div className="panel-header-actions">
            <Link to="/despesas" className="btn btn-ghost btn-small">Ver todas</Link>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setDespesasAbertas((aberta) => !aberta)} aria-expanded={despesasAbertas}>
              {despesasAbertas ? 'Recolher' : 'Mostrar'}
            </button>
          </div>
        </div>
        {despesasAbertas && (
          <>
            <div className="despesas-kpi">
              <div className="despesas-kpi-item">
                <span className="despesas-kpi-label">Total do mês</span>
                <span className="despesas-kpi-valor">{formatCurrency(totalMes)}</span>
              </div>
              <div className="despesas-kpi-item">
                <span className="despesas-kpi-label">Nº de despesas</span>
                <span className="despesas-kpi-valor">{despesasMes.length}</span>
              </div>
              <div className="despesas-kpi-item">
                <span className="despesas-kpi-label">Total do período</span>
                <span className="despesas-kpi-valor">{formatCurrency(totalDespesas)}</span>
              </div>
            </div>
            {despesasRecentes.length > 0 && (
              <div className="despesas-recentes">
                {despesasRecentes.map((d) => (
                  <div key={d.id} className="despesa-row">
                    <span className="despesa-categoria">{CATEGORIAS_DESPESA[d.categoria] || '📦 Outros'}</span>
                    <span className="despesa-descricao">{d.descricao}</span>
                    <span className="despesa-valor">{formatCurrency(d.valor)}</span>
                  </div>
                ))}
              </div>
            )}
            {despesasMes.length === 0 && (
              <div className="empty-state">
                Nenhuma despesa cadastrada.
                {!somenteLeituraDespesas && <Link to="/despesas">Registrar primeira despesa</Link>}
              </div>
            )}
          </>
        )}
      </div>

      {mesOrcamentoDetalhado && (() => {
        const item = dadosOrcamento.find((mes) => mes.mes === mesOrcamentoDetalhado)
        return item ? <OrcamentoModal mes={item.mes} ano={anoOrcamento} orcado={item.orcado} despesas={item.gastos} onFechar={() => setMesOrcamentoDetalhado(null)} /> : null
      })()}

      {userProfile?.role !== 'morador' && (
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="panel">
            <div className="panel-header">
              <h2>No condomínio agora</h2>
            </div>
            <NoCondominioList periodoMes={periodoMes} />
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Encomendas aguardando retirada</h2>
            </div>
            <EncomendasAguardandoList periodoMes={periodoMes} />
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2>Atividade recente</h2>
          </div>
          <AtividadeRecente periodoMes={periodoMes} />
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Últimos comunicados</h2>
          </div>
          <UltimosComunicados periodoMes={periodoMes} />
        </div>
      </div>
    </div>
  )
}
