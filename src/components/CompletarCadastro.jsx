import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { digitosTelefone, normalizarWhatsApp } from '../utils/whatsapp.js'

// Tela exibida quando a conta está autenticada mas o cadastro no condomínio
// não foi concluído (perfil ausente no Firestore). O usuário informa o código
// de acesso e o sistema vincula a conta ao condomínio como morador.
export default function CompletarCadastro() {
  const { user, userProfile, completarCadastroMorador, logout } = useAuth()
  const [codigo, setCodigo] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [unidade, setUnidade] = useState('')
  const [quartos, setQuartos] = useState('1')
  const [vagas, setVagas] = useState('0')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    if (!codigo.trim()) return setErro('Informe o código do condomínio.')
    const whatsappLimpo = digitosTelefone(whatsapp)
    if (whatsappLimpo && !normalizarWhatsApp(whatsappLimpo)) {
      return setErro('WhatsApp inválido. Use DDD + número, ex.: (11) 98765-4321.')
    }
    setCarregando(true)
    try {
      await completarCadastroMorador({
        codigo,
        whatsapp: whatsappLimpo,
        unidade: unidade.trim(),
        quartos: Math.max(0, Math.min(20, parseInt(quartos, 10) || 0)),
        vagas: Math.max(0, Math.min(20, parseInt(vagas, 10) || 0))
      })
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
          <div className="field">
            <label htmlFor="unidade-completar">Unidade</label>
            <input
              id="unidade-completar"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              placeholder="Ex.: Bloco A, apto 101"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="quartos-completar">Quartos</label>
            <input id="quartos-completar" type="number" min="0" max="20" value={quartos} onChange={(e) => setQuartos(e.target.value)} />
            <p className="login-hint">Use 0 para studio/quitinete. Esse dado define o tipo usado no rateio por metragem.</p>
          </div>
          <div className="field">
            <label htmlFor="vagas-completar">Vagas de garagem</label>
            <input id="vagas-completar" type="number" min="0" max="20" value={vagas} onChange={(e) => setVagas(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="whatsapp-completar">WhatsApp (para notificações)</label>
            <input
              id="whatsapp-completar"
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="Ex.: (11) 98765-4321"
            />
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
