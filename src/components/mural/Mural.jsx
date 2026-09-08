import React, { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { formatDate } from '../../utils/storage.js'
import AvisoMoradoresWhatsApp from './AvisoMoradoresWhatsApp.jsx'

const CATEGORIAS = {
  geral: { label: 'Aviso geral' },
  manutencao: { label: 'Manutenção' },
  urgente: { label: 'Urgente' },
  evento: { label: 'Evento' }
}

function ComunicadoForm() {
  const { criarComunicado } = useApp()
  const [form, setForm] = useState({ titulo: '', categoria: 'geral', conteudo: '', autor: '', fixado: false })

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  function onSubmit(e) {
    e.preventDefault()
    if (!form.titulo.trim() || !form.conteudo.trim()) return
    criarComunicado({ ...form, autor: form.autor.trim() || 'Administração' })
    setForm({ titulo: '', categoria: 'geral', conteudo: '', autor: '', fixado: false })
  }

  return (
    <form onSubmit={onSubmit}>
      <div className="field">
        <label htmlFor="c-titulo">Título</label>
        <input
          id="c-titulo"
          value={form.titulo}
          onChange={(e) => set('titulo', e.target.value)}
          placeholder="Ex.: Dedetização das áreas comuns"
          required
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="c-categoria">Categoria</label>
          <select id="c-categoria" value={form.categoria} onChange={(e) => set('categoria', e.target.value)}>
            {Object.entries(CATEGORIAS).map(([key, c]) => (
              <option key={key} value={key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="c-autor">Assinatura</label>
          <input
            id="c-autor"
            value={form.autor}
            onChange={(e) => set('autor', e.target.value)}
            placeholder="Síndico, Administração..."
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="c-conteudo">Mensagem</label>
        <textarea
          id="c-conteudo"
          value={form.conteudo}
          onChange={(e) => set('conteudo', e.target.value)}
          placeholder="Escreva o comunicado para os moradores"
          required
        />
      </div>

      <button type="submit" className="btn btn-brass btn-block">
        Publicar no mural
      </button>
      <p className="field-help" style={{ marginTop: 8 }}>
        🔔 Ao publicar, todos os usuários do condomínio recebem <strong>notificação push automática</strong> no
        aparelho. Use o botão “Avisar moradores via WhatsApp” para complementar com WhatsApp.
      </p>
    </form>
  )
}

function ComunicadoCard({ item, canManage, onAvisar }) {
  const { removerComunicado, alternarFixado } = useApp()
  const cat = CATEGORIAS[item.categoria] || CATEGORIAS.geral

  return (
    <div className={`comunicado-card cat-${item.categoria}`}>
      <div className="comunicado-top">
        <h3>{item.titulo}</h3>
        {canManage && (
          <button
            className={'pin-btn' + (item.fixado ? ' pinned' : '')}
            onClick={() => alternarFixado(item.id)}
            title={item.fixado ? 'Desafixar' : 'Fixar no topo'}
          >
            ●
          </button>
        )}
      </div>
      <div className="comunicado-meta">
        <span className={`badge badge-${item.categoria === 'urgente' ? 'brick' : item.categoria === 'evento' ? 'blue' : item.categoria === 'manutencao' ? 'brick' : 'green'}`}>
          {cat.label}
        </span>
        <span>{formatDate(item.criadoEm)}</span>
      </div>
      <p className="comunicado-body">{item.conteudo}</p>
      <div className="comunicado-footer">
        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>— {item.autor}</span>
        <div className="comunicado-acoes">
          <button
            className="btn btn-whatsapp btn-small"
            title="Avisar os moradores via WhatsApp"
            onClick={() => onAvisar?.(item)}
          >
            Avisar no WhatsApp
          </button>
          {canManage && (
            <button className="btn btn-ghost btn-small" onClick={() => removerComunicado(item.id)}>
              Remover
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Mural() {
  const { comunicados } = useApp()
  const { userProfile } = useAuth()
  const canManage = userProfile?.role === 'sindico'
  const [formularioAberto, setFormularioAberto] = useState(false)
  const [painelWhatsAberto, setPainelWhatsAberto] = useState(false)
  const [comunicadoAvisar, setComunicadoAvisar] = useState(null)

  const ordenados = [...comunicados].sort((a, b) => {
    if (a.fixado !== b.fixado) return a.fixado ? -1 : 1
    return new Date(b.criadoEm) - new Date(a.criadoEm)
  })

  function abrirPainelWhats(item) {
    setComunicadoAvisar(item || null)
    setPainelWhatsAberto(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mural de avisos</h1>
          <p className="sub">Comunicados oficiais do condomínio para todos os moradores.</p>
        </div>
      </div>

      {painelWhatsAberto && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <div>
              <h2>Avisar todos os moradores via WhatsApp</h2>
              <p className="field-help">
                Prepara um comunicado do mural (ou mensagem livre) e abre o WhatsApp com o texto pronto e o
                campo para escolher manualmente o destinatário.
              </p>
            </div>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setPainelWhatsAberto(false)}>
              Fechar
            </button>
          </div>
          <AvisoMoradoresWhatsApp
            comunicados={comunicados}
            comunicadoId={comunicadoAvisar?.id || null}
            onEscolherComunicado={(id) => setComunicadoAvisar(comunicados.find((c) => c.id === id) || null)}
          />
        </div>
      )}

      <button type="button" className="btn btn-whatsapp btn-block" onClick={() => setPainelWhatsAberto((v) => !v)}>
        {painelWhatsAberto ? 'Ocultar avisos por WhatsApp' : '📱 Avisar moradores via WhatsApp'}
      </button>

      <div className={canManage ? 'grid-2' : ''}>
        {canManage && (
          <div className="panel">
            <div className="panel-header">
              <h2>Novo comunicado</h2>
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
                <ComunicadoForm />
              </div>
            )}
          </div>
        )}

        <div>
          {ordenados.length === 0 ? (
            <div className="panel">
              <div className="empty-state">Nenhum comunicado publicado ainda.</div>
            </div>
          ) : (
            <div className="mural-grid">
              {ordenados.map((item) => (
                <ComunicadoCard key={item.id} item={item} canManage={canManage} onAvisar={abrirPainelWhats} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
