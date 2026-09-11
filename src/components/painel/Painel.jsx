import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatDateTime, formatDate, formatCurrency, getMonthKey } from '../../utils/storage.js'
import { AvisoEncomendaWhatsApp, moradorDaUnidade } from '../shared/AvisoEncomendaWhatsApp.jsx'
import { OrcamentoModal } from '../orcamento/Orcamento.jsx'
import { somaAprovacoesMes, aprovacoesDoMes } from '../orcamento/orcamentoUtils.js'

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

function normalizarUnidade(valor) {
  return String(valor || '').trim().toLowerCase()
}

// Regra de privacidade: o MORADOR só enxerga registros da própria unidade
// (ou endereçados ao próprio nome). Demais perfis (síndico, zelador,
// portaria, master) veem tudo.
function ehDoProprioMorador(registro, userProfile) {
  if (userProfile?.role !== 'morador') return true
  const minhaUnidade = normalizarUnidade(userProfile.unidade)
  const meuNome = normalizarUnidade(userProfile.nome)
  if (minhaUnidade && normalizarUnidade(registro.unidade) === minhaUnidade) return true
  if (meuNome && normalizarUnidade(registro.destinatario) === meuNome) return true
  return false
}

function NoCondominioList({ periodoMes, userProfile }) {
  const { visitantes, registrarSaida } = useApp()
  const ehMorador = userProfile?.role === 'morador'
  const dentro = visitantes
    .filter((v) => !v.saida && noMes(v.entrada, periodoMes))
    .filter((v) => ehDoProprioMorador(v, userProfile))

  if (dentro.length === 0) {
    if (ehMorador && !normalizarUnidade(userProfile?.unidade)) {
      return (
        <div className="empty-state">
          Sua unidade não está definida no perfil. Avise o síndico para atualizar seu cadastro e ver os visitantes da sua unidade.
        </div>
      )
    }
    return (
      <div className="empty-state">
        {ehMorador ? 'Nenhum visitante na sua unidade agora.' : 'Nenhum visitante no condomínio agora.'}
      </div>
    )
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
          {!ehMorador && (
            <div className="log-actions">
              <button className="btn btn-ghost btn-small" onClick={() => registrarSaida(v.id)}>
                Registrar saída
              </button>
            </div>
          )}
        </div>
      ))}
      {dentro.length > 5 && !ehMorador && (
        <div className="list-mais">
          <Link to="/portaria/visitantes">Ver todos os {dentro.length} visitantes…</Link>
        </div>
      )}
      {dentro.length > 5 && ehMorador && (
        <div className="list-mais">…e mais {dentro.length - 5} visitante(s) da sua unidade.</div>
      )}
    </div>
  )
}

