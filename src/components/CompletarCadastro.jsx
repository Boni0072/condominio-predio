import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

// Tela exibida quando a conta está autenticada mas o cadastro no condomínio
// não foi concluído (perfil ausente no Firestore). O usuário informa o código
// de acesso e o sistema vincula a conta ao condomínio como morador.
export default function CompletarCadastro() {
  const { user, userProfile, completarCadastroMorador, logout } = useAuth()
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    if (!codigo.trim()) return setErro('Informe o código do condomínio.')
    setCarregando(true)
    try {
      await completarCadastroMorador(codigo)
      // Ao concluir, o perfil é atualizado no contexto e o App entra automaticamente.
    } catch (err) {
      setErro(err?.message || 'Não foi possível concluir o cadastro. Tente novamente.')
    }
    setCarregando(false)
  }

  return (
    <div className="login-screen">
      <div className="login-card" style={{ maxWidth: 480 }}>
        <div className="login-mark">CP</div>
        <h1>Falta pouco!</h1>
        <p className="sub">
          Sua conta <strong>{userProfile?.email || user?.email}</strong> está autenticada,
          mas o cadastro no condomínio não foi concluído. Informe o código de acesso para entrar.
        </p>
        {erro && <div className="login-erro">{erro}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="codigo-condominio">Código do condomínio</label>
            <input
              id="codigo-condominio"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ex.: ABC123"
              style={{ textTransform: 'uppercase' }}
              required
            />
            <p className="login-hint">
              Peça o código ao síndico do seu condomínio (ele aparece nas Configurações, em "Código de acesso do condomínio").
            </p>
          </div>
          <button type="submit" className="btn btn-brass btn-block" disabled={carregando}>
            {carregando ? 'Vinculando...' : 'Entrar no condomínio'}
          </button>
          <div className="login-links">
            <button type="button" className="link-btn" onClick={logout}>
              Não é você? Sair da conta
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
