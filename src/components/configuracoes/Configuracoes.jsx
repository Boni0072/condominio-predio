import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { arquivoParaDataUrl } from '../../utils/imagem.js'
import { REGRAS_FIRESTORE } from '../../firebase/regras.js'
import { TEMAS, temaSalvo, aplicarTema, coresPersonalizadas, aplicarCoresPersonalizadas } from '../../utils/tema.js'
import { salvarTokenUsuario, pushConfigurado, ultimoErroToken, ultimoDocSalvo, diagnosticarPush } from '../../utils/push.js'

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
  const [diagnostico, setDiagnostico] = useState([])
  const inputRef = useRef(null)

  // Morador consulta os dados do condomínio, mas não pode editá-los —
  // as regras do Firestore só permitem gravação ao síndico/zelador/portaria.
  const somenteLeitura = userProfile?.role === 'morador'

  const adicionarDiag = (msg) => setDiagnostico((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${msg}`])

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

  // Diagnóstico completo — mostra exatamente o que está acontecendo
  async function executarDiagnostico() {
    setDiagnostico([])
    adicionarDiag('Iniciando diagnóstico...')

    // 1. VAPID key
    if (!pushConfigurado()) {
      adicionarDiag('❌ VAPID key não configurada')
      return
    }
    adicionarDiag('✅ VAPID key configurada')

    // 2. Suporte
    if (!('serviceWorker' in navigator)) {
      adicionarDiag('❌ Service Worker não suportado')
      return
    }
    adicionarDiag('✅ Service Worker suportado')

    if (typeof Notification === 'undefined') {
      adicionarDiag('❌ Notification API não suportado')
      return
    }
    adicionarDiag('✅ Notification API suportado')

    // 3. Permissão
    adicionarDiag(`Permissão atual: ${Notification.permission}`)
    if (Notification.permission === 'denied') {
      adicionarDiag('❌ Notificações BLOQUEADAS — libere nas configurações do navegador')
      return
    }

    // 4. Service Worker
    const regs = await navigator.serviceWorker.getRegistrations()
    adicionarDiag(`SWs registrados: ${regs.length}`)
    regs.forEach((r) => adicionarDiag(`  - ${r.scope}`))

    // 5. Tenta obter token
    try {
      const { obterTokenFCM, registrarServiceWorkerFCM } = await import('../../utils/push.js')
      const reg = await registrarServiceWorkerFCM()
      if (!reg) {
        adicionarDiag('❌ Falha ao registrar SW do FCM')
        return
      }
      adicionarDiag('✅ SW FCM registrado')

      const token = await obterTokenFCM()
      if (!token) {
        adicionarDiag(`❌ getToken falhou: ${ultimoErroToken() || 'motivo desconhecido'}`)
        return
      }
      adicionarDiag(`✅ Token obtido: ${token.substring(0, 20)}...`)

      // 6. Salvar
      if (!userProfile?.condominioId || !userProfile?.uid) {
        adicionarDiag(`❌ Perfil sem condomínio/uid (condominioId=${userProfile?.condominioId ?? 'null'}, uid=${userProfile?.uid ?? 'null'}) — o token só é salvo para usuários vinculados a um condomínio (o login master não tem tenant).`)
        return
      }
      const salvo = await salvarTokenUsuario(userProfile.condominioId, userProfile.uid, {
        dispositivo: navigator.platform || 'desconhecido'
      })
      if (salvo) {
        adicionarDiag(`✅ TOKEN SALVO NO FIRESTORE: tenants/${userProfile.condominioId}/pushTokens/${ultimoDocSalvo() || userProfile.uid}`)
        adicionarDiag('(No console: tenants → documento do condomínio → coleção pushTokens)')
        setSucesso('Token salvo! Notificações ativadas.')
        setPermissaoNotif('granted')
      } else {
        adicionarDiag(`❌ salvarTokenUsuario falhou: ${ultimoErroToken() || 'motivo desconhecido'}`)
      }

      // 7. Verificação no SERVIDOR via Admin SDK — mostra o que REALMENTE está
      // gravado no Firestore, independente do que o navegador vê.
      adicionarDiag('Consultando o servidor (dados reais do Firestore)...')
      const diag = await diagnosticarPush()
      if (diag?.erro) {
        adicionarDiag(`⚠️ Verificação no servidor falhou: ${diag.erro}`)
      } else {
        adicionarDiag(`📋 SERVIDOR — role: ${diag.perfil?.role ?? '?'} · condominioId: ${diag.tenantId ?? 'null'} · condomínio existe: ${diag.tenantExiste ?? '?'}${diag.tenantNome ? ` (${diag.tenantNome})` : ''}`)
        const lista = diag.pushTokens || []
        adicionarDiag(`📋 SERVIDOR — documentos pushTokens encontrados: ${lista.length}`)
        lista.forEach((t) => {
          adicionarDiag(`   • ${t.id}`)
          adicionarDiag(`     origem=${t.origem ?? '?'} · dispositivo=${t.dispositivo ?? '?'} · atualizadoEm=${t.atualizadoEm ?? '?'}`)
        })
      }
    } catch (err) {
      adicionarDiag(`❌ Erro: ${err.message}`)
    }
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
          <p className="sub">
            {somenteLeitura
              ? 'Consulte as informações do condomínio. Apenas o síndico pode alterá-las.'
              : 'Personalize o nome, logo e informações exibidas no sistema.'}
          </p>
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
                  <pre style={{ background: 'var(--paper)', padding: 10, borderRadius: 6, fontSize: 14.3, overflow: 'auto', marginTop: 8 }}>{REGRAS_FIRESTORE}</pre>
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
            {!somenteLeitura && (
              <>
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
              </>
            )}
          </div>
          {somenteLeitura ? (
            <p className="hint" style={{ marginTop: 12, color: 'var(--ink-soft)', fontSize: 15.6 }}>
              O logo é definido pelo síndico nas configurações.
            </p>
          ) : (
            <p className="hint" style={{ marginTop: 12, color: 'var(--ink-soft)', fontSize: 15.6 }}>
              PNG com fundo transparente é o ideal. A imagem é redimensionada para 300px automaticamente.
            </p>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 16 }}>Dados do condomínio</h3>
          {somenteLeitura ? (
            <>
              <div className="field">
                <label>Nome do condomínio</label>
                <input value={condominio?.nome || ''} readOnly disabled />
              </div>
              <div className="field">
                <label>Endereço</label>
                <input value={condominio?.endereco || ''} readOnly disabled />
              </div>
              {condominio?.codigo && (
                <div className="field">
                  <label>Código de acesso do condomínio</label>
                  <div className="codigo-visual">
                    <code>{condominio.codigo}</code>
                    <span>Use este código para criar a conta de outros moradores da família.</span>
                  </div>
                </div>
              )}
              <p className="hint" style={{ marginTop: 8, color: 'var(--ink-soft)', fontSize: 15.6 }}>
                Visualização somente leitura — solicite alterações ao síndico.
              </p>
            </>
          ) : (
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
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>Notificações push</h3>
        <p className="hint" style={{ marginBottom: 12, color: 'var(--ink-soft)', fontSize: 15.6 }}>
          Receba avisos de encomendas e visitantes mesmo com o app fechado. Ative em cada dispositivo que deve receber os avisos.
        </p>
        {permissaoNotif === 'granted' ? (
          <div className="notif-status notif-ok">
            <span className="notif-icone">✓</span>
            <span>Notificações ativadas neste dispositivo. Você receberá avisos de encomendas e visitantes.</span>
          </div>
        ) : permissaoNotif === 'denied' ? (
          <div className="notif-status notif-bloqueado">
            <span className="notif-icone">✗</span>
            <span>Notificações bloqueadas. Libere nas configurações do navegador/celular para receber os avisos.</span>
          </div>
        ) : (
          <div className="notif-status notif-pendente">
            <span className="notif-icone">⟳</span>
            <span>Notificações não ativadas. Toque no botão abaixo para ativar.</span>
          </div>
        )}
        <button
          type="button"
          className="btn btn-brass btn-block"
          onClick={executarDiagnostico}
          disabled={ativandoNotif || !userProfile?.condominioId}
        >
          {ativandoNotif ? 'Ativando...' : permissaoNotif === 'granted' ? 'Reativar notificações' : 'Ativar notificações neste dispositivo'}
        </button>
        {!userProfile?.condominioId && (
          <p className="hint" style={{ marginTop: 8, color: 'var(--ink-soft)', fontSize: 15.6 }}>
            Disponível para contas vinculadas a um condomínio.
          </p>
        )}
        {diagnostico.length > 0 && (
          <div className="diagnostico-lista">
            <strong>Diagnóstico:</strong>
            {diagnostico.map((linha, i) => (
              <div key={i} className={`diagnostico-linha ${linha.includes('❌') ? 'diag-erro' : linha.includes('✅') ? 'diag-ok' : ''}`}>
                {linha}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 4 }}>Tema de cores do sistema</h3>
        <p className="hint" style={{ marginBottom: 16, color: 'var(--ink-soft)', fontSize: 15.6 }}>
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