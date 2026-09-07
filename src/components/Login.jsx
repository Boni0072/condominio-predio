import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { digitosTelefone, normalizarWhatsApp } from '../utils/whatsapp.js'

export default function Login() {
  const { login, signUpAdmin, signUpMember, enviarRedefinicaoSenha, erroConexao } = useAuth()
  const [tela, setTela] = useState('login')
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [carregando, setCarregando] = useState(false)

  const [loginEmail, setLoginEmail] = useState('')
  const [loginSenha, setLoginSenha] = useState('')
  const [adminNome, setAdminNome] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminSenha, setAdminSenha] = useState('')
  const [adminCondominio, setAdminCondominio] = useState('')
  const [adminEndereco, setAdminEndereco] = useState('')
  const [membroNome, setMembroNome] = useState('')
  const [membroEmail, setMembroEmail] = useState('')
  const [membroSenha, setMembroSenha] = useState('')
  const [membroCodigo, setMembroCodigo] = useState('')
  const [membroUnidade, setMembroUnidade] = useState('')
  const [membroWhatsapp, setMembroWhatsapp] = useState('')
  const [adminWhatsapp, setAdminWhatsapp] = useState('')
  const [recuperarEmail, setRecuperarEmail] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setErro('')
    setCarregando(true)
    try {
      await login({ email: loginEmail.trim(), password: loginSenha })
    } catch (err) {
      tratarErro(err)
    }
    setCarregando(false)
  }

  async function handleSignUpAdmin(e) {
    e.preventDefault()
    setErro('')
    const whatsappAdmin = digitosTelefone(adminWhatsapp)
    if (whatsappAdmin && !normalizarWhatsApp(whatsappAdmin)) {
      setErro('WhatsApp do síndico inválido. Use DDD + número, ex.: (11) 98765-4321.')
      return
    }
    setCarregando(true)
    try {
      await signUpAdmin({
        email: adminEmail.trim(),
        senha: adminSenha,
        nome: adminNome,
        condominoNome: adminCondominio,
        endereco: adminEndereco,
        whatsapp: whatsappAdmin
      })
    } catch (err) { tratarErro(err) }
    setCarregando(false)
  }

  async function handleSignUpMember(e) {
    e.preventDefault()
    setErro('')
    const whatsappMembro = digitosTelefone(membroWhatsapp)
    if (whatsappMembro && !normalizarWhatsApp(whatsappMembro)) {
      setErro('WhatsApp inválido. Use DDD + número, ex.: (11) 98765-4321.')
      return
    }
    setCarregando(true)
    try {
      // Moradores criam a própria conta pelo código do condomínio.
      // Zeladores e porteiros são cadastrados pelo síndico em Gestão de usuários.
      await signUpMember({
        email: membroEmail.trim(),
        senha: membroSenha,
        nome: membroNome,
        role: 'morador',
        condominioCodigo: membroCodigo.trim().toUpperCase(),
        unidade: membroUnidade.trim(),
        whatsapp: whatsappMembro
      })
    } catch (err) { tratarErro(err) }
    setCarregando(false)
  }

  async function handleRecuperar(e) {
    e.preventDefault()
    setErro('')
    setSucesso('')
    setCarregando(true)
    try {
      await enviarRedefinicaoSenha(recuperarEmail)
      setSucesso(`Enviamos um link de redefinição para ${recuperarEmail.trim()}. Abra o e-mail e siga as instruções para criar uma nova senha.`)
    } catch (err) {
      setErro(err?.message || 'Não foi possível enviar o e-mail de redefinição. Tente novamente.')
    }
    setCarregando(false)
  }

  function tratarErro(err) {
    const code = err?.code || ''
    const msg = err?.message || ''
    if (code === 'auth/email-already-in-use') setErro('Este e-mail já está em uso.')
    else if (code === 'auth/invalid-email') setErro('E-mail inválido.')
    else if (code === 'auth/weak-password') setErro('A senha deve ter pelo menos 6 caracteres.')
    else if (code === 'auth/wrong-password') setErro('Senha incorreta.')
    else if (code === 'auth/user-not-found') setErro('Usuário não encontrado.')
    else if (code === 'auth/invalid-credential') setErro('E-mail ou senha incorretos. Se a conta já existe, use "Esqueci minha senha" abaixo para redefinir a senha e tente novamente.')
    else if (code === 'auth/too-many-requests') setErro('Muitas tentativas. Aguarde alguns minutos e tente novamente.')
    else if (code === 'auth/configuration-not-found') setErro('Firebase não configurado. Habilite Authentication e Firestore no console.')
    else if (code === 'permission-denied' || msg.includes('permission')) setErro('Erro de permissão. Verifique se as regras do Firestore (firestore.rules) foram publicadas no console.')
    else setErro(msg || 'Ocorreu um erro. Tente novamente.')
  }

  return (
    <div className="login-screen">
      <div className="login-card" style={{ maxWidth: 480 }}>
        <div className="login-mark">CP</div>
        <h1>Portaria &amp; Mural</h1>
        <p className="sub">Sistema de portaria e mural para condomínios.</p>
        {erro && (
          <div className="login-erro">
            {erro}
            {erro.includes('Firebase não configurado') && (
              <div className="login-ajuda">
                <strong>Como configurar:</strong>
                <ol>
                  <li>Acesse <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">console.firebase.google.com</a></li>
                  <li>Authentication → Sign-in method → E-mail/senha → Habilite</li>
                  <li>Firestore Database → Criar banco → Modo teste</li>
                  <li>Firestore → Regras → allow read, write: if request.auth != null;</li>
                </ol>
              </div>
            )}
          </div>
        )}
        {sucesso && <div className="login-sucesso">{sucesso}</div>}
        {erroConexao && (
          <div className="login-erro">
            {erroConexao}
            <div className="login-ajuda">
              Verifique sua conexão com a internet e as regras do Firestore no console do Firebase.
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => window.location.reload()}>
                  Tentar novamente
                </button>
              </div>
            </div>
          </div>
        )}
        {tela === 'login' && (
          <form onSubmit={handleLogin}>
            <div className="field">
              <label htmlFor="login-email">E-mail</label>
              <input id="login-email" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="seu@email.com" required />
            </div>
            <div className="field">
              <label htmlFor="login-senha">Senha</label>
              <input id="login-senha" type="password" value={loginSenha} onChange={(e) => setLoginSenha(e.target.value)} placeholder="Sua senha" required />
            </div>
            <button type="submit" className="btn btn-brass btn-block" disabled={carregando}>
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>
            <div className="login-links">
              <button type="button" className="link-btn" onClick={() => { setTela('recuperar'); setErro(''); setSucesso('') }}>
                Esqueci minha senha
              </button>
            </div>
            <p className="login-hint">Moradores criam a conta com o código do condomínio. Zeladores e porteiros são cadastrados pelo síndico em Gestão de usuários.</p>
            <div className="login-links">
              <button type="button" className="link-btn" onClick={() => { setTela('entrarCondominio'); setErro(''); setSucesso('') }}>
                Sou morador — criar conta com o código do condomínio
              </button>
            </div>
          </form>
        )}
        {tela === 'criarConta' && (
          <form onSubmit={handleSignUpAdmin}>
            <p className="form-titulo">Criar condomínio</p>
            <div className="field">
              <label htmlFor="admin-nome">Seu nome</label>
              <input id="admin-nome" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} placeholder="Nome completo" required />
            </div>
            <div className="field">
              <label htmlFor="admin-email">E-mail</label>
              <input id="admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="seu@email.com" required />
            </div>
            <div className="field">
              <label htmlFor="admin-senha">Senha</label>
              <input id="admin-senha" type="password" value={adminSenha} onChange={(e) => setAdminSenha(e.target.value)} placeholder="Mínimo 6 caracteres" minLength={6} required />
            </div>
            <div className="field">
              <label htmlFor="admin-condominio">Nome do condomínio</label>
              <input id="admin-condominio" value={adminCondominio} onChange={(e) => setAdminCondominio(e.target.value)} placeholder="Ex.: Residencial Solar" required />
            </div>
            <div className="field">
              <label htmlFor="admin-endereco">Endereço (opcional)</label>
              <input id="admin-endereco" value={adminEndereco} onChange={(e) => setAdminEndereco(e.target.value)} placeholder="Rua, número, bairro" />
            </div>
            <div className="field">
              <label htmlFor="admin-whatsapp">WhatsApp (para notificações)</label>
              <input id="admin-whatsapp" type="tel" value={adminWhatsapp} onChange={(e) => setAdminWhatsapp(e.target.value)} placeholder="Ex.: (11) 98765-4321" />
            </div>
            <button type="submit" className="btn btn-brass btn-block" disabled={carregando}>
              {carregando ? 'Criando...' : 'Criar condomínio'}
            </button>
            <div className="login-links">
              <button type="button" className="link-btn" onClick={() => { setTela('login'); setErro(''); setSucesso('') }}>← Voltar ao login</button>
            </div>
          </form>
        )}
        {tela === 'entrarCondominio' && (
          <form onSubmit={handleSignUpMember}>
            <p className="form-titulo">Criar conta de morador</p>
            <div className="field">
              <label htmlFor="membro-nome">Seu nome</label>
              <input id="membro-nome" value={membroNome} onChange={(e) => setMembroNome(e.target.value)} placeholder="Nome completo" required />
            </div>
            <div className="field">
              <label htmlFor="membro-email">E-mail</label>
              <input id="membro-email" type="email" value={membroEmail} onChange={(e) => setMembroEmail(e.target.value)} placeholder="seu@email.com" required />
            </div>
            <div className="field">
              <label htmlFor="membro-senha">Senha</label>
              <input id="membro-senha" type="password" value={membroSenha} onChange={(e) => setMembroSenha(e.target.value)} placeholder="Mínimo 6 caracteres" minLength={6} required />
            </div>
            <div className="field">
              <label htmlFor="membro-codigo">Código do condomínio</label>
              <input id="membro-codigo" value={membroCodigo} onChange={(e) => setMembroCodigo(e.target.value)} placeholder="Ex.: ABC123" style={{ textTransform: 'uppercase' }} required />
              <p className="login-hint">Peça o código ao síndico do seu condomínio.</p>
            </div>
            <div className="field">
              <label htmlFor="membro-unidade">Unidade</label>
              <input id="membro-unidade" value={membroUnidade} onChange={(e) => setMembroUnidade(e.target.value)} placeholder="Ex.: Bloco A, apto 101" required />
            </div>
            <div className="field">
              <label htmlFor="membro-whatsapp">WhatsApp (para notificações)</label>
              <input id="membro-whatsapp" type="tel" value={membroWhatsapp} onChange={(e) => setMembroWhatsapp(e.target.value)} placeholder="Ex.: (11) 98765-4321" />
            </div>
            <button type="submit" className="btn btn-brass btn-block" disabled={carregando}>
              {carregando ? 'Criando conta...' : 'Criar conta e entrar'}
            </button>
            <div className="login-links">
              <button type="button" className="link-btn" onClick={() => { setTela('login'); setErro(''); setSucesso('') }}>← Voltar ao login</button>
            </div>
          </form>
        )}
        {tela === 'recuperar' && (
          <form onSubmit={handleRecuperar}>
            <p className="form-titulo">Recuperar senha</p>
            <div className="field">
              <label htmlFor="recuperar-email">E-mail da conta</label>
              <input id="recuperar-email" type="email" value={recuperarEmail} onChange={(e) => setRecuperarEmail(e.target.value)} placeholder="seu@email.com" required />
            </div>
            <button type="submit" className="btn btn-brass btn-block" disabled={carregando}>
              {carregando ? 'Enviando...' : 'Enviar link de redefinição'}
            </button>
            <p className="login-hint">Você vai receber um e-mail com um link seguro para criar uma nova senha. Se não chegar em alguns minutos, verifique a caixa de spam.</p>
            <div className="login-links">
              <button type="button" className="link-btn" onClick={() => { setTela('login'); setErro(''); setSucesso('') }}>← Voltar ao login</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
