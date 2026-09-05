import React, { useEffect, useState } from 'react'

// iOS/iPadOS Safari não dispara o evento beforeinstallprompt;
// nesses aparelhos mostramos as instruções de "Adicionar à Tela de Início".
function ehIos() {
  const ua = window.navigator.userAgent.toLowerCase()
  return /iphone|ipad|ipod/.test(ua) || (ua.includes('mac') && 'ontouchend' in document)
}

// Botão do menu lateral que instala o PWA na máquina (Windows, macOS, Linux,
// Android ou iPhone). Só aparece quando o navegador suporta a instalação e o
// app ainda não está instalado/rodando em modo aplicativo.
export default function BotaoInstalar() {
  const [evento, setEvento] = useState(null)
  const [podeInstalar, setPodeInstalar] = useState(false)
  const [instalado, setInstalado] = useState(false)
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
    if (evento) {
      evento.prompt()
      try {
        const { outcome } = await evento.userChoice
        if (outcome === 'accepted') setInstalado(true)
      } catch {
        // usuário fechou o diálogo sem decidir — mantém o botão
      }
      setEvento(null)
      return
    }
    if (ehIos()) setMostrarAjuda((v) => !v)
  }

  return (
    <div className="instalar-app">
      <button type="button" className="btn-instalar" onClick={instalar}>
        ⬇ Instalar aplicativo
      </button>
      {mostrarAjuda && (
        <div className="instalar-ajuda">
          No iPhone/iPad: toque no botão <strong>Compartilhar</strong> e depois em{' '}
          <strong>Adicionar à Tela de Início</strong>.
        </div>
      )}
    </div>
  )
}