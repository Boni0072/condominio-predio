import React, { useState, useRef } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatDate, getMonthKey } from '../../utils/storage.js'

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

const TIPOS = [
  { id: 'material', label: 'Material' },
  { id: 'servico', label: 'Serviço' }
]

const TIPOS_COMPROVANTE = [
  { id: 'nota', label: 'Nota fiscal' },
  { id: 'recibo', label: 'Recibo' },
  { id: 'cupom', label: 'Cupom fiscal' }
]

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

function DespesaForm({ editando, onConcluir }) {
  const { registrarDespesa, atualizarDespesa } = useApp()
  const [form, setForm] = useState(editando || {
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
  })
  const [erro, setErro] = useState('')
  const [processando, setProcessando] = useState(false)
  const inputRef = useRef(null)

  function handleChange(e) {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
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
    } else {
      registrarDespesa(dados)
    }
    onConcluir()
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
                <input type="file" accept="image/*" onChange={(e) => handleComprovante(e, campo)} />
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
          <input type="file" accept="image/*" onChange={(e) => handleComprovante(e, 'comprovantePagamento')} />
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
  const { removerDespesa } = useApp()
  const cat = CATEGORIAS.find((c) => c.id === despesa.categoria) || CATEGORIAS[CATEGORIAS.length - 1]

  return (
    <div className="despesa-item">
      <div className="despesa-icon">{cat.icon}</div>
      <div className="despesa-info">
        <div className="despesa-header">
          <strong>{despesa.descricao}</strong>
          <span className="despesa-valor">R$ {despesa.valor.toFixed(2).replace('.', ',')}</span>
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
  const [busca, setBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState('')
  const [periodoMes, setPeriodoMes] = useState('')
  const somenteLeitura = userProfile?.role === 'morador'

  const despesasFiltradas = despesas
    .filter((d) => {
      if (busca && !d.descricao.toLowerCase().includes(busca.toLowerCase()) && !d.fornecedor?.toLowerCase().includes(busca.toLowerCase())) return false
      if (filtroCategoria && d.categoria !== filtroCategoria) return false
      if (periodoMes && getMonthKey(d.data || d.criadoEm) !== periodoMes) return false
      return true
    })
    .sort((a, b) => new Date(b.data || b.criadoEm) - new Date(a.data || a.criadoEm))

  const total = despesasFiltradas.reduce((acc, d) => acc + d.valor, 0)

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
          {periodoMes && (
            <button type="button" className="btn btn-compact btn-ghost" onClick={() => setPeriodoMes('')}>
              Todo o período
            </button>
          )}
        </div>
      </div>

      {!somenteLeitura && !editando && <DespesaForm editando={null} onConcluir={() => setEditando(null)} />}

      <div className="card">
        <div className="despesas-resumo">
          <span>{despesasFiltradas.length} despesa(s)</span>
          <strong>Total: R$ {total.toFixed(2).replace('.', ',')}</strong>
        </div>
        {despesasFiltradas.length === 0 ? (
          <p className="empty">Nenhuma despesa encontrada.</p>
        ) : (
          <div className="despesas-lista">
            {despesasFiltradas.map((d) => (
              <DespesaItem key={d.id} despesa={d} onEditar={setEditando} somenteLeitura={somenteLeitura} />
            ))}
          </div>
        )}
      </div>

      {!somenteLeitura && editando && <DespesaForm editando={editando} onConcluir={() => setEditando(null)} />}
    </div>
  )
}