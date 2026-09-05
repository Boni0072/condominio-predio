import React from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { whatsappUrl } from '../../utils/whatsapp.js'

// Encontra o morador cadastrado para a unidade informada (comparação ignorando espaços e caixa)
export function moradorDaUnidade(moradores, unidade) {
  const alvo = String(unidade || '').trim().toLowerCase()
  if (!alvo) return null
  return moradores.find((m) => String(m.unidade || '').trim().toLowerCase() === alvo) || null
}

// Botão que abre a conversa no WhatsApp com o morador da unidade da encomenda
export function AvisoEncomendaWhatsApp({ encomenda }) {
  const { moradores } = useApp()
  const morador = moradorDaUnidade(moradores, encomenda.unidade)
  const url = morador
    ? whatsappUrl(
        morador.whatsapp,
        `Olá, ${morador.nome}! Chegou uma encomenda para você na portaria${
          encomenda.transportadora ? ` (${encomenda.transportadora})` : ''
        }.`
      )
    : null

  if (!url) return null

  return (
    <a className="btn btn-whatsapp btn-small" href={url} target="_blank" rel="noreferrer">
      Avisar no WhatsApp
    </a>
  )
}
