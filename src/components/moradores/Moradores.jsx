import React, { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { formatDate } from '../../utils/storage.js'
import {
  digitosTelefone,
  formatarWhatsApp,
  normalizarWhatsApp,
  whatsappUrl
} from '../../utils/whatsapp.js'

const TIPOS = {
  proprietario: 'Proprietário(a)',
  locatario: 'Locatário(a)'
}

const FORM_VAZIO = { nome: '', unidade: '', whatsapp: '', email: '', tipo: 'proprietario' }

function iniciais(nome) {
  return String(nome || '')
    .trim()
    .split(/\s+/)
    .map((parte) => parte[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function MoradorForm({ editando, onConcluir }) {
  const { cadastrarMorador, atualizarMorador } = useApp()
  const [form, setForm] = useState(FORM_VAZIO)
  const [erro, setErro] = useState('')

  useEffect(() => {
    setForm(
      editando
        ? {
            nome: editando.nome || '',
            unidade: editando.unidade || '',
            whatsapp: editando.whatsapp || '',
            email: editando.email || '',
            tipo: editando.tipo || 'proprietario'
          }
        : FORM_VAZIO
    )
    setErro('')
  }, [editando])

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
    setErro('')
  }

  function onSubmit(e) {
    e.preventDefault()
    const nome = form.nome.trim()
    const unidade = form.unidade.trim()
    const whatsapp = digitosTelefone(form.whatsapp)

    if (!nome || !unidade) {
      setErro('Informe o nome e a unidade do morador.')
      return
    }
    if (!normalizarWhatsApp(whatsapp)) {
      setErro('WhatsApp inválido. Use DDD + número, ex.: (11) 98765-4321.')
      return
    }

    const dados = { nome, unidade, whatsapp, email: form.email.trim(), tipo: form.tipo }

    if (editando) {
      atualizarMorador(editando.id, dados)
    } else {
      cadastrarMorador(dados)
    }
    onConcluir()
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="m-nome">Nome do morador</label>
        <input
          id="m-nome"
          value={form.nome}
          onChange={(e) => set('nome', e.target.value)}
          placeholder="Ex.: Maria Souza"
          required
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="m-unidade">Unidade</label>
          <input
            id="m-unidade"
            value={form.unidade}
            onChange={(e) => set('unidade', e.target.value)}
            placeholder="Bloco A, apto 12"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="m-tipo">Vínculo</label>
          <select id="m-tipo" value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
            {Object.entries(TIPOS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="m-whatsapp">WhatsApp</label>
          <input
            id="m-whatsapp"
            type="tel"
            value={form.whatsapp}
            onChange={(e) => set('whatsapp', e.target.value)}
            placeholder="(11) 98765-4321"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="m-email">E-mail (opcional)</label>
          <input
            id="m-email"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="maria@email.com"
          />
        </div>
      </div>

      {erro && <p className="form-erro">{erro}</p>}

      <div className="form-actions">
        <button type="submit" className="btn btn-brass">
          {editando ? 'Salvar alterações' : 'Cadastrar morador'}
        </button>
        {editando && (
          <button type="button" className="btn btn-ghost" onClick={onConcluir}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  )
}


function MoradorItem({ morador, onEditar }) {
  const { removerMorador } = useApp()
  const url = whatsappUrl(morador.whatsapp, `Olá, ${morador.nome}! Aqui é da portaria do condomínio.`)

  return (
    <div className="log-item">
      <div className="log-tag">{iniciais(morador.nome)}</div>
      <div className="log-main">
        <div className="log-name">{morador.nome}</div>
        <div className="log-meta">
          <span>{morador.unidade}</span>
          <span className={`badge ${morador.tipo === 'locatario' ? 'badge-blue' : 'badge-green'}`}>
            {TIPOS[morador.tipo] || TIPOS.proprietario}
          </span>
          {morador.email && <span>· {morador.email}</span>}
          <span>· WhatsApp {formatarWhatsApp(morador.whatsapp)}</span>
          <span>· cadastrado {formatDate(morador.criadoEm)}</span>
        </div>
      </div>
      <div className="log-actions">
        {url ? (
          <a
            className="btn btn-whatsapp btn-small"
            href={url}
            target="_blank"
            rel="noreferrer"
            title="Abrir conversa no WhatsApp"
          >
            WhatsApp
          </a>
        ) : (
          <span className="badge badge-brick">WhatsApp inválido</span>
        )}
        <button className="btn btn-ghost btn-small" onClick={() => onEditar(morador)}>
          Editar
        </button>
        <button className="btn btn-ghost btn-small" onClick={() => removerMorador(morador.id)}>
          Remover
        </button>
      </div>
    </div>
  )
}


export default function Moradores() {
  const { moradores } = useApp()
  const [editandoId, setEditandoId] = useState(null)
  const [busca, setBusca] = useState('')

  const editando = editandoId ? moradores.find((m) => m.id === editandoId) || null : null

  const lista = [...moradores]
    .filter((m) => {
      const termo = busca.trim().toLowerCase()
      if (!termo) return true
      return (
        String(m.nome || '').toLowerCase().includes(termo) ||
        String(m.unidade || '').toLowerCase().includes(termo)
      )
    })
    .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'))

  const unidades = new Set(moradores.map((m) => String(m.unidade || '').trim().toLowerCase())).size

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Moradores</h1>
          <p className="sub">
            {moradores.length} morador{moradores.length !== 1 ? 'es' : ''} cadastrado
            {moradores.length !== 1 ? 's' : ''} em {unidades} unidade{unidades !== 1 ? 's' : ''} ·
            contato rápido pelo WhatsApp
          </p>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h2>{editando ? 'Editar morador' : 'Cadastrar morador'}</h2>
          </div>
          <div className="panel-body">
            <MoradorForm editando={editando} onConcluir={() => setEditandoId(null)} />
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2>Moradores cadastrados</h2>
          </div>
          <div className="list-toolbar">
            <input
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome ou unidade..."
              aria-label="Buscar morador"
            />
          </div>
          {lista.length === 0 ? (
            <div className="empty-state">
              {moradores.length === 0
                ? 'Nenhum morador cadastrado ainda.'
                : 'Nenhum morador encontrado para essa busca.'}
            </div>
          ) : (
            <div>
              {lista.map((m) => (
                <MoradorItem
                  key={m.id}
                  morador={m}
                  onEditar={(morador) => setEditandoId(morador.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
