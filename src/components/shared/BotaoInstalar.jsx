import React, { useEffect, useState, useCallback } from 'react'
import { solicitarPermissao } from '../../utils/notificacao.js'
import { salvarTokenUsuario } from '../../utils/push.js'

// iOS/iPadOS Safari não dispara o evento beforeinstallprompt
function ehIos() {
  const ua = window.navigator.userAgent.toLowerCase()
  return /iphone|ipad|ipod/.test(ua) || (ua.includes('mac') && 'ontouchend' in document)
}

// Modal que explica e solicita permissões antes de instalar
function PermissoesModal({ onAceitar, onFechar, userProfile }) {
  const [etapa, setEtapa] = useState('explicacao')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  const handleAceitar = useCallback(async () => {
    setCarregando(true)
    setErro('')
    try {
      const resultado = await solicitarPermissao()
      if (resultado === 'granted') {
        if (userProfile?.condominioId && userProfile?.uid) {
          await salvarTokenUsuario(userProfile.condominioId, userProfile.uid, {
            dispositivo: navigator.platform || 'desconhecido'
          })
        }
        setEtapa('sucesso')
        setTimeout(() => onAceitar(), 1200)
      } else if (resultado === 'denied') {
        setErro('Permissão negada. Para receber notificações, libere nas configurações do navegador.')
      } else {
        setErro('Não foi possível solicitar a permissão. Tente novamente.')
      }
    } catch {
      setErro('Erro ao solicitar permissão.')
    }
    setCarregando(false)
  }, [onAceitar, userProfile])

  return (
    <div className="permissoes-overlay" onClick={onFechar}>
      <div className="permissoes-modal" onClick={(e) => e.stopPropagation()}>
        {etapa === 'explicacao' && (
          <>
            <div className="permissoes-icone">🔔</div>
            <h3>Ativar notificações</h3>
            <p>
              Para receber avisos de <strong>encomendas</strong> e <strong>visitantes</strong> em
              tempo real, precisamos de duas permissões:
            </p>
            <ul className="permissoes-lista">
              <li>
                <span className="permissoes-item-icone">📩</span>
                <span>
                  <strong>Notificações</strong> — exibe alertas na tela do celular
                </span>
              </li>
              <li>
                <span className="permissoes-item-icone">⚙️</span>
                <span>
                  <strong>Segundo plano</strong> — mantém o app ativo para receber avisos mesmo
                  fechado
                </span>
              </li>
            </ul>
            {erro && <div className="permissoes-erro">{erro}</div>}
            <div className="permissoes-botoes">
              <button type="button" className="btn btn-ghost" onClick={onFechar}>
                Agora não
              </button>
              <button
                type="button"
                className="btn btn-brass"
                onClick={handleAceitar}
                disabled={carregando}
              >
                {carregando ? 'Ativando...' : 'Ativar e instalar'}
              </button>
            </div>
          </>
        )}
        {etapa === 'sucesso' && (
          <>
            <div className="permissoes-icone permissoes-ok">✓</div>
            <h3>Tudo pronto!</h3>
            <p>Notificações ativadas. O app será instalado agora.</p>
          </>
        )}
      </div>
    </div>
  )
}

// Botão do menu lateral que instala o PWA na máquina
export default function BotaoInstalar({ userProfile }) {
  const [evento, setEvento] = useState(null)
  const [podeInstalar, setPodeInstalar] = useState(false)
  const [instalado, setInstalado] = useState(false)
  const [mostrarPermissoes, setMostrarPermissoes] = useState(false)
  const [mostrarAjuda, setMostrarAjuda] = useState(false)

  useEffect(() => {
    const emModoApp =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.navigator.standalone === true
    if (emModoApp) {
      setInstalado(true)
      return
    }

    function capturar(e) {
      e.preventDefault()
      setEvento(e)
      setPodeInstalar(true)
    }
    function aoInstalar() {
      setInstalado(true)
      setPodeInstalar(false)
    }
    window.addEventListener('beforeinstallprompt', capturar)
    window.addEventListener('appinstalled', aoInstalar)
    return () => {
      window.removeEventListener('beforeinstallprompt', capturar)
      window.removeEventListener('appinstalled', aoInstalar)
    }
  }, [])

  if (instalado || (!podeInstalar && !ehIos())) return null

  async function instalar() {
    if (ehIos()) {
      setMostrarAjuda((v) => !v)
      return
    }
    if (evento) {
      setMostrarPermissoes(true)
    }
  }

  async function handlePermissoesAceitas() {
    setMostrarPermissoes(false)
    if (evento) {
      evento.prompt()
      try {
        const { outcome } = await evento.userChoice
        if (outcome === 'accepted') {
          setInstalado(true)
        }
      } catch {
        // usuário fechou o diálogo sem decidir — mantém o botão
      }
      setEvento(null)
    }
  }

  return (
    <div className="instalar-app">
      {mostrarPermissoes && (
        <PermissoesModal
          userProfile={userProfile}
          onAceitar={handlePermissoesAceitas}
          onFechar={() => setMostrarPermissoes(false)}
        />
      )}
      <button type="button" className="btn-instalar" onClick={instalar}>
        ⬇ Instalar aplicativo
      </button>
      {mostrarAjuda && (
        <div className="instalar-ajuda">
          No iPhone/iPad: toque no botão <strong>Compartilhar</strong> e depois em{' '}
          <strong>Adicionar à Tela de Início</strong>. Após instalar, abra o app e vá em{' '}
          <strong>Configurações → Notificações</strong> para ativar os alertas.
        </div>
      )}
    </div>
  )
}
