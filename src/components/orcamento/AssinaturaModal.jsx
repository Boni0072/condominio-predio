import React, { useEffect, useRef, useState } from 'react'

const COR_TINTA = '#1c2b33'

// Modal genérico de assinatura (usado na aprovação de orçamento pelos conselheiros).
// Captura a assinatura em um canvas e devolve o data URL no onConfirmar.
export default function AssinaturaModal({ titulo, subtitulo, onConfirmar, onCancelar }) {
  const canvasRef = useRef(null)
  const desenhandoRef = useRef(false)
  const ultimoPontoRef = useRef(null)
  const [pronta, setPronta] = useState(false)

  // Prepara o canvas: fundo branco e traço com as cores do sistema
  useEffect(() => {
    const canvas = canvasRef.current
    canvas.width = canvas.clientWidth || 560
    canvas.height = 180
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.strokeStyle = COR_TINTA
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [])

  function posicaoDoEvento(e) {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height
    }
  }

  function aoPressionar(e) {
    e.preventDefault()
    canvasRef.current.setPointerCapture(e.pointerId)
    desenhandoRef.current = true
    const p = posicaoDoEvento(e)
    ultimoPontoRef.current = p
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + 0.1, p.y + 0.1)
    ctx.stroke()
    setPronta(true)
  }

  function aoMover(e) {
    if (!desenhandoRef.current) return
    e.preventDefault()
    const p = posicaoDoEvento(e)
    const anterior = ultimoPontoRef.current || p
    const ctx = canvasRef.current.getContext('2d')
    ctx.beginPath()
    ctx.moveTo(anterior.x, anterior.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ultimoPontoRef.current = p
  }

  function aoSoltar() {
    desenhandoRef.current = false
    ultimoPontoRef.current = null
  }

  function limpar() {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setPronta(false)
  }

  function confirmar() {
    if (!pronta) return
    onConfirmar(canvasRef.current.toDataURL('image/png'))
  }

  return (
    <div className="modal-overlay" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Assinar aprovação">
        <div className="modal-header">
          <h2>{titulo}</h2>
          <button type="button" className="modal-fechar" onClick={onCancelar} aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="modal-body">
          {subtitulo && <p className="modal-info">{subtitulo}</p>}
          <div className="field">
            <label>Assinatura do conselheiro / aprovador</label>
            <canvas
              ref={canvasRef}
              className="assinatura-canvas"
              onPointerDown={aoPressionar}
              onPointerMove={aoMover}
              onPointerUp={aoSoltar}
              onPointerCancel={aoSoltar}
            />
            <p className="assinatura-dica">Desenhe a assinatura com o dedo ou o mouse.</p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost btn-small" onClick={limpar}>
              Limpar
            </button>
            <button type="button" className="btn btn-ghost" onClick={onCancelar}>
              Cancelar
            </button>
            <button type="button" className="btn btn-brass" onClick={confirmar} disabled={!pronta}>
              Confirmar assinatura
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}