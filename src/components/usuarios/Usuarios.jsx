import { digitosTelefone, formatarWhatsApp, normalizarWhatsApp } from '../../utils/whatsapp.js'

import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  deleteDoc,
  updateDoc
} from 'firebase/firestore'
import { ACESSOS_POR_PERFIL, PAGINAS_ACESSO } from '../../utils/permissoes.js'
import { REGRAS_FIRESTORE } from '../../firebase/regras.js'

const ROLES = [
  { id: 'sindico', label: 'Síndico / Administração', color: 'badge-brick' },
  { id: 'portaria', label: 'Portaria / Porteiro', color: 'badge-blue' },
  { id: 'zelador', label: 'Zelador', color: 'badge-blue' },
  { id: 'conselheiro', label: 'Conselheiro', color: 'badge-green' }
]

// Perfis que o síndico cadastra em Gestão de usuários. Moradores criam a
// própria conta pelo código do condomínio na tela de login.
const PERFIS_FORM = [
  { id: 'portaria', label: 'Portaria / Porteiro' },
  { id: 'zelador', label: 'Zelador' },
  { id: 'conselheiro', label: 'Conselheiro (aprova orçamentos)' }
]

const STATUS_LABELS = {
  ativo: 'Ativo',
  inativo: 'Inativo'
}

const STATUS_COLORS = {
  ativo: 'badge-green',
  inativo: 'badge'
}

// Converte Timestamp do Firestore ou ISO para data exibível com segurança
function dataExibicao(valor) {
  try {
    if (!valor) return ''
    const d = valor?.toDate ? valor.toDate() : new Date(valor)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return ''
  }
}

