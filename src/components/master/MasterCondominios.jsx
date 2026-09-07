import React, { useEffect, useState } from 'react'
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { arquivoParaDataUrl } from '../../utils/imagem.js'

const FORM_INICIAL = {
  condominioNome: '',
  endereco: '',
  nome: '',
  email: '',
  senha: '',
  logo: ''
}

export default function MasterCondominios() {
  const { criarCondominio, atualizarCondominioMaster, excluirCondominio, enviarRedefinicaoSenha } = useAuth()
  const [condominios, setCondominios] = useState([])
  const [form, setForm] = useState(FORM_INICIAL)
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [editandoId, setEditandoId] = useState(null)
  const [processandoLogo, setProcessandoLogo] = useState(false)
  const [sindicoAtual, setSindicoAtual] = useState(null)
  const [redefinindoSenha, setRedefinindoSenha] = useState(false)

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, 'tenants'),
      (snapshot) => setCondominios(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))),
      (err) => setErro(err.message || 'Não foi possível carregar os condomínios.')
    )
    return () => unsub()
  }, [])

  function alterar(campo, valor) {
    setForm((atual) => ({ ...atual, [campo]: valor }))
  }

  async function selecionarLogo(e) {
    const arquivo = e.target.files[0]
    if (!arquivo) return
    setProcessandoLogo(true)
    try {
      alterar('logo', await arquivoParaDataUrl(arquivo, 300, 0.85))
    } catch (err) {
      setErro(err.message || 'Não foi possível processar o logo.')
    }
    setProcessandoLogo(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    setSucesso('')
    setCarregando(true)
    try {
      const criado = editandoId
        ? await atualizarCondominioMaster(editandoId, {
            nome: form.condominioNome,
            endereco: form.endereco,
            logo: form.logo,
            sindicoNome: form.nome,
            sindicoEmail: form.email
          })
        : await criarCondominio(form)
      setForm(FORM_INICIAL)
      setEditandoId(null)
      setSindicoAtual(null)
      setSucesso(editandoId ? 'Condomínio atualizado.' : `Condomínio criado. Código de acesso: ${criado.codigo}`)
    } catch (err) {
      setErro(err?.message || 'Não foi possível criar o condomínio.')
    }
    setCarregando(false)
  }

  function editar(condominio) {
    setEditandoId(condominio.id)
    setForm({ ...FORM_INICIAL, condominioNome: condominio.nome || '', endereco: condominio.endereco || '', logo: condominio.logo || '' })
    setSindicoAtual(null)
    setErro('')
    setSucesso('')
    carregarSindico(condominio.id)
  }

  async function carregarSindico(condominioId) {
    try {
      const snap = await getDocs(
        query(collection(db, 'users'), where('condominioId', '==', condominioId), where('role', '==', 'sindico'))
      )
      const perfil = snap.docs[0] ? { id: snap.docs[0].id, ...snap.docs[0].data() } : null
      setSindicoAtual(perfil)
      if (perfil) {
        setForm((atual) => ({ ...atual, nome: perfil.nome || '', email: perfil.email || '' }))
      }
    } catch {
      // Sem permissão de leitura ou erro momentâneo: campos do síndico ficam em branco.
    }
  }

  async function redefinirSenhaSindico() {
    const email = sindicoAtual?.email || form.email
    setErro('')
    setSucesso('')
    setRedefinindoSenha(true)
    try {
      await enviarRedefinicaoSenha(email)
      setSucesso(`E-mail de redefinição de senha enviado para ${email}.`)
    } catch (err) {
      setErro(err?.message || 'Não foi possível enviar o e-mail de redefinição.')
    }
    setRedefinindoSenha(false)
  }

  async function remover(condominio) {
    if (!window.confirm(`Excluir o condomínio "${condominio.nome || 'sem nome'}" e todos os seus dados?`)) return
    setErro('')
    setSucesso('')
    try {
      await excluirCondominio(condominio.id)
      if (editandoId === condominio.id) {
        setEditandoId(null)
        setSindicoAtual(null)
        setForm(FORM_INICIAL)
      }
      setSucesso('Condomínio excluído.')
    } catch (err) {
      setErro(err.message || 'Não foi possível excluir o condomínio.')
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Administração de condomínios</h2>
          <p className="sub">Cadastre condomínios e seus síndicos para iniciar a operação.</p>
        </div>
      </div>

      {erro && <div className="login-erro">{erro}</div>}
      {sucesso && <div className="login-sucesso">{sucesso}</div>}

      <div className="grid-2 master-layout">
        <form className="card" onSubmit={handleSubmit}>
          <h3 style={{ marginBottom: 16 }}>{editandoId ? 'Editar condomínio' : 'Novo condomínio'}</h3>
          <div className="field">
            <label htmlFor="master-condominio">Nome do condomínio</label>
            <input id="master-condominio" value={form.condominioNome} onChange={(e) => alterar('condominioNome', e.target.value)} placeholder="Ex.: Residencial Solar" required />
          </div>
          <div className="field">
            <label htmlFor="master-endereco">Endereço</label>
            <input id="master-endereco" value={form.endereco} onChange={(e) => alterar('endereco', e.target.value)} placeholder="Rua, número, bairro" />
          </div>
          <div className="field">
            <label htmlFor="master-sindico">Nome do síndico</label>
            <input id="master-sindico" value={form.nome} onChange={(e) => alterar('nome', e.target.value)} placeholder="Nome completo" required={!editandoId} />
          </div>
          <div className="field">
            <label htmlFor="master-email">E-mail do síndico</label>
            <input id="master-email" type="email" value={form.email} onChange={(e) => alterar('email', e.target.value)} placeholder="sindico@email.com" required={!editandoId} />
            {editandoId && (
              <p className="field-help">Atualiza o cadastro interno do condomínio. O e-mail usado para entrar (login) continua o mesmo.</p>
            )}
          </div>
          {editandoId ? (
            <div className="field">
              <label htmlFor="master-senha-redefinir">Senha de acesso</label>
              <button type="button" id="master-senha-redefinir" className="btn btn-ghost btn-block" onClick={redefinirSenhaSindico} disabled={redefinindoSenha || (!sindicoAtual?.email && !form.email)}>
                {redefinindoSenha ? 'Enviando...' : 'Enviar redefinição de senha por e-mail'}
              </button>
              <p className="field-help">Por segurança, o master não define a senha do síndico: ele recebe um e-mail do Firebase para criar uma nova.</p>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="master-senha">Senha inicial</label>
              <input id="master-senha" type="password" minLength={6} value={form.senha} onChange={(e) => alterar('senha', e.target.value)} placeholder="Mínimo 6 caracteres" required />
            </div>
          )}
          <div className="field">
            <label htmlFor="master-logo">Logo do condomínio</label>
            <input id="master-logo" type="file" accept="image/*" onChange={selecionarLogo} disabled={processandoLogo} />
            {form.logo && <img src={form.logo} alt="Prévia do logo" className="master-logo-preview" />}
          </div>
          <button type="submit" className="btn btn-brass btn-block" disabled={carregando}>
            {carregando ? 'Salvando...' : (editandoId ? 'Salvar alterações' : 'Criar condomínio e síndico')}
          </button>
          {editandoId && <button type="button" className="btn btn-ghost btn-block" onClick={() => { setEditandoId(null); setSindicoAtual(null); setForm(FORM_INICIAL) }}>Cancelar edição</button>}
        </form>

        <div className="card">
          <div className="panel-header">
            <div>
              <h3>Condomínios cadastrados</h3>
              <p className="field-help">{condominios.length} condomínio(s) na plataforma</p>
            </div>
          </div>
          {condominios.length === 0 ? (
            <p className="empty">Nenhum condomínio cadastrado.</p>
          ) : (
            <div className="master-condominios-lista">
              {condominios.map((condominio) => (
                <div className="master-condominio-item" key={condominio.id}>
                  {condominio.logo ? (
                    <img src={condominio.logo} alt="" className="master-condominio-logo" />
                  ) : (
                    <div className="master-condominio-logo master-condominio-logo-vazio">{(condominio.nome || 'C').charAt(0).toUpperCase()}</div>
                  )}
                  <div>
                    <strong>{condominio.nome || 'Condomínio sem nome'}</strong>
                    <span>{condominio.endereco || 'Endereço não informado'}</span>
                  </div>
                  <div className="master-condominio-acoes">
                    <code>{condominio.codigo || '—'}</code>
                    <button type="button" className="btn btn-small btn-ghost" onClick={() => editar(condominio)}>Editar</button>
                    <button type="button" className="btn btn-small btn-danger" onClick={() => remover(condominio)}>Excluir</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
