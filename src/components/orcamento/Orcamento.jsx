import React, { useMemo, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatCurrency, getMonthKey } from '../../utils/storage.js'

const CATEGORIAS = [
  { id: 'manutencao', label: 'Manutenção' },
  { id: 'limpeza', label: 'Limpeza' },
  { id: 'seguranca', label: 'Segurança' },
  { id: 'agua', label: 'Água' },
  { id: 'luz', label: 'Energia' },
  { id: 'gas', label: 'Gás' },
  { id: 'jardinagem', label: 'Jardinagem' },
  { id: 'piscina', label: 'Piscina' },
  { id: 'elevador', label: 'Elevador' },
  { id: 'outros', label: 'Outros' }
]

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

function dinheiro(valor) {
  return formatCurrency(Number(valor) || 0)
}

export function OrcamentoModal({ mes, ano, orcado, despesas, onFechar }) {
  const realizado = despesas.reduce((total, despesa) => total + (Number(despesa.valor) || 0), 0)
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
            <p className="sub">Detalhamento do realizado no período</p>
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
                  {categoria.itens.map((despesa) => (
                    <div className="orcamento-gasto" key={despesa.id}>
                      <span>{despesa.descricao}</span>
                      <small>{despesa.fornecedor || 'Sem fornecedor'} · {despesa.data}</small>
                      <strong>{dinheiro(despesa.valor)}</strong>
                    </div>
                  ))}
                </section>
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

export default function Orcamento() {
  const { userProfile } = useAuth()
  const { despesas, orcamentos, salvarOrcamento, removerOrcamento } = useApp()
  const anoAtual = new Date().getFullYear()
  const [ano, setAno] = useState(anoAtual)
  const [form, setForm] = useState({ mes: new Date().getMonth() + 1, categoria: 'manutencao', valor: '' })
  const [mesDetalhado, setMesDetalhado] = useState(null)
  const [formAberto, setFormAberto] = useState(false)

  const orcamentosDoAno = orcamentos.filter((item) => Number(item.ano) === Number(ano))
  const meses = useMemo(() => MESES.map((nome, indice) => {
    const mes = indice + 1
    const chave = `${ano}-${String(mes).padStart(2, '0')}`
    const itensOrcados = orcamentosDoAno.filter((item) => Number(item.mes) === mes)
    const gastos = despesas.filter((despesa) => getMonthKey(despesa.data || despesa.criadoEm) === chave)
    return {
      mes,
      nome,
      orcado: itensOrcados.reduce((total, item) => total + (Number(item.valor) || 0), 0),
      realizado: gastos.reduce((total, item) => total + (Number(item.valor) || 0), 0),
      gastos
    }
  }), [ano, orcamentosDoAno, despesas])
  const maiorValor = Math.max(1, ...meses.flatMap((item) => [item.orcado, item.realizado]))
  const mesSelecionado = meses.find((item) => item.mes === mesDetalhado)

  function handleSubmit(e) {
    e.preventDefault()
    const valor = Number(form.valor)
    if (!valor || valor <= 0) return
    salvarOrcamento({ ano: Number(ano), mes: Number(form.mes), categoria: form.categoria, valor })
    setForm((atual) => ({ ...atual, valor: '' }))
  }

  if (!['sindico', 'zelador'].includes(userProfile?.role)) {
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
          <span>Ano</span>
          <input type="number" min="2020" max="2100" value={ano} onChange={(e) => setAno(Number(e.target.value) || anoAtual)} />
        </label>
      </div>

      <div className="orcamento-layout">
        <div className="card orcamento-form">
          <div className="panel-header">
            <h3>Definir orçamento</h3>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setFormAberto(!formAberto)} aria-expanded={formAberto}>
              {formAberto ? 'Recolher' : 'Expandir'}
            </button>
          </div>
          {formAberto && (
            <form onSubmit={handleSubmit}>
              <p className="field-help">O mesmo mês e categoria atualizam o valor já cadastrado.</p>
              <div className="field">
                <label htmlFor="orcamento-mes">Mês</label>
                <select id="orcamento-mes" value={form.mes} onChange={(e) => setForm({ ...form, mes: Number(e.target.value) })}>
                  {MESES.map((mes, indice) => <option key={mes} value={indice + 1}>{mes}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="orcamento-categoria">Categoria</label>
                <select id="orcamento-categoria" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })}>
                  {CATEGORIAS.map((categoria) => <option key={categoria.id} value={categoria.id}>{categoria.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="orcamento-valor">Valor previsto (R$)</label>
                <input id="orcamento-valor" type="number" min="0.01" step="0.01" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} placeholder="0,00" required />
              </div>
              <button type="submit" className="btn btn-brass btn-block">Salvar orçamento</button>
            </form>
          )}
        </div>

        {formAberto && (
          <div className="card orcamento-lista-configurada">
            <div className="panel-header">
              <div><h3>Valores configurados</h3><p className="field-help">{orcamentosDoAno.length} item(ns) em {ano}</p></div>
            </div>
            {orcamentosDoAno.length === 0 ? <p className="empty-state">Nenhum orçamento definido para este ano.</p> : (
              <div className="orcamento-itens">
                {orcamentosDoAno.sort((a, b) => a.mes - b.mes).map((item) => (
                  <div className="orcamento-item" key={item.id}>
                    <div><strong>{MESES[item.mes - 1]}</strong><span>{CATEGORIAS.find((categoria) => categoria.id === item.categoria)?.label || item.categoria}</span></div>
                    <strong>{dinheiro(item.valor)}</strong>
                    <button type="button" className="btn btn-small btn-danger" onClick={() => removerOrcamento(item.id)}>Remover</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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

      {mesSelecionado && <OrcamentoModal mes={mesSelecionado.mes} ano={ano} orcado={mesSelecionado.orcado} despesas={mesSelecionado.gastos} onFechar={() => setMesDetalhado(null)} />}
    </div>
  )
}
