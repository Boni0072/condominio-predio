import React, { useState, useRef } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatDate, getMonthKey } from '../../utils/storage.js'
import { somaAprovacoesMes, aprovacoesDoMes } from '../orcamento/orcamentoUtils.js'
import { veTodosOsRegistros } from '../../utils/permissoes.js'

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
  { id: 'folha_pagamento', label: 'Folha de Pagamento', icon: '💼' },
  { id: 'outros', label: 'Outros', icon: '📦' }
]

const TIPOS = [
  { id: 'material', label: 'Material' },
  { id: 'servico', label: 'Serviço' }
]

const TIPOS_COMPROVANTE = [
  { id: 'nota', label: 'Nota fiscal' },
  { id: 'recibo', label: 'Recibo' },
  { id: 'cupom', label: 'Cupom fiscal' }
]

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

// Rótulo da separação por mês da lista de despesas ("2026-09" → "Setembro de 2026").
function rotuloMes(chave) {
  if (!chave || chave === 'sem-data') return 'Sem data'
  const [ano, mes] = String(chave).split('-').map(Number)
  if (!ano || !mes) return 'Sem data'
  return `${NOMES_MESES[mes - 1] || mes} de ${ano}`
}

function arquivoParaDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const maxW = 800
        const maxH = 800
        let w = img.width
        let h = img.height
        if (w > maxW) { h = (h * maxW) / w; w = maxW }
        if (h > maxH) { w = (w * maxH) / h; h = maxH }
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Estado inicial do formulário de nova despesa (função para permitir limpar
// o formulário depois de registrar — data sempre "hoje" no momento do reset).
function formVazio() {
  return {
    descricao: '',
    valor: '',
    categoria: 'manutencao',
    tipo: 'servico',
    data: new Date().toISOString().split('T')[0],
    fornecedor: '',
    comprovante: '',
    comprovanteTipo: 'nota',
    comprovantePagamento: '',
    comprovantePagamentoTipo: 'nota',
    comprovanteAntes: '',
    comprovanteDepois: '',
    observacoes: ''
  }
}

function DespesaForm({ editando, onConcluir }) {
  const { registrarDespesa, atualizarDespesa, orcamentos } = useApp()
  const [form, setForm] = useState(editando || formVazio())
  const [erro, setErro] = useState('')
  const [processando, setProcessando] = useState(false)
  const [itemOrcamento, setItemOrcamento] = useState('')
  // Incrementado após cada registro para remontar os <input type="file"> e
  // limpar também o nome do arquivo escolhido (eles são não controlados).
  const [tickArquivos, setTickArquivos] = useState(0)
  const inputRef = useRef(null)

  function handleChange(e) {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    if (name === 'categoria') setItemOrcamento('')
  }

  const itensOrcamento = orcamentos
    .filter((orcamento) => orcamento.categoria === form.categoria && Array.isArray(orcamento.itens))
    .flatMap((orcamento) => (orcamento.itens || []).map((item, indice) => ({
      ...item,
      key: `${orcamento.id}:${item.id || indice}`,
      referencia: `${String(orcamento.mes).padStart(2, '0')}/${orcamento.ano}`
    })))

  function selecionarItemOrcamento(selecionado) {
    setItemOrcamento(selecionado)
    if (!selecionado) return
    const item = itensOrcamento.find((i) => i.key === selecionado)
    if (!item) return
    setForm((f) => ({
      ...f,
      descricao: item.descricao,
      valor: Number(item.valor) > 0 ? String(item.valor) : f.valor
    }))
  }

  async function handleComprovante(e, campo) {
    const file = e.target.files[0]
    if (!file) return
    setProcessando(true)
    try {
      const dataUrl = await arquivoParaDataUrl(file)
      setForm((f) => ({ ...f, [campo]: dataUrl }))
    } catch {
      setErro('Erro ao processar o comprovante.')
    }
    setProcessando(false)
  }

  function removerComprovante(campo) {
    setForm((f) => ({ ...f, [campo]: '' }))
    if (inputRef.current) inputRef.current.value = ''
  }

  function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    if (!form.descricao.trim()) return setErro('Informe a descrição.')
    if (!form.valor || parseFloat(form.valor) <= 0) return setErro('Informe um valor válido.')
    if (!form.data) return setErro('Informe a data.')

    const dados = {
      ...form,
      valor: parseFloat(form.valor),
      descricao: form.descricao.trim(),
      fornecedor: form.fornecedor.trim(),
      observacoes: form.observacoes.trim()
    }

    if (editando) {
      atualizarDespesa(editando.id, dados)
      onConcluir()
      return
    }
    registrarDespesa(dados)
    // Nova despesa registrada: limpa o formulário para a próxima entrada
    // (campos, item do orçamento, fotos/comprovantes e erro anterior).
    setForm(formVazio())
    setItemOrcamento('')
    setErro('')
    setTickArquivos((tick) => tick + 1)
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <h3>{editando ? 'Editar despesa' : 'Nova despesa'}</h3>
      {erro && <div className="form-erro">{erro}</div>}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="descricao">Descrição *</label>
          <input id="descricao" name="descricao" value={form.descricao} onChange={handleChange} placeholder="Ex.: Reparo do portão" />
        </div>
        <div className="field">
          <label htmlFor="valor">Valor (R$) *</label>
          <input id="valor" name="valor" type="number" step="0.01" min="0" value={form.valor} onChange={handleChange} placeholder="0,00" />
        </div>
        <div className="field">
          <label htmlFor="categoria">Categoria</label>
          <select id="categoria" name="categoria" value={form.categoria} onChange={handleChange}>
            {CATEGORIAS.map((c) => (<option key={c.id} value={c.id}>{c.icon} {c.label}</option>))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="item-orcamento">Item do orçamento</label>
          <select id="item-orcamento" value={itemOrcamento} onChange={(e) => selecionarItemOrcamento(e.target.value)}>
            <option value="">— Selecionar item do orçamento —</option>
            {itensOrcamento.length === 0 && <option disabled>Sem itens previstos para esta categoria</option>}
            {itensOrcamento.map((item) => (
              <option key={item.key} value={item.key}>
                {item.referencia} · {item.descricao}{Number(item.valor) > 0 ? ` (R$ ${Number(item.valor).toFixed(2).replace('.', ',')})` : ''}
              </option>
            ))}
          </select>
          <p className="field-help">Itens previstos no orçamento desta categoria. Selecionar preenche a descrição e o valor estimado.</p>
        </div>
        <div className="field">
          <label htmlFor="tipo">Tipo</label>
          <select id="tipo" name="tipo" value={form.tipo} onChange={handleChange}>
            {TIPOS.map((t) => (<option key={t.id} value={t.id}>{t.label}</option>))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="data">Data *</label>
          <input id="data" name="data" type="date" value={form.data} onChange={handleChange} />
        </div>
        <div className="field">
          <label htmlFor="fornecedor">Fornecedor</label>
          <input id="fornecedor" name="fornecedor" value={form.fornecedor} onChange={handleChange} placeholder="Nome do fornecedor" />
        </div>
      </div>
      <div className="field">
        <label>{form.categoria === 'manutencao' ? 'Fotos da manutenção' : 'Comprovante (foto)'}</label>
        {form.categoria === 'manutencao' && (
          <div className="comprovantes-duplos">
            {[{ campo: 'comprovanteAntes', label: 'Antes' }, { campo: 'comprovanteDepois', label: 'Depois' }].map(({ campo, label }) => (
              <div className="comprovante-etapa" key={campo}>
                <span className="field-help">Foto {label}</span>
                <input key={`${campo}-${tickArquivos}`} type="file" accept="image/*" onChange={(e) => handleComprovante(e, campo)} />
                {processando && <span className="foto-status">Processando...</span>}
                {form[campo] && !processando && (
                  <div className="comprovante-preview">
                    <img src={form[campo]} alt={`Manutenção ${label.toLowerCase()}`} className="comprovante-thumb" />
                    <button type="button" className="btn btn-small btn-danger" onClick={() => removerComprovante(campo)}>Remover</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="comprovante-pagamento">
          <span className="field-help">Comprovante de pagamento</span>
          <select value={form.comprovantePagamentoTipo || form.comprovanteTipo || 'nota'} onChange={(e) => setForm((f) => ({ ...f, comprovantePagamentoTipo: e.target.value }))}>
            {TIPOS_COMPROVANTE.map((tipo) => <option key={tipo.id} value={tipo.id}>{tipo.label}</option>)}
          </select>
          <input key={`pagamento-${tickArquivos}`} type="file" accept="image/*" onChange={(e) => handleComprovante(e, 'comprovantePagamento')} />
          {processando && <span className="foto-status">Processando...</span>}
          {(form.comprovantePagamento || form.comprovante) && !processando && (
            <div className="comprovante-preview">
              <img src={form.comprovantePagamento || form.comprovante} alt="Comprovante de pagamento" className="comprovante-thumb" />
              <button type="button" className="btn btn-small btn-danger" onClick={() => removerComprovante('comprovantePagamento')}>Remover</button>
            </div>
          )}
        </div>
      </div>
      <div className="field">
        <label htmlFor="observacoes">Observações</label>
        <textarea id="observacoes" name="observacoes" value={form.observacoes} onChange={handleChange} rows={2} placeholder="Detalhes adicionais..." />
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-brass" disabled={processando}>
          {editando ? 'Salvar' : 'Registrar'}
        </button>
        {editando && <button type="button" className="btn btn-ghost" onClick={onConcluir}>Cancelar</button>}
      </div>
    </form>
  )
}

function DespesaItem({ despesa, onEditar, somenteLeitura }) {
  const { removerDespesa, orcamentos, aprovacoes } = useApp()
  const cat = CATEGORIAS.find((c) => c.id === despesa.categoria) || CATEGORIAS[CATEGORIAS.length - 1]
  const orcamentoCategoria = orcamentos.find((o) => (
    o.categoria === despesa.categoria && `${o.ano}-${String(o.mes).padStart(2, '0')}` === getMonthKey(despesa.data || despesa.criadoEm)
  ))
  const orcado = orcamentoCategoria ? somaAprovacoesMes([orcamentoCategoria], aprovacoesDoMes(aprovacoes, orcamentoCategoria.ano, orcamentoCategoria.mes)) : 0
  const acimaDoOrcamento = (Number(despesa.valor) || 0) > orcado
  const rotuloSituacao = `${acimaDoOrcamento ? 'Acima' : 'Abaixo'} do orçamento de ${cat.label} (${orcado.toFixed(2).replace('.', ',')})`

  return (
    <div className="despesa-item">
      <div className="despesa-icon">{cat.icon}</div>
      <div className="despesa-info">
        <div className="despesa-header">
          <strong>{despesa.descricao}</strong>
          <span className="despesa-valor">
            {orcado > 0 && (
              <span
                className={`despesa-seta${acimaDoOrcamento ? ' acima' : ' abaixo'}`}
                role="img"
                aria-label={rotuloSituacao}
                title={rotuloSituacao}
              >
                {acimaDoOrcamento ? '▼' : '▲'}
              </span>
            )}
            R$ {despesa.valor.toFixed(2).replace('.', ',')}
          </span>
        </div>
        <div className="despesa-meta">
          <span className="badge badge-cat">{cat.label}</span>
          <span className="badge">{despesa.tipo === 'material' ? 'Material' : 'Serviço'}</span>
          <span>{formatDate(despesa.data)}</span>
          {despesa.fornecedor && <span>· {despesa.fornecedor}</span>}
        </div>
        {despesa.observacoes && <p className="despesa-obs">{despesa.observacoes}</p>}
        {(despesa.comprovanteAntes || despesa.comprovanteDepois || despesa.comprovante) && (
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
        )}
      </div>
      {!somenteLeitura && <div className="despesa-actions">
        <button className="btn btn-small btn-ghost" onClick={() => onEditar(despesa)}>Editar</button>
        <button className="btn btn-small btn-danger" onClick={() => removerDespesa(despesa.id)}>Remover</button>
      </div>}
    </div>
  )
}

export default function Despesas() {
  const { userProfile } = useAuth()
  const { despesas } = useApp()
  const [editando, setEditando] = useState(null)
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [periodoMes, setPeriodoMes] = useState('')
  // Separação por mês + grupos de categoria da lista "N despesa(s)":
  // tudo inicia RECOLHIDO.
  const [mesesExpandidos, setMesesExpandidos] = useState(() => new Set())
  const [categoriasExpandidas, setCategoriasExpandidas] = useState(() => new Set())
  const somenteLeitura = userProfile?.role === 'morador'
  // Agrupamento por mês (+ categorias) é só para os gestores (síndico, zelador
  // e portaria). Morador e conselheiro veem a lista simples, sem recolher/
  // expandir por mês — mesma regra de privacidade de utils/permissoes.js.
  const agruparPorMes = veTodosOsRegistros(userProfile)

  const despesasFiltradas = despesas
    .filter((d) => {
      if (busca && !d.descricao.toLowerCase().includes(busca.toLowerCase()) && !d.fornecedor?.toLowerCase().includes(busca.toLowerCase())) return false
      if (filtroCategoria && d.categoria !== filtroCategoria) return false
      if (periodoMes && getMonthKey(d.data || d.criadoEm) !== periodoMes) return false
      return true
    })
    .sort((a, b) => new Date(b.data || b.criadoEm) - new Date(a.data || a.criadoEm))

  const total = despesasFiltradas.reduce((acc, d) => acc + d.valor, 0)

  // Separação por mês: mês (mais recente primeiro) → categorias → despesas.
  // Despesas com categoria desconhecida caem em "outros" (mesma regra do
  // DespesaItem); sem data válida entram no grupo "sem-data".
  const gruposPorMes = (() => {
    if (!agruparPorMes) return []
    const mapa = new Map()
    despesasFiltradas.forEach((despesa) => {
      const chaveMes = getMonthKey(despesa.data || despesa.criadoEm) || 'sem-data'
      if (!mapa.has(chaveMes)) mapa.set(chaveMes, { chave: chaveMes, categorias: new Map(), totalMes: 0 })
      const mes = mapa.get(chaveMes)
      mes.totalMes += Number(despesa.valor) || 0
      const categoria = CATEGORIAS.find((c) => c.id === despesa.categoria) || CATEGORIAS[CATEGORIAS.length - 1]
      if (!mes.categorias.has(categoria.id)) mes.categorias.set(categoria.id, { ...categoria, itens: [], totalGrupo: 0 })
      const grupo = mes.categorias.get(categoria.id)
      grupo.itens.push(despesa)
      grupo.totalGrupo += Number(despesa.valor) || 0
    })
    return [...mapa.values()]
      .sort((a, b) => {
        if (a.chave === 'sem-data') return 1
        if (b.chave === 'sem-data') return -1
        return String(b.chave).localeCompare(String(a.chave))
      })
      .map((mes) => ({
        chave: mes.chave,
        rotulo: rotuloMes(mes.chave),
        totalMes: mes.totalMes,
        // Mantém a ordem canônica das categorias, ignorando as sem despesa.
        grupos: CATEGORIAS.filter((categoria) => mes.categorias.has(categoria.id)).map((categoria) => mes.categorias.get(categoria.id))
      }))
  })()

  const mesAberto = (chave) => mesesExpandidos.has(chave)
  function alternarMes(chave) {
    setMesesExpandidos((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return proximo
    })
  }

  // Chave única da categoria dentro do mês (ex.: "2026-09:limpeza").
  const chaveCategoria = (mes, categoriaId) => `${mes}:${categoriaId}`
  const categoriaAberta = (mes, categoriaId) => categoriasExpandidas.has(chaveCategoria(mes, categoriaId))
  function alternarCategoria(mes, categoriaId) {
    const chave = chaveCategoria(mes, categoriaId)
    setCategoriasExpandidas((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return proximo
    })
  }

  const todasAbertas = gruposPorMes.length > 0
    && gruposPorMes.every((mes) => mesAberto(mes.chave) && mes.grupos.every((grupo) => categoriaAberta(mes.chave, grupo.id)))
  function alternarTodas() {
    if (todasAbertas) {
      setMesesExpandidos(new Set())
      setCategoriasExpandidas(new Set())
      return
    }
    setMesesExpandidos(new Set(gruposPorMes.map((mes) => mes.chave)))
    setCategoriasExpandidas(new Set(
      gruposPorMes.flatMap((mes) => mes.grupos.map((grupo) => chaveCategoria(mes.chave, grupo.id)))
    ))
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Despesas</h2>
          <p className="sub">Controle de materiais e serviços pagos pelo condomínio.</p>
        </div>
        <div className="filtro-cabecalho">
          <input
            type="text"
            placeholder="Buscar..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="input-busca filtro-busca-cabecalho"
          />
          <select value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} className="select-filtro">
            <option value="">Todas categorias</option>
            {CATEGORIAS.map((c) => (<option key={c.id} value={c.id}>{c.icon} {c.label}</option>))}
          </select>
          <label className="filtro-periodo">
            <span>Mês</span>
            <input type="month" value={periodoMes} onChange={(e) => setPeriodoMes(e.target.value)} />
          </label>
        </div>
      </div>

      {!somenteLeitura && !editando && (
        <div className="panel">
          <div className="panel-header">
            <h2>Nova despesa</h2>
            <button
              type="button"
              className="btn btn-ghost btn-small panel-toggle"
              onClick={() => setFormularioAberto((v) => !v)}
              aria-expanded={formularioAberto}
            >
              {formularioAberto ? '▾ Recolher' : '▸ Expandir'}
            </button>
          </div>
          {formularioAberto && (
            <div className="panel-body">
              <DespesaForm editando={null} onConcluir={() => setEditando(null)} />
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="despesas-resumo">
          <span>{despesasFiltradas.length} despesa(s)</span>
          <strong>Total: R$ {total.toFixed(2).replace('.', ',')}</strong>
        </div>
        {despesasFiltradas.length === 0 ? (
          <p className="empty">Nenhuma despesa encontrada.</p>
        ) : !agruparPorMes ? (
          // Morador e conselheiro: lista simples, sem agrupamento por mês.
          <>
            <div className="despesas-acoes">
              <span className="field-help">
                {despesasFiltradas.length} despesa(s) · lista simples
              </span>
            </div>
            <div className="despesas-lista">
              {despesasFiltradas.map((d) => (
                <DespesaItem key={d.id} despesa={d} onEditar={setEditando} somenteLeitura={somenteLeitura} />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="despesas-acoes">
              <span className="field-help">{gruposPorMes.length} mês(es) · iniciam recolhidos</span>
              <button type="button" className="btn btn-ghost btn-small" onClick={alternarTodas} aria-expanded={todasAbertas}>
                {todasAbertas ? 'Recolher tudo' : 'Expandir tudo'}
              </button>
            </div>
            <div className="despesas-lista">
              {gruposPorMes.map((mes) => {
                const aberto = mesAberto(mes.chave)
                return (
                  <section key={mes.chave} className={`despesa-mes${aberto ? ' aberta' : ''}`}>
                    <button
                      type="button"
                      className="despesa-mes-cabecalho"
                      onClick={() => alternarMes(mes.chave)}
                      aria-expanded={aberto}
                      aria-label={`${aberto ? 'Recolher' : 'Expandir'} despesas de ${mes.rotulo}`}
                    >
                      <span className="despesa-grupo-nome">
                        <strong>{aberto ? '▾' : '▸'} {mes.rotulo}</strong>
                        <small>{mes.grupos.reduce((acc, grupo) => acc + grupo.itens.length, 0)} despesa(s)</small>
                      </span>
                      <span className="despesa-grupo-valor">
                        R$ {mes.totalMes.toFixed(2).replace('.', ',')}
                      </span>
                    </button>
                    {aberto && (
                      <div className="despesa-mes-conteudo">
                        {mes.grupos.map((grupo) => {
                          const aberta = categoriaAberta(mes.chave, grupo.id)
                          return (
                            <section key={grupo.id} className={`despesa-grupo${aberta ? ' aberta' : ''}`}>
                              <button
                                type="button"
                                className="despesa-grupo-cabecalho"
                                onClick={() => alternarCategoria(mes.chave, grupo.id)}
                                aria-expanded={aberta}
                                aria-label={`${aberta ? 'Recolher' : 'Expandir'} despesas de ${grupo.label}`}
                              >
                                <span className="despesa-grupo-nome">
                                  <span className="despesa-icon">{grupo.icon}</span>
                                  <strong>{grupo.label} ({grupo.itens.length})</strong>
                                </span>
                                <span className="despesa-grupo-valor">
                                  R$ {grupo.totalGrupo.toFixed(2).replace('.', ',')}
                                  <i aria-hidden="true">{aberta ? '▾' : '▸'}</i>
                                </span>
                              </button>
                              {aberta && (
                                <div className="despesa-grupo-itens">
                                  {grupo.itens.map((d) => (
                                    <DespesaItem key={d.id} despesa={d} onEditar={setEditando} somenteLeitura={somenteLeitura} />
                                  ))}
                                </div>
                              )}
                            </section>
                          )
                        })}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          </>
        )}
      </div>

      {!somenteLeitura && editando && <DespesaForm editando={editando} onConcluir={() => setEditando(null)} />}
    </div>
  )
}