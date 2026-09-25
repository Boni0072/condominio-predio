import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatDateTime, formatDate, formatCurrency, formatRotuloGrafico, getMonthKey } from '../../utils/storage.js'
import { AvisoEncomendaWhatsApp, moradorDaUnidade } from '../shared/AvisoEncomendaWhatsApp.jsx'
import { OrcamentoModal } from '../orcamento/Orcamento.jsx'
import { somaAprovacoesMes, aprovacoesDoMes } from '../orcamento/orcamentoUtils.js'
import { useCobrancas } from '../pagamentos/useCobrancas.js'
import { resumoCobrancasDoMes } from '../pagamentos/cobrancas.js'
import {
  temAcesso,
  filtrarDoUsuario,
  normalizarParaComparacao,
  veTodosOsRegistros
} from '../../utils/permissoes.js'

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
  folha_pagamento: '💼 Folha de Pagamento',
  outros: '📦 Outros'
}

const MESES_ORCAMENTO = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const MESES_ORCAMENTO_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']

// Modal aberto pelo botão "Abrir orçamento" no Painel: lista os aprovadores
// de cada mês do ano, com nome + data e hora da assinatura.
function AprovadoresOrcamentoModal({ ano, aprovacoes = [], onFechar }) {
  const porMes = MESES_ORCAMENTO_LONGO.map((nome, indice) => {
    const mes = indice + 1
    const mapa = new Map()
    aprovacoesDoMes(aprovacoes, ano, mes).forEach((a) => {
      const chave = a.usuarioId || a.usuarioEmail || a.usuarioNome || a.id
      if (!chave || mapa.has(chave)) return
      mapa.set(chave, {
        chave,
        nome: a.usuarioNome || a.usuarioEmail || 'Usuário',
        papel: a.usuarioRole || '',
        criadoEm: a.criadoEm || ''
      })
    })
    const lista = [...mapa.values()].sort((x, y) => new Date(x.criadoEm || 0) - new Date(y.criadoEm || 0))
    return { nome, mes, lista }
  })
  const total = porMes.reduce((soma, m) => soma + m.lista.length, 0)

  return (
    <div className="modal-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className="modal orcamento-modal" role="dialog" aria-modal="true" aria-labelledby="aprovadores-orcamento-titulo">
        <div className="modal-header">
          <div>
            <h2 id="aprovadores-orcamento-titulo">Aprovadores do orçamento {ano}</h2>
            <p className="sub">{total} assinatura(s) no ano · quem aprovou cada mês, com data e hora</p>
          </div>
          <button type="button" className="modal-fechar" onClick={onFechar} aria-label="Fechar">×</button>
        </div>
        <div className="modal-body">
          {total === 0 ? (
            <p className="empty">Nenhum aprovador registrou assinatura em {ano}.</p>
          ) : (
            <div className="orcamento-detalhes">
              {porMes.map((m) => (
                m.lista.length === 0 ? null : (
                  <section key={m.mes} className="orcamento-detalhe-categoria">
                    <div className="orcamento-detalhe-cabecalho">
                      <strong>{m.nome}</strong>
                      <span>{m.lista.length} assinatura(s)</span>
                    </div>
                    <ul className="orcamento-aprovadores-lista">
                      {m.lista.map((ap) => (
                        <li key={ap.chave}>
                          <span>✓ {ap.nome}{ap.papel ? ` · ${ap.papel}` : ''}</span>
                          <small>{ap.criadoEm ? formatDateTime(ap.criadoEm) : '—'}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              ))}
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

// Regra de privacidade (ver src/utils/permissoes.js): cada usuário enxerga
// apenas os PRÓPRIOS registros de visitantes e encomendas (sua unidade/nome).
// Somente os gestores (síndico, zelador e portaria) veem o condomínio inteiro —
// conselheiro e morador NÃO entram mais na visão geral.

function NoCondominioList({ periodoMes, userProfile }) {
  const { visitantes, registrarSaida } = useApp()
  // Somente os gestores veem todos os visitantes; os demais veem apenas os da
  // própria unidade (ver regra de privacidade em utils/permissoes.js).
  const visaoTotal = veTodosOsRegistros(userProfile)
  const dentro = filtrarDoUsuario(visitantes, userProfile)
    .filter((v) => !v.saida && noMes(v.entrada, periodoMes))

  if (dentro.length === 0) {
    if (!visaoTotal && !normalizarParaComparacao(userProfile?.unidade)) {
      return (
        <div className="empty-state">
          Sua unidade não está definida no perfil. Avise o síndico para atualizar seu cadastro e ver os visitantes da sua unidade.
        </div>
      )
    }
    return (
      <div className="empty-state">
        {visaoTotal ? 'Nenhum visitante no condomínio agora.' : 'Nenhum visitante na sua unidade agora.'}
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
          {visaoTotal && (
            <div className="log-actions">
              <button className="btn btn-ghost btn-small" onClick={() => registrarSaida(v.id)}>
                Registrar saída
              </button>
            </div>
          )}
        </div>
      ))}
      {dentro.length > 5 && visaoTotal && (
        <div className="list-mais">
          <Link to="/portaria/visitantes">Ver todos os {dentro.length} visitantes…</Link>
        </div>
      )}
      {dentro.length > 5 && !visaoTotal && (
        <div className="list-mais">…e mais {dentro.length - 5} visitante(s) da sua unidade.</div>
      )}
    </div>
  )
}

function EncomendasAguardandoList({ periodoMes, userProfile }) {
  const { encomendas, moradores, registrarAvisoEncomenda } = useApp()
  const [encomendaDetalhada, setEncomendaDetalhada] = useState(null)
  // Somente os gestores veem todas as encomendas; os demais veem apenas as da
  // própria unidade (regra de privacidade em utils/permissoes.js).
  const visaoTotal = veTodosOsRegistros(userProfile)
  const pendentes = filtrarDoUsuario(encomendas, userProfile)
    .filter((e) => !e.retiradaEm && noMes(e.chegadaEm, periodoMes))
    .sort((a, b) => new Date(a.chegadaEm) - new Date(b.chegadaEm))

  if (pendentes.length === 0) {
    if (!visaoTotal && !normalizarParaComparacao(userProfile?.unidade)) {
      return (
        <div className="empty-state">
          Sua unidade não está definida no perfil. Avise o síndico para atualizar seu cadastro e ver suas encomendas.
        </div>
      )
    }
    return (
      <div className="empty-state">
        {visaoTotal ? 'Nenhuma encomenda aguardando retirada.' : 'Nenhuma encomenda da sua unidade aguardando retirada.'}
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
              {visaoTotal && <AvisoEncomendaWhatsApp encomenda={e} onAviso={() => registrarAvisoEncomenda(e.id)} />}
              <button className="btn btn-ghost btn-small" type="button" onClick={() => setEncomendaDetalhada(e)}>
                Abrir
              </button>
            </div>
          </div>
        )
      })}
      {pendentes.length > 5 && visaoTotal && (
        <div className="list-mais">
          <Link to="/portaria/encomendas">Ver todas as {pendentes.length} encomendas…</Link>
        </div>
      )}
      {pendentes.length > 5 && !visaoTotal && (
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
  const [eventoDetalhado, setEventoDetalhado] = useState(null)
  const eventos = []

  filtrarDoUsuario(visitantes, userProfile)
    .forEach((v) => {
    eventos.push({
      quando: v.entrada,
      tipo: 'Visitante',
      tom: 'badge-blue',
      texto: `${v.nome} entrou no condomínio (${v.unidade})`,
      detalhes: {
        tipo: 'visitante',
        visitante: v,
        acao: 'entrada'
      }
    })
    if (v.saida) {
      eventos.push({
        quando: v.saida,
        tipo: 'Visitante',
        tom: 'badge-blue',
        texto: `${v.nome} saiu do condomínio`,
        detalhes: {
          tipo: 'visitante',
          visitante: v,
          acao: 'saida'
        }
      })
    }
  })

  filtrarDoUsuario(encomendas, userProfile)
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
      html: true,
      detalhes: {
        tipo: 'encomenda',
        encomenda: e
      }
    })
  })

  comunicados.forEach((c) => {
    eventos.push({
      quando: c.criadoEm,
      tipo: 'Mural',
      tom: 'badge-green',
      texto: `Comunicado publicado: ${c.titulo}`,
      detalhes: {
        tipo: 'comunicado',
        comunicado: c
      }
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
        <button
          type="button"
          className="feed-item feed-item-btn"
          key={i}
          onClick={() => setEventoDetalhado(ev)}
          title="Ver detalhes"
        >
          {!ev.semHora && <span className="feed-hora">{formatDateTime(ev.quando)}</span>}
          <span className={`badge ${ev.tom}`}>{ev.tipo}</span>
          {ev.html
            ? <span className="feed-texto" dangerouslySetInnerHTML={{ __html: ev.texto }} />
            : <span className="feed-texto">{ev.texto}</span>
          }
        </button>
      ))}
      {eventoDetalhado && eventoDetalhado.detalhes.tipo === 'visitante' && (() => {
        const { visitante, acao } = eventoDetalhado.detalhes
        return (
          <div className="modal-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEventoDetalhado(null)}>
            <div className="modal atividade-detalhes-modal" role="dialog" aria-modal="true" aria-labelledby="atividade-detalhes-titulo">
              <div className="modal-header">
                <div>
                  <h2 id="atividade-detalhes-titulo">
                    {acao === 'entrada' ? 'Entrada de Visitante' : 'Saída de Visitante'}
                  </h2>
                  <p className="sub">Detalhes do registro</p>
                </div>
                <button type="button" className="modal-fechar" onClick={() => setEventoDetalhado(null)} aria-label="Fechar">×</button>
              </div>
              <div className="modal-body atividade-detalhes-conteudo">
                <div className="atividade-detalhes-grid">
                  <div><span>Visitante</span><strong>{visitante.nome}</strong></div>
                  <div><span>Unidade</span><strong>{visitante.unidade}</strong></div>
                  {visitante.documento && <div><span>Documento</span><strong>{visitante.documento}</strong></div>}
                  {visitante.telefone && <div><span>Telefone</span><strong>{visitante.telefone}</strong></div>}
                  <div><span>Entrada</span><strong>{formatDateTime(visitante.entrada)}</strong></div>
                  <div><span>Saída</span><strong>{visitante.saida ? formatDateTime(visitante.saida) : '—'}</strong></div>
                  {visitante.autorizadoPor && <div><span>Autorizado por</span><strong>{visitante.autorizadoPor}</strong></div>}
                  {visitante.observacoes && <div><span>Observações</span><strong>{visitante.observacoes}</strong></div>}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEventoDetalhado(null)}>Fechar</button>
              </div>
            </div>
          </div>
        )
      })()}
      {eventoDetalhado && eventoDetalhado.detalhes.tipo === 'encomenda' && (() => {
        const { encomenda } = eventoDetalhado.detalhes
        const statusEncomenda = encomenda.retiradaEm ? 'Retirada' : 'Aguardando retirada'
        return (
          <div className="modal-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEventoDetalhado(null)}>
            <div className="modal atividade-detalhes-modal" role="dialog" aria-modal="true" aria-labelledby="atividade-detalhes-titulo">
              <div className="modal-header">
                <div>
                  <h2 id="atividade-detalhes-titulo">Detalhes da Encomenda</h2>
                  <p className="sub">Informações do recebimento</p>
                </div>
                <button type="button" className="modal-fechar" onClick={() => setEventoDetalhado(null)} aria-label="Fechar">×</button>
              </div>
              <div className="modal-body atividade-detalhes-conteudo">
                <div className="atividade-detalhes-grid">
                  <div><span>Destinatário</span><strong>{encomenda.destinatario || 'Não informado'}</strong></div>
                  <div><span>Unidade</span><strong>{encomenda.unidade}</strong></div>
                  <div><span>Transportadora / origem</span><strong>{encomenda.transportadora || 'Não informado'}</strong></div>
                  <div><span>Chegada</span><strong>{formatDateTime(encomenda.chegadaEm)}</strong></div>
                  {encomenda.retiradaEm && <div><span>Retirada</span><strong>{formatDateTime(encomenda.retiradaEm)}</strong></div>}
                  {encomenda.retiradoPor && <div><span>Retirado por</span><strong>{encomenda.retiradoPor}</strong></div>}
                  <div><span>Status</span><strong>{statusEncomenda}</strong></div>
                  {encomenda.observacoes && <div><span>Observações</span><strong>{encomenda.observacoes}</strong></div>}
                </div>
                {encomenda.assinatura && (
                  <div className="atividade-detalhes-assinatura">
                    <span>Assinatura de quem retirou</span>
                    <a href={encomenda.assinatura} target="_blank" rel="noreferrer" className="assinatura-thumb-link">
                      <img src={encomenda.assinatura} alt="Assinatura de quem retirou" className="assinatura-thumb" />
                    </a>
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setEventoDetalhado(null)}>Fechar</button>
              </div>
            </div>
          </div>
        )
      })()}
      {eventoDetalhado && eventoDetalhado.detalhes.tipo === 'comunicado' && (() => {
        const { comunicado } = eventoDetalhado.detalhes
        return (
          <div className="modal-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEventoDetalhado(null)}>
            <div className="modal atividade-detalhes-modal" role="dialog" aria-modal="true" aria-labelledby="atividade-detalhes-titulo">
              <div className="modal-header">
                <div>
                  <h2 id="atividade-detalhes-titulo">{comunicado.titulo}</h2>
                  <p className="sub">
                    <span className={`badge ${
                      comunicado.categoria === 'urgente' || comunicado.categoria === 'manutencao'
                        ? 'badge-brick'
                        : comunicado.categoria === 'evento'
                          ? 'badge-blue'
                          : 'badge-green'
                    }`}>
                      {CATEGORIAS_MURAL[comunicado.categoria] || CATEGORIAS_MURAL.geral}
                    </span>{' '}
                    {comunicado.fixado && '● Fixado '}· {formatDate(comunicado.criadoEm)}
                  </p>
                </div>
                <button type="button" className="modal-fechar" onClick={() => setEventoDetalhado(null)} aria-label="Fechar">×</button>
              </div>
              <div className="modal-body atividade-detalhes-conteudo">
                {comunicado.conteudo ? (
                  <p className="atividade-detalhes-conteudo-texto">{comunicado.conteudo}</p>
                ) : (
                  <p className="empty">Este comunicado não possui texto adicional.</p>
                )}
              </div>
              <div className="modal-actions">
                <span className="atividade-detalhes-autor">— {comunicado.autor || 'Administração'}</span>
                <button type="button" className="btn btn-ghost" onClick={() => setEventoDetalhado(null)}>Fechar</button>
              </div>
            </div>
          </div>
        )
      })()}
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
  const { cobrancas } = useCobrancas()
  const somenteLeituraDespesas = userProfile?.role === 'morador'
  const mesAtual = new Date().toISOString().slice(0, 7)
  const [periodoMes, setPeriodoMes] = useState(mesAtual)
  const [despesasAbertas, setDespesasAbertas] = useState(false)
  const [condominioAberto, setCondominioAberto] = useState(false)
  const [encomendasAberta, setEncomendasAberta] = useState(false)
  const [atividadeAberta, setAtividadeAberta] = useState(false)
  const [comunicadosAberto, setComunicadosAberto] = useState(false)
  const [mesOrcamentoDetalhado, setMesOrcamentoDetalhado] = useState(null)
  // Modal de aprovadores aberto pelo botão "Abrir orçamento": lista quem
  // assinou cada mês do ano, com data e hora.
  const [aprovadoresOrcamentoAberto, setAprovadoresOrcamentoAberto] = useState(false)
  const visitantesVisiveis = filtrarDoUsuario(visitantes, userProfile)
  const encomendasVisiveisTotais = filtrarDoUsuario(encomendas, userProfile)
  const visitantesDoPeriodo = visitantesVisiveis.filter((v) => noMes(v.entrada, periodoMes))
  const visitantesAtivos = visitantesDoPeriodo.filter((v) => !v.saida)
  const encomendasDoPeriodo = encomendasVisiveisTotais.filter((e) => noMes(e.chegadaEm, periodoMes))
  const moradoresDoPeriodo = moradores.filter((m) => noMes(m.criadoEm, periodoMes))
  const comunicadosDoPeriodo = comunicados.filter((c) => noMes(c.criadoEm, periodoMes))
  // Total de eventos da "Atividade recente" (mesma lógica da lista): 1 evento por
  // entrada de visitante + 1 por saída + 1 por encomenda + 1 por comunicado, do período.
  const totalAtividade =
    visitantesVisiveis
      .reduce(
        (acc, v) => acc + (noMes(v.entrada, periodoMes) ? 1 : 0) + (v.saida && noMes(v.saida, periodoMes) ? 1 : 0),
        0
      ) +
    encomendasVisiveisTotais.filter((e) => noMes(e.retiradaEm || e.chegadaEm, periodoMes)).length +
    comunicados.filter((c) => noMes(c.criadoEm, periodoMes)).length
  const unidades = new Set(moradoresDoPeriodo.map((m) => String(m.unidade || '').trim().toLowerCase())).size

  // Privacidade: visitantes e encomendas só mostram o condomínio inteiro para os
  // gestores (síndico, zelador e portaria). Morador e conselheiro veem apenas os
  // registros da própria unidade/nome — inclusive nos cartões de resumo.
  const visaoTotal = veTodosOsRegistros(userProfile)
  const visitantesAtivosVisiveis = visitantesAtivos
  const encomendasVisiveis = encomendasDoPeriodo
  const aguardandoVisivel = encomendasVisiveis.filter((e) => !e.retiradaEm).length
  const entreguesVisivel = encomendasVisiveis.filter((e) => e.retiradaEm).length
  // Sem visão total, os cartões levam de volta ao próprio painel (o usuário não
  // tem acesso à página da portaria).
  const destinoPortaria = visaoTotal ? null : '/painel'

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
    const resumoCobrancas = resumoCobrancasDoMes(cobrancas, chave)
    const orcado = somaAprovacoesMes(itensOrcados, aprovacoesDoMes(aprovacoes, anoOrcamento, mes))
    const realizado = despesas
      .filter((item) => getMonthKey(item.data || item.criadoEm) === chave)
      .reduce((total, item) => total + (Number(item.valor) || 0), 0)
    // Saldo disponível: o que sobrou do orçado após o realizado (nunca negativo).
    const saldo = Math.max(0, orcado - realizado)
    const gastos = despesas.filter((item) => getMonthKey(item.data || item.criadoEm) === chave)
    return { nome, mes, orcado, realizado, saldo, resumoCobrancas, gastos }
  })
  const maiorOrcamento = Math.max(1, ...dadosOrcamento.flatMap((item) => [item.orcado, item.realizado, item.saldo, item.resumoCobrancas.total]))

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
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          to={destinoPortaria || '/portaria/visitantes'}
          num={visitantesAtivosVisiveis.length}
          label={visaoTotal ? 'visitantes no período' : 'visitantes da sua unidade no período'}
          tom={visitantesAtivosVisiveis.length > 0 ? 'alerta' : 'ok'}
        />
        <KpiCard
          to={destinoPortaria || '/portaria/encomendas'}
          num={aguardandoVisivel}
          label="encomendas aguardando retirada"
          tom={aguardandoVisivel > 0 ? 'alerta' : 'ok'}
        />
        <KpiCard
          to={destinoPortaria || '/portaria/encomendas'}
          num={entreguesVisivel}
          label={visaoTotal ? 'encomendas entregues' : 'encomendas da sua unidade entregues'}
          tom="ok"
        />
        <KpiCard
          to="/usuarios"
          num={moradoresDoPeriodo.length}
          label={`moradores cadastrados · ${unidades} ${unidades === 1 ? 'unidade' : 'unidades'}`}
        />
        <KpiCard to="/mural" num={comunicadosDoPeriodo.length} label="comunicados publicados no mural" />
      </div>

      {/* Orçado x realizado por mês. O conselheiro (perfil que aprova orçamentos
      no sistema) SEMPRE vê o gráfico no painel — era uma regressão quando a
      lista de acessos salva no Firestore ficou sem "orcamento" (dados antigos).
      O morador continua vendo como transparência. */}
      {(userProfile?.role === 'morador' || userProfile?.role === 'conselheiro' || temAcesso(userProfile, 'orcamento')) && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <div>
              <h2>Orçamento {anoOrcamento}</h2>
              <p className="field-help">Condômino, Orçado, realizado e saldo por mês</p>
            </div>
          </div>
          <div className="orcamento-legenda" style={{ padding: '0 4px 8px' }}>
            <span><i className="legenda-cobrancas" /> Condômino</span>
            <span><i className="legenda-orcado" /> Orçado</span>
            <span><i className="legenda-realizado" /> Realizado</span>
            <span><i className="legenda-saldo" /> Saldo disponível</span>
          </div>
          <div className="orcamento-grafico orcamento-grafico-painel">
            {dadosOrcamento.map((item) => {
              // Alerta de fundo: orçado maior do que o cobrado no mês
              // (orcado > 0 e acima das cobranças emitidas).
              const orcadoAcimaCobrancas = item.orcado > 0 && item.orcado > item.resumoCobrancas.total
              return (
              <button
                type="button"
                className={`orcamento-mes${orcadoAcimaCobrancas ? ' orcamento-mes-alerta' : ''}`}
                key={item.nome}
                onClick={() => setMesOrcamentoDetalhado(item.mes)}
                aria-label={`Ver detalhes do orçamento de ${item.nome}`}
              >
                <div className="orcamento-barras">
                  <span
                    className="barra barra-cobrancas"
                    data-rotulo={formatRotuloGrafico(item.resumoCobrancas.total, { simbolo: false, escala: 1000 })}
                    style={{ height: `${item.resumoCobrancas.total ? Math.max(5, (item.resumoCobrancas.total / maiorOrcamento) * 100) : 0}%` }}
                    title={`Cobranças do mês: ${formatCurrency(item.resumoCobrancas.total)} (${item.resumoCobrancas.quantidade} emitida(s))`}
                  />
                  <span
                    className="barra barra-orcado"
                    data-rotulo={formatRotuloGrafico(item.orcado, { simbolo: false, escala: 1000 })}
                    style={{ height: `${item.orcado ? Math.max(5, (item.orcado / maiorOrcamento) * 100) : 0}%` }}
                    title={`Orçado: ${formatCurrency(item.orcado)}`}
                  />
                  <span
                    className={`barra barra-realizado${item.realizado > item.orcado && item.realizado > 0 ? ' barra-estourada' : ''}`}
                    data-rotulo={formatRotuloGrafico(item.realizado, { simbolo: false, escala: 1000 })}
                    style={{ height: `${item.realizado ? Math.max(5, (item.realizado / maiorOrcamento) * 100) : 0}%` }}
                    title={`Realizado: ${formatCurrency(item.realizado)}`}
                  />
                  <span
                    className="barra barra-saldo"
                    data-rotulo={formatRotuloGrafico(item.saldo, { simbolo: false, escala: 1000 })}
                    style={{ height: `${item.saldo ? Math.max(5, (item.saldo / maiorOrcamento) * 100) : 0}%` }}
                    title={`Saldo disponível: ${formatCurrency(item.saldo)}`}
                  />
                </div>
                <strong>{item.nome}</strong>
              </button>
              )
            })}
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
        return item ? (
          <OrcamentoModal
            mes={item.mes}
            ano={anoOrcamento}
            orcado={item.orcado}
            despesas={item.gastos}
            resumoCobrancas={item.resumoCobrancas}
            orcamentosDoAno={orcamentos.filter((o) => Number(o.ano) === anoOrcamento)}
            aprovacoes={aprovacoes}
            onFechar={() => setMesOrcamentoDetalhado(null)}
          />
        ) : null
      })()}

      {aprovadoresOrcamentoAberto && (
        <AprovadoresOrcamentoModal
          ano={anoOrcamento}
          aprovacoes={aprovacoes}
          onFechar={() => setAprovadoresOrcamentoAberto(false)}
        />
      )}

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
