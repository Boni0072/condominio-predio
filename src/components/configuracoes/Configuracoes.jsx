import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { arquivoParaDataUrl } from '../../utils/imagem.js'
import { REGRAS_FIRESTORE } from '../../firebase/regras.js'
import { TEMAS, temaSalvo, aplicarTema, coresPersonalizadas, aplicarCoresPersonalizadas } from '../../utils/tema.js'
import { salvarTokenUsuario } from '../../utils/push.js'

export default function Configuracoes() {
  const { userProfile, condominio, atualizarCondominio } = useAuth()
  const [nome, setNome] = useState(condominio?.nome || '')
  const [logo, setLogo] = useState(condominio?.logo || '')
  const [endereco, setEndereco] = useState(condominio?.endereco || '')
  const [erro, setErro] = useState('')
  const [sucesso, setSucesso] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [processando, setProcessando] = useState(false)
  const [temaAtual, setTemaAtual] = useState(temaSalvo())
  const [cores, setCores] = useState(coresPersonalizadas())
  const [permissaoNotif, setPermissaoNotif] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const [ativandoNotif, setAtivandoNotif] = useState(false)
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

  function escolherTema(id) {
    setTemaAtual(aplicarTema(id))
    if (id === 'personalizado') setCores(coresPersonalizadas())
  }

  function alterarCor(campo, valor) {
    const novas = { ...cores, [campo]: valor }
    setCores(novas)
    aplicarCoresPersonalizadas(novas)
    setTemaAtual('personalizado')
  }

  // Ativa o push neste dispositivo: pede permissão (precisa do toque do usuário
  // no iPhone) e registra o token FCM no condomínio.
  async function ativarNotificacoes() {
    setAtivandoNotif(true)
    setErro('')
    setSucesso('')
    try {
      const token = await salvarTokenUsuario(userProfile?.condominioId, userProfile?.uid, {
        dispositivo: navigator.platform || 'desconhecido'
      })
      setPermissaoNotif(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported')
      if (token) {
        setSucesso('Notificações ativadas neste dispositivo! Você receberá avisos de encomendas e visitantes.')
      } else if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
        setErro('As notificações estão bloqueadas. Libere nas configurações do navegador/celular (ícone do cadeado no site ou Ajustes → Notificações).')
      } else {
        setErro('Não foi possível ativar. Abra o app pelo endereço https:// (ou localhost) e tente de novo.')
      }
    } catch (err) {
      setErro('Erro ao ativar notificações: ' + (err?.message || err))
    }
    setAtivandoNotif(false)
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

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>Notificações push</h3>
        <p className="hint" style={{ marginBottom: 12, color: 'var(--ink-soft)', fontSize: 12 }}>
          Receba avisos de encomendas e visitantes mesmo com o app fechado. Ative em cada dispositivo que deve receber os avisos.
        </p>
        {permissaoNotif === 'granted' ? (
          <p style={{ margin: '0 0 12px', color: 'var(--ok, #2e7d32)', fontSize: 13 }}>
            ✓ Notificações permitidas neste dispositivo. Toque em reativar se não estiver recebendo os avisos.
          </p>
        ) : permissaoNotif === 'denied' ? (
          <p style={{ margin: '0 0 12px', color: 'var(--danger, #c0392b)', fontSize: 13 }}>
            ✗ Notificações bloqueadas para este site. Libere nas configurações do navegador/celular para receber os avisos.
          </p>
        ) : null}
        <button
          type="button"
          className="btn btn-brass"
          onClick={ativarNotificacoes}
          disabled={ativandoNotif || !userProfile?.condominioId}
        >
          {ativandoNotif ? 'Ativando...' : 'Ativar notificações neste dispositivo'}
        </button>
        {!userProfile?.condominioId && (
          <p className="hint" style={{ marginTop: 8, color: 'var(--ink-soft)', fontSize: 12 }}>
            Disponível para contas vinculadas a um condomínio.
          </p>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>Tema de cores do sistema</h3>
        <p className="hint" style={{ marginBottom: 16, color: 'var(--ink-soft)', fontSize: 12 }}>
          Escolha a escala de cores da interface. A opção é aplicada na hora e fica salva neste dispositivo — cada máquina pode usar um tema diferente.
        </p>
        <div className="temas-lista">
          {TEMAS.map((tema) => (
            <button
              type="button"
              key={tema.id}
              className={'tema-opcao' + (temaAtual === tema.id ? ' tema-ativo' : '')}
              onClick={() => escolherTema(tema.id)}
              aria-pressed={temaAtual === tema.id}
            >
              <span className="tema-amostras">
                {tema.amostras.map((cor, indice) => (
                  <span key={indice} style={{ background: cor }} />
                ))}
              </span>
              <strong>{tema.nome}</strong>
              <span className="tema-descricao">{tema.descricao}</span>
              <span className={'tema-status' + (temaAtual === tema.id ? ' em-uso' : '')}>
                {temaAtual === tema.id ? '✓ Em uso' : 'Ativar'}
              </span>
            </button>
          ))}
          <button
            type="button"
            className={'tema-opcao' + (temaAtual === 'personalizado' ? ' tema-ativo' : '')}
            onClick={() => escolherTema('personalizado')}
            aria-pressed={temaAtual === 'personalizado'}
          >
            <span className="tema-amostras">
              {[cores.principal, cores.escura, cores.suave].map((cor, indice) => (
                <span key={indice} style={{ background: cor }} />
              ))}
            </span>
            <strong>Personalizado</strong>
            <span className="tema-descricao">Defina as cores do sistema do seu jeito.</span>
            <span className={'tema-status' + (temaAtual === 'personalizado' ? ' em-uso' : '')}>
              {temaAtual === 'personalizado' ? '✓ Em uso' : 'Editar cores'}
            </span>
          </button>
        </div>

        {temaAtual === 'personalizado' && (
          <div className="tema-editor">
            <div className="tema-editor-campo">
              <label htmlFor="tema-cor-principal">Cor principal</label>
              <div className="tema-editor-controle">
                <input id="tema-cor-principal" type="color" value={cores.principal} onChange={(e) => alterarCor('principal', e.target.value)} />
                <code>{cores.principal.toUpperCase()}</code>
              </div>
            </div>
            <div className="tema-editor-campo">
              <label htmlFor="tema-cor-escura">Cor escura (hover)</label>
              <div className="tema-editor-controle">
                <input id="tema-cor-escura" type="color" value={cores.escura} onChange={(e) => alterarCor('escura', e.target.value)} />
                <code>{cores.escura.toUpperCase()}</code>
              </div>
            </div>
            <div className="tema-editor-campo">
              <label htmlFor="tema-cor-suave">Fundo suave</label>
              <div className="tema-editor-controle">
                <input id="tema-cor-suave" type="color" value={cores.suave} onChange={(e) => alterarCor('suave', e.target.value)} />
                <code>{cores.suave.toUpperCase()}</code>
              </div>
            </div>
            <p className="tema-editor-hint">
              Botões, menu ativo, badges e destaques usam a cor principal. As alterações são aplicadas na hora e salvas neste dispositivo.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}