// Código sugerido de regras do Firestore para o síndico copiar
function UsuarioForm({ editando, onConcluir, onSalvar }) {
  const { cadastrarUsuario } = useAuth()
  const perfilInicial = editando?.role && ['portaria', 'zelador', 'conselheiro'].includes(editando.role) ? editando.role : 'portaria'
  const [form, setForm] = useState({
    nome: '',
    email: '',
    senha: '',
    role: perfilInicial,
    unidade: '',
    whatsapp: '',
    acessos: [...(ACESSOS_POR_PERFIL[perfilInicial] || ACESSOS_POR_PERFIL.portaria)]
  })
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [aberto, setAberto] = useState(false)

  useEffect(() => {
    if (editando) {
      setAberto(true)
      setForm({
        nome: editando.nome || '',
        email: editando.email || '',
        senha: '',
        role: perfilInicial,
        unidade: editando.unidade || '',
        whatsapp: editando.whatsapp || '',
        acessos: editando.acessos || ACESSOS_POR_PERFIL[editando.role] || ACESSOS_POR_PERFIL.morador
      })
    } else {
      setForm({ nome: '', email: '', senha: '', role: 'portaria', unidade: '', whatsapp: '', acessos: [...ACESSOS_POR_PERFIL.portaria] })
    }
    setErro('')
  }, [editando])

  function handleChange(e) {
    const { name, value } = e.target
    setForm((f) => ({
      ...f,
      [name]: value,
      ...(name === 'role' ? { acessos: [...(ACESSOS_POR_PERFIL[value] || [])] } : {})
    }))
  }

  function alternarAcesso(pagina) {
    setForm((f) => {
      const atuais = Array.isArray(f.acessos) ? f.acessos : []
      return {
        ...f,
        acessos: atuais.includes(pagina)
          ? atuais.filter((item) => item !== pagina)
          : [...atuais, pagina]
      }
    })
  }

  function restaurarAcessosPadrao() {
    setForm((f) => ({ ...f, acessos: [...(ACESSOS_POR_PERFIL[f.role] || [])] }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    if (!form.nome.trim()) return setErro('Nome obrigatório.')
    if (!form.email.includes('@')) return setErro('Email inválido.')
    if (!form.unidade.trim()) return setErro('Informe o bloco e o apartamento.')
    const whatsappLimpo = digitosTelefone(form.whatsapp)
    if (whatsappLimpo && !normalizarWhatsApp(whatsappLimpo)) {
      return setErro('WhatsApp inválido. Use DDD + número, ex.: (11) 98765-4321.')
    }
    if (!editando && form.senha.length < 6) return setErro('Senha mínima 6 caracteres.')
    if (!form.acessos?.length) return setErro('Selecione pelo menos uma página de acesso.')
    setCarregando(true)
    try {
      if (editando) {
        await onSalvar(editando.id, {
          nome: form.nome.trim(),
          role: form.role,
          unidade: form.unidade.trim(),
          whatsapp: whatsappLimpo,
          acessos: form.acessos
        })
        window.alert('Usuário atualizado com sucesso.')
      } else {
        await cadastrarUsuario(form)
        window.alert('Usuário cadastrado! Ele já pode entrar com o email e senha definidos.')
      }
      onConcluir()
      setAberto(false)
      setForm({ nome: '', email: '', senha: '', role: 'portaria', unidade: '', acessos: [...ACESSOS_POR_PERFIL.portaria] })
    } catch (err) {
      setErro(err?.code === 'permission-denied'
        ? 'Sem permissão para cadastrar usuários. Publique as regras do arquivo firestore.rules no Firestore e tente novamente.'
        : (err.message || 'Erro ao cadastrar usuário.'))
    }
    setCarregando(false)
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <button
        type="button"
        className="form-toggle"
        onClick={() => setAberto((atual) => !atual)}
        aria-expanded={aberto}
        aria-controls="form-usuarios"
      >
        <span className="form-toggle-texto">
          <strong>{editando ? 'Editar usuário operacional' : 'Cadastrar zelador ou porteiro'}</strong>
          <span className="form-toggle-ajuda">{aberto ? 'Clique para recolher' : 'Clique para abrir o formulário'}</span>
        </span>
        <span className="form-toggle-seta" aria-hidden="true">{aberto ? '▲' : '▼'}</span>
      </button>
      {aberto && (
        <>
          {erro && <div className="login-erro">{erro}</div>}
          <form id="form-usuarios" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="field">
            <label>Nome *</label>
            <input name="nome" value={form.nome} onChange={handleChange} placeholder="Nome completo" required />
          </div>
          <div className="field">
            <label>Email *</label>
            <input type="email" name="email" value={form.email} onChange={handleChange} placeholder="email@exemplo.com" required disabled={Boolean(editando)} />
          </div>
          {!editando && <div className="field">
            <label>Senha *</label>
            <input type="password" name="senha" value={form.senha} onChange={handleChange} placeholder="Mínimo 6 caracteres" minLength={6} required />
          </div>}
          <div className="field">
            <label>Perfil de acesso</label>
            <select name="role" value={form.role} onChange={handleChange}>
              {PERFIS_FORM.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Bloco e apartamento *</label>
            <input name="unidade" value={form.unidade} onChange={handleChange} placeholder="Ex.: Bloco 2 Apto E10" required />
          </div>
          <div className="field">
            <label>WhatsApp (para notificações)</label>
            <input name="whatsapp" value={form.whatsapp} onChange={handleChange} placeholder="Ex.: (11) 98765-4321" />
          </div>
        </div>
        <fieldset className="acessos-fieldset">
          <legend>Acesso às páginas</legend>
          <p className="field-help">
            {form.role === 'conselheiro'
              ? 'Padrão do Conselheiro: Painel, Orçamento anual, Assembleias, Mural e Configurações. Marque ou desmarque conforme necessário.'
              : 'Selecione quais áreas este usuário poderá visualizar e usar.'}
          </p>
          <div className="acessos-grid">
            {PAGINAS_ACESSO.map((pagina) => (
              <label key={pagina.id} className="acesso-opcao">
                <input
                  type="checkbox"
                  checked={form.acessos?.includes(pagina.id)}
                  onChange={() => alternarAcesso(pagina.id)}
                />
                <span>{pagina.label}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-small" onClick={restaurarAcessosPadrao} style={{ marginTop: 8 }}>
            Restaurar padrão do perfil
          </button>
        </fieldset>
        <button type="submit" className="btn btn-brass btn-block" disabled={carregando}>
          {carregando ? (editando ? 'Salvando...' : 'Cadastrando...') : (editando ? 'Salvar alterações' : 'Cadastrar usuário')}
        </button>
        {editando && (
          <button
            type="button"
            className="btn btn-ghost btn-block"
            onClick={() => { setAberto(false); onConcluir() }}
            disabled={carregando}
          >
            Cancelar
          </button>
        )}
      </form>
        </>
      )}
    </div>
  )
}

export default function Usuarios() {
  const { userProfile, enviarRedefinicaoSenha } = useAuth()
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtroRole, setFiltroRole] = useState('')
  const [editandoId, setEditandoId] = useState(null)
  const [enviandoSenhaId, setEnviandoSenhaId] = useState(null)

  const condominioId = userProfile?.condominioId || userProfile?.uid

  // Listener em tempo real: atualiza a lista automaticamente quando um
  // usuário é cadastrado ou alterado em qualquer dispositivo
  useEffect(() => {
    if (!condominioId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setErro('')
    const q = query(collection(db, 'users'), where('condominioId', '==', condominioId))
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const lista = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setUsuarios(lista)
        setLoading(false)
      },
      (err) => {
        console.error('Erro ao carregar usuários:', err)
        const msg = err?.message || ''
        if (msg.includes('permission')) {
          setErro(
            'Sem permissão para listar os usuários. As regras do Firestore precisam permitir leitura na coleção users. Veja o código abaixo.'
          )
        } else {
          setErro(msg)
        }
        setLoading(false)
      }
    )
    return () => unsub()
  }, [condominioId])

  function statusUsuarios(arr) {
    const counts = { ativo: 0, inativo: 0 }
    arr.forEach((u) => {
      const st = u.status || 'ativo'
      counts[st] = (counts[st] || 0) + 1
    })
    return counts
  }

  const filtrados = usuarios
    .filter((u) => {
      if (busca && !u.nome?.toLowerCase().includes(busca.toLowerCase()) && !u.email?.toLowerCase().includes(busca.toLowerCase())) return false
      if (filtroRole && u.role !== filtroRole) return false
      return true
    })
    .sort((a, b) => String(a.role).localeCompare(String(b.role)))

  const status = statusUsuarios(usuarios)
  const editando = editandoId ? usuarios.find((usuario) => usuario.id === editandoId) || null : null

  async function salvarUsuario(id, dados) {
    try {
      await updateDoc(doc(db, 'users', id), dados)
    } catch (err) {
      setErro(err.message || 'Erro ao editar usuário.')
      throw err
    }
  }

  async function alternarStatus(usuario) {
    const novoStatus = usuario.status === 'inativo' ? 'ativo' : 'inativo'
    try {
      await updateDoc(doc(db, 'users', usuario.id), { status: novoStatus })
    } catch (err) {
      setErro(err.message || 'Erro ao atualizar status.')
    }
  }

  async function removerUsuario(usuario) {
    if (!window.confirm(`Remover "${usuario.nome}" (${usuario.email})?`)) return
    try {
      await deleteDoc(doc(db, 'users', usuario.id))
    } catch (err) {
      setErro(err.message || 'Erro ao remover usuário.')
    }
  }

  async function enviarEmailSenha(usuario) {
    setErro('')
    setEnviandoSenhaId(usuario.id)
    try {
      await enviarRedefinicaoSenha(usuario.email)
      window.alert(`E-mail para redefinir a senha enviado para ${usuario.email}.`)
    } catch (err) {
      setErro(err?.message || 'Não foi possível enviar o e-mail de redefinição.')
    }
    setEnviandoSenhaId(null)
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Gestão de usuários</h2>
          <p className="sub">Cadastre zeladores e porteiros do condomínio.</p>
        </div>
      </div>

      {erro && (
        <>
          <div className="login-erro">{erro}</div>
          {erro.includes('permiss') && (
            <div className="login-ajuda" style={{ marginBottom: 16 }}>
              <strong>Para listar os usuários, publique estas regras no Firestore (Firestore Database → Rules):</strong>
              <pre style={{ background: 'var(--paper)', padding: 10, borderRadius: 6, fontSize: 14.3, overflow: 'auto', marginTop: 8 }}>{REGRAS_FIRESTORE}</pre>
              <p style={{ marginTop: 8, fontSize: 15.6 }}>
                Clique em <strong>Publish</strong> — a lista recarregará automaticamente.
              </p>
            </div>
          )}
        </>
      )}

      <UsuarioForm
        editando={editando}
        onSalvar={salvarUsuario}
        onConcluir={() => setEditandoId(null)}
      />

      <div className="usuarios-resumo">
        <div className="usuarios-kpi">
          <span className="usuarios-kpi-num">{usuarios.length}</span>
          <span className="usuarios-kpi-label">usuários total</span>
        </div>
        <div className="usuarios-kpi">
          <span className="usuarios-kpi-num">{status.ativo || 0}</span>
          <span className="usuarios-kpi-label">ativos</span>
        </div>
        <div className="usuarios-kpi">
          <span className="usuarios-kpi-num">{status.inativo || 0}</span>
          <span className="usuarios-kpi-label">inativos</span>
        </div>
        <div className="usuarios-kpi">
          <span className="usuarios-kpi-num">{filtrados.length}</span>
          <span className="usuarios-kpi-label">filtrados</span>
        </div>
      </div>

      <div className="card">
        <div className="list-toolbar">
          <input
            type="text"
            placeholder="Buscar por nome ou email..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="input-busca"
          />
          <select
            value={filtroRole}
            onChange={(e) => setFiltroRole(e.target.value)}
            className="select-filtro"
          >
            <option value="">Todos os perfis</option>
            {ROLES.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="empty">Carregando usuários...</p>
        ) : filtrados.length === 0 ? (
          <p className="empty">
            Nenhum usuário encontrado para este condomínio.
            {!erro && ' Use o formulário acima para cadastrar o primeiro.'}
          </p>
        ) : (
          <div className="usuarios-lista">
            {filtrados.map((u) => (
              <div key={u.id} className="usuario-row">
                <div className="usuario-info">
                  <strong>{u.nome || (u.email || '').split('@')[0]}</strong>
                  <span className="usuario-email">{u.email || '—'}</span>
                  {u.unidade && <span className="usuario-unidade">{u.unidade}</span>}
                  {u.whatsapp && <span className="usuario-whatsapp">WhatsApp: {formatarWhatsApp(u.whatsapp)}</span>}
                  {dataExibicao(u.criadoEm) && (
                    <span className="usuario-criado">Criado em {dataExibicao(u.criadoEm)}</span>
                  )}
                </div>
                <div className="usuario-badges">
                  <span className={`badge ${STATUS_COLORS[u.status || 'ativo']}`}>{STATUS_LABELS[u.status || 'ativo']}</span>
                  <span className={`badge ${ROLES.find((r) => r.id === u.role)?.color || ''}`}>
                    {ROLES.find((r) => r.id === u.role)?.label || u.role}
                  </span>
                </div>
                <div className="usuario-acoes">
                  <button
                    className="btn btn-small btn-ghost"
                    onClick={() => enviarEmailSenha(u)}
                    disabled={!u.email || enviandoSenhaId === u.id}
                    title="Enviar e-mail para alterar a senha"
                  >
                    {enviandoSenhaId === u.id ? 'Enviando...' : 'Alterar senha'}
                  </button>
                  <button
                    className="btn btn-small btn-ghost"
                    onClick={() => setEditandoId(u.id)}
                    disabled={Boolean(editando)}
                  >
                    Editar
                  </button>
                  <button
                    className={`btn btn-small ${u.status === 'inativo' ? 'btn-ok' : 'btn-warning'}`}
                    onClick={() => alternarStatus(u)}
                  >
                    {u.status === 'inativo' ? 'Ativar' : 'Desativar'}
                  </button>
                  <button
                    className="btn btn-small btn-danger"
                    onClick={() => removerUsuario(u)}
                    disabled={u.uid === userProfile?.uid}
                    title={u.uid === userProfile?.uid ? 'Não é possível remover o próprio usuário' : 'Remover usuário'}
                  >
                    Remover
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}