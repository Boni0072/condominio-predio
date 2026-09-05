import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { arquivoParaDataUrl } from '../../utils/imagem.js'
import { REGRAS_FIRESTORE } from '../../firebase/regras.js'

export default function Configuracoes() {
  const { userProfile, condominio, atualizarCondominio } = useAuth()
  const [nome, setNome] = useState(condominio?.nome || '')
  const [logo, setLogo] = useState(condominio?.logo || '')
  const [endereco, setEndereco] = useState(condominio?.endereco || '')
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [processando, setProcessando] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!condominio) return
    setNome(condominio.nome || '')
    setLogo(condominio.logo || '')
    setEndereco(condominio.endereco || '')
  }, [condominio])

  async function handleLogo(e) {
    const file = e.target.files[0]
    if (!file) return
    setProcessando(true)
    setErro('')
    try {
      const dataUrl = await arquivoParaDataUrl(file, 300, 0.85)
      setLogo(dataUrl)
    } catch {
      setErro('Não foi possível processar a imagem. Tente outro arquivo.')
    }
    setProcessando(false)
  }

  function removerLogo() {
    setLogo('')
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setErro('')
    setSucesso('')
    setCarregando(true)
    try {
      await atualizarCondominio({
        nome: nome.trim(),
        logo: logo.startsWith('data:image/') ? logo : '',
        endereco: endereco.trim()
      })
      setSucesso('Dados do condomínio atualizados!')
    } catch (err) {
      const msg = err?.message || ''
      if (msg.includes('permission')) {
        setErro(
          'Erro de permissão do Firestore. O síndico precisa do acesso de escrita ao documento do condomínio. Veja as instruções abaixo.'
        )
      } else {
        setErro(msg)
      }
    }
    setCarregando(false)
  }

  const initial = (condominio?.nome || 'Condomínio').charAt(0).toUpperCase()

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Configurações do condomínio</h2>
          <p className="sub">Personalize o nome, logo e informações exibidas no sistema.</p>
        </div>
      </div>

      {erro && (
        <>
          <div className="login-erro">{erro}</div>
          {erro.includes('permissão') && (
            <div className="login-ajuda" style={{ marginBottom: 16 }}>
              <strong>Para liberar a gravação, atualize as regras do Firestore:</strong>
              <ol>
                <li>Acesse <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer">console.firebase.google.com</a></li>
                <li>Selecione o projeto <strong>portaria-condominio-8fbc9</strong></li>
                <li>Menu <strong>Firestore Database</strong> → aba <strong>Rules</strong></li>
                <li>Substitua todo o conteúdo por:
                  <pre style={{ background: 'var(--paper)', padding: 10, borderRadius: 6, fontSize: 11, overflow: 'auto', marginTop: 8 }}>{REGRAS_FIRESTORE}</pre>
                </li>
                <li>Clique em <strong>Publish</strong></li>
                <li>Volte aqui e clique em <strong>Salvar alterações</strong></li>
              </ol>
            </div>
          )}
        </>
      )}
      {sucesso && <div className="login-sucesso">{sucesso}</div>}

      <div className="grid-2" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Logo do condomínio</h3>
          <div className="logo-preview-box">
            {logo ? (
              <img src={logo} alt="Prévia do logo" className="logo-preview-img" />
            ) : (
              <div className="logo-preview-placeholder">{initial}</div>
            )}
          </div>
          <div className="logo-acoes">
            <label className="btn btn-brass btn-small">
              {processando ? 'Processando...' : 'Escolher logo'}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={handleLogo}
                style={{ display: 'none' }}
              />
            </label>
            {logo && (
              <button type="button" className="btn btn-ghost btn-small" onClick={removerLogo}>
                Remover logo
              </button>
            )}
          </div>
          <p className="hint" style={{ marginTop: 12, color: 'var(--ink-soft)', fontSize: 12 }}>
            PNG com fundo transparente é o ideal. A imagem é redimensionada para 300px automaticamente.
          </p>
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Dados do condomínio</h3>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="conf-nome">Nome do condomínio</label>
              <input id="conf-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Residencial Solar" required />
            </div>
            <div className="field">
              <label htmlFor="conf-endereco">Endereço</label>
              <input id="conf-endereco" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro" />
            </div>
            {condominio?.codigo && (
              <div className="field">
                <label>Código de acesso do condomínio</label>
                <div className="codigo-visual">
                  <code>{condominio.codigo}</code>
                  <span>Compartilhe com os moradores para criarem as contas deles. Zeladores e porteiros são cadastrados pelo síndico em Gestão de usuários.</span>
                </div>
              </div>
            )}
            <button type="submit" className="btn btn-brass btn-block" disabled={carregando || processando}>
              {carregando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}