function EncomendasAguardandoList({ periodoMes, userProfile }) {
  const { encomendas, moradores, registrarAvisoEncomenda } = useApp()
  const [encomendaDetalhada, setEncomendaDetalhada] = useState(null)
  const ehMorador = userProfile?.role === 'morador'
  const pendentes = encomendas
    .filter((e) => !e.retiradaEm && noMes(e.chegadaEm, periodoMes))
    .filter((e) => ehDoProprioMorador(e, userProfile))
    .sort((a, b) => new Date(a.chegadaEm) - new Date(b.chegadaEm))

  if (pendentes.length === 0) {
    if (ehMorador && !normalizarUnidade(userProfile?.unidade)) {
      return (
        <div className="empty-state">
          Sua unidade não está definida no perfil. Avise o síndico para atualizar seu cadastro e ver suas encomendas.
        </div>
      )
    }
    return (
      <div className="empty-state">
        {ehMorador ? 'Nenhuma encomenda da sua unidade aguardando retirada.' : 'Nenhuma encomenda aguardando retirada.'}
      </div>
    )
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
                {e.avisadoEm && <span className="encomenda-avisado">· 📢 avisado {formatDateTime(e.avisadoEm)}</span>}
              </div>
            </div>
            <div className="log-actions">
              {!ehMorador && <AvisoEncomendaWhatsApp encomenda={e} onAviso={() => registrarAvisoEncomenda(e.id)} />}
              <button className="btn btn-ghost btn-small" type="button" onClick={() => setEncomendaDetalhada(e)}>
                Abrir
              </button>
            </div>
          </div>
        )
      })}
      {pendentes.length > 5 && !ehMorador && (
        <div className="list-mais">
          <Link to="/portaria/encomendas">Ver todas as {pendentes.length} encomendas…</Link>
        </div>
      )}
      {pendentes.length > 5 && ehMorador && (
        <div className="list-mais">…e mais {pendentes.length - 5} encomenda(s) da sua unidade.</div>
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
                <div><span>Avisado em</span><strong>{encomendaDetalhada.avisadoEm ? formatDateTime(encomendaDetalhada.avisadoEm) : 'Não avisado'}</strong></div>
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

function AtividadeRecente({ periodoMes, userProfile }) {
  const { visitantes, encomendas, comunicados } = useApp()
  const eventos = []

  visitantes
    .filter((v) => ehDoProprioMorador(v, userProfile))
    .forEach((v) => {
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

  encomendas
    .filter((e) => ehDoProprioMorador(e, userProfile))
    .forEach((e) => {
    const status = e.retiradaEm
      ? `Retirada${e.assinatura ? ' — com assinatura' : ''}`
      : 'Aguardando retirada'
    const recebida = formatDateTime(e.chegadaEm)
    const retirada = e.retiradaEm ? formatDateTime(e.retiradaEm) : '—'
    const corStatus = e.retiradaEm ? 'status-retirada' : 'status-pendente'
    eventos.push({
      quando: e.retiradaEm || e.chegadaEm,
      tipo: 'Encomenda',
      tom: e.retiradaEm ? 'badge-green' : 'badge-brick',
      texto: `<span class="${corStatus}">${status}</span> — ${e.unidade}${e.transportadora ? ` (${e.transportadora})` : ''} · recebida ${recebida} · retirada ${retirada}`,
      semHora: true,
      html: true
    })
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
          {!ev.semHora && <span className="feed-hora">{formatDateTime(ev.quando)}</span>}
          <span className={`badge ${ev.tom}`}>{ev.tipo}</span>
          {ev.html
            ? <span className="feed-texto" dangerouslySetInnerHTML={{ __html: ev.texto }} />
            : <span className="feed-texto">{ev.texto}</span>
          }
        </div>
      ))}
    </div>
  )
}

function UltimosComunicados({ periodoMes }) {
  const { comunicados } = useApp()
  const [comunicadoDetalhado, setComunicadoDetalhado] = useState(null)
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
        <button
          type="button"
          className="feed-item feed-item-btn"
          key={c.id}
          onClick={() => setComunicadoDetalhado(c)}
          title="Ver comunicado completo"
        >
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
          <div className="feed-cuerpo">
            <span className="feed-texto">
              {c.titulo}
              {c.fixado ? ' ●' : ''}
            </span>
            {c.conteudo && (
              <p className="feed-mensaje">{c.conteudo}</p>
            )}
          </div>
        </button>
      ))}

      {comunicadoDetalhado && (
        <div className="modal-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setComunicadoDetalhado(null)}>
          <div className="modal comunicado-modal" role="dialog" aria-modal="true" aria-labelledby="comunicado-modal-titulo">
            <div className="modal-header">
              <div>
                <h2 id="comunicado-modal-titulo">{comunicadoDetalhado.titulo}</h2>
                <p className="sub">
                  <span className={`badge ${
                    comunicadoDetalhado.categoria === 'urgente' || comunicadoDetalhado.categoria === 'manutencao'
                      ? 'badge-brick'
                      : comunicadoDetalhado.categoria === 'evento'
                        ? 'badge-blue'
                        : 'badge-green'
                  }`}>
                    {CATEGORIAS_MURAL[comunicadoDetalhado.categoria] || CATEGORIAS_MURAL.geral}
                  </span>{' '}
                  {comunicadoDetalhado.fixado && '● Fixado '}· {formatDate(comunicadoDetalhado.criadoEm)}
                </p>
              </div>
              <button type="button" className="modal-fechar" onClick={() => setComunicadoDetalhado(null)} aria-label="Fechar">×</button>
            </div>
            <div className="modal-body">
              {comunicadoDetalhado.conteudo ? (
                <p className="comunicado-modal-contenido">{comunicadoDetalhado.conteudo}</p>
              ) : (
                <p className="empty">Este comunicado não possui texto adicional.</p>
              )}
            </div>
            <div className="modal-actions">
              <span className="comunicado-modal-autor">— {comunicadoDetalhado.autor || 'Administração'}</span>
              <button type="button" className="btn btn-ghost" onClick={() => setComunicadoDetalhado(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Painel() {
  const { userProfile } = useAuth()
  const { visitantes, encomendas, moradores, comunicados, despesas, orcamentos, aprovacoes } = useApp()
  const somenteLeituraDespesas = userProfile?.role === 'morador'
  const mesAtual = new Date().toISOString().slice(0, 7)
  const [periodoMes, setPeriodoMes] = useState(mesAtual)
  const [despesasAbertas, setDespesasAbertas] = useState(false)
  const [condominioAberto, setCondominioAberto] = useState(false)
  const [encomendasAberta, setEncomendasAberta] = useState(false)
  const [atividadeAberta, setAtividadeAberta] = useState(false)
  const [comunicadosAberto, setComunicadosAberto] = useState(false)
  const [mesOrcamentoDetalhado, setMesOrcamentoDetalhado] = useState(null)
  const visitantesDoPeriodo = visitantes.filter((v) => noMes(v.entrada, periodoMes))
  const visitantesAtivos = visitantesDoPeriodo.filter((v) => !v.saida)
  const encomendasDoPeriodo = encomendas.filter((e) => noMes(e.chegadaEm, periodoMes))
  const moradoresDoPeriodo = moradores.filter((m) => noMes(m.criadoEm, periodoMes))
  const comunicadosDoPeriodo = comunicados.filter((c) => noMes(c.criadoEm, periodoMes))
  // Total de eventos da "Atividade recente" (mesma lógica da lista): 1 evento por
  // entrada de visitante + 1 por saída + 1 por encomenda + 1 por comunicado, do período.
  const totalAtividade =
    visitantes
      .filter((v) => ehDoProprioMorador(v, userProfile))
      .reduce(
        (acc, v) => acc + (noMes(v.entrada, periodoMes) ? 1 : 0) + (v.saida && noMes(v.saida, periodoMes) ? 1 : 0),
        0
      ) +
    encomendas.filter((e) => ehDoProprioMorador(e, userProfile) && noMes(e.retiradaEm || e.chegadaEm, periodoMes)).length +
    comunicados.filter((c) => noMes(c.criadoEm, periodoMes)).length
  const aguardando = encomendasDoPeriodo.filter((e) => !e.retiradaEm).length
  const entregues = encomendasDoPeriodo.filter((e) => e.retiradaEm).length
  const unidades = new Set(moradoresDoPeriodo.map((m) => String(m.unidade || '').trim().toLowerCase())).size

  // Privacidade: para o morador, os números exibidos consideram apenas
  // registros da própria unidade (demais perfis veem o condomínio inteiro).
  const ehMorador = userProfile?.role === 'morador'
  const visitantesAtivosVisiveis = visitantesAtivos.filter((v) => ehDoProprioMorador(v, userProfile))
  const encomendasVisiveis = encomendasDoPeriodo.filter((e) => ehDoProprioMorador(e, userProfile))
  const aguardandoVisivel = encomendasVisiveis.filter((e) => !e.retiradaEm).length
  const entreguesVisivel = encomendasVisiveis.filter((e) => e.retiradaEm).length
  const destinoPortaria = ehMorador ? '/painel' : null

  // Calcula as despesas dentro do intervalo selecionado
  const despesasMes = despesas.filter((d) => !periodoMes || getMonthKey(d.data || d.criadoEm) === periodoMes)
  const totalMes = despesasMes.reduce((acc, d) => acc + (Number(d.valor) || 0), 0)
  const totalDespesas = totalMes
  const despesasRecentes = [...despesasMes].sort((a, b) => new Date(b.data || b.criadoEm) - new Date(a.data || a.criadoEm)).slice(0, 5)
  const anoOrcamento = new Date().getFullYear()
  const dadosOrcamento = MESES_ORCAMENTO.map((nome, index) => {
    const mes = index + 1
    const chave = `${anoOrcamento}-${String(mes).padStart(2, '0')}`
    const itensOrcados = orcamentos
      .filter((item) => Number(item.ano) === anoOrcamento && Number(item.mes) === mes)
    const orcado = somaAprovacoesMes(itensOrcados, aprovacoesDoMes(aprovacoes, anoOrcamento, mes))
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
          to={destinoPortaria || '/portaria/visitantes'}
          num={ehMorador ? visitantesAtivosVisiveis.length : visitantesAtivos.length}
          label={ehMorador ? 'visitantes da sua unidade no período' : 'visitantes no período'}
          tom={(ehMorador ? visitantesAtivosVisiveis.length : visitantesAtivos.length) > 0 ? 'alerta' : 'ok'}
        />
        <KpiCard
          to={destinoPortaria || '/portaria/encomendas'}
          num={ehMorador ? aguardandoVisivel : aguardando}
          label="encomendas aguardando retirada"
          tom={(ehMorador ? aguardandoVisivel : aguardando) > 0 ? 'alerta' : 'ok'}
        />
        <KpiCard
          to={destinoPortaria || '/portaria/encomendas'}
          num={ehMorador ? entreguesVisivel : entregues}
          label={ehMorador ? 'encomendas da sua unidade entregues' : 'encomendas entregues'}
          tom="ok"
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
                  <span
                    className="barra barra-orcado"
                    data-rotulo={item.orcado > 0 ? formatCurrency(item.orcado) : ''}
                    style={{ height: `${item.orcado ? Math.max(5, (item.orcado / maiorOrcamento) * 100) : 0}%` }}
                    title={`Orçado: ${formatCurrency(item.orcado)}`}
                  />
                  <span
                    className={`barra barra-realizado${item.realizado > item.orcado && item.realizado > 0 ? ' barra-estourada' : ''}`}
                    data-rotulo={item.realizado > 0 ? formatCurrency(item.realizado) : ''}
                    style={{ height: `${item.realizado ? Math.max(5, (item.realizado / maiorOrcamento) * 100) : 0}%` }}
                    title={`Realizado: ${formatCurrency(item.realizado)}`}
                  />
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
        return item ? <OrcamentoModal mes={item.mes} ano={anoOrcamento} orcado={item.orcado} despesas={item.gastos} orcamentosDoAno={orcamentos.filter((o) => Number(o.ano) === anoOrcamento)} aprovacoes={aprovacoes} onFechar={() => setMesOrcamentoDetalhado(null)} /> : null
      })()}

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="panel">
          <div className="panel-header">
            <h2>No condomínio agora <span className="panel-total panel-total--blue">{visitantesAtivosVisiveis.length}</span></h2>
            <button
              type="button"
              className="btn btn-ghost btn-small panel-toggle"
              onClick={() => setCondominioAberto((v) => !v)}
              aria-expanded={condominioAberto}
            >
              {condominioAberto ? '▾ Recolher' : '▸ Expandir'}
            </button>
          </div>
          {condominioAberto && <NoCondominioList periodoMes={periodoMes} userProfile={userProfile} />}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Encomendas aguardando retirada <span className="panel-total panel-total--brick">{aguardandoVisivel}</span></h2>
            <button
              type="button"
              className="btn btn-ghost btn-small panel-toggle"
              onClick={() => setEncomendasAberta((v) => !v)}
              aria-expanded={encomendasAberta}
            >
              {encomendasAberta ? '▾ Recolher' : '▸ Expandir'}
            </button>
          </div>
          {encomendasAberta && <EncomendasAguardandoList periodoMes={periodoMes} userProfile={userProfile} />}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2>Atividade recente <span className="panel-total panel-total--green">{totalAtividade}</span></h2>
            <button
              type="button"
              className="btn btn-ghost btn-small panel-toggle"
              onClick={() => setAtividadeAberta((v) => !v)}
              aria-expanded={atividadeAberta}
            >
              {atividadeAberta ? '▾ Recolher' : '▸ Expandir'}
            </button>
          </div>
          {atividadeAberta && <AtividadeRecente periodoMes={periodoMes} userProfile={userProfile} />}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Últimos comunicados <span className="panel-total panel-total--brass">{comunicadosDoPeriodo.length}</span></h2>
            <button
              type="button"
              className="btn btn-ghost btn-small panel-toggle"
              onClick={() => setComunicadosAberto((v) => !v)}
              aria-expanded={comunicadosAberto}
            >
              {comunicadosAberto ? '▾ Recolher' : '▸ Expandir'}
            </button>
          </div>
          {comunicadosAberto && <UltimosComunicados periodoMes={periodoMes} />}
        </div>
      </div>
    </div>
  )
}
