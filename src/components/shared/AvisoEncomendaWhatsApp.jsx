import React, { useState } from 'react'
import { useApp } from '../../context/AppContext.jsx'
import { whatsappUrl, formatarWhatsApp } from '../../utils/whatsapp.js'
import { formatDateTime } from '../../utils/storage.js'

// Encontra o morador cadastrado para a unidade informada (comparação ignorando espaços e caixa)
export function moradorDaUnidade(moradores, unidade) {
  const alvo = String(unidade || '').trim().toLowerCase()
  if (!alvo) return null
  return moradores.find((m) => String(m.unidade || '').trim().toLowerCase() === alvo) || null
}

// Encontra o usuário cadastrado para a unidade informada (comparação ignorando espaços e caixa)
function usuarioDaUnidade(usuarios, unidade) {
  const alvo = String(unidade || '').trim().toLowerCase()
  if (!alvo) return null
  return usuarios.find((u) => String(u.unidade || '').trim().toLowerCase() === alvo && u.whatsapp) || null
}

// Converte um data URL para um arquivo File (usado no compartilhamento nativo)
function dataUrlParaFile(dataUrl, nomeArquivo) {
  const arr = dataUrl.split(',')
  const mimeMatch = arr[0].match(/:(.*?);/)
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg'
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n)
  }
  return new File([u8arr], nomeArquivo, { type: mime })
}

// Formata a data/hora da encomenda para exibição na mensagem
function formatarDataHoraEncomenda(chegadaEm) {
  try {
    const data = new Date(chegadaEm)
    if (isNaN(data.getTime())) return ''
    return data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return ''
  }
}

// Monta a mensagem de texto da encomenda com data, hora e informação da foto
function montarMensagemEncomenda(encomenda, contato) {
  const partes = []
  partes.push(`Olá, ${contato.nome}!`)
  partes.push('')
  partes.push('Chegou uma encomenda para você na portaria.')

  if (encomenda.transportadora) {
    partes.push(`Transportadora: ${encomenda.transportadora}`)
  }

  const dataHora = formatarDataHoraEncomenda(encomenda.chegadaEm)
  if (dataHora) {
    partes.push(`Recebida em: ${dataHora}`)
  }

  if (encomenda.foto) {
    partes.push('📷 Foto da encomenda em anexo.')
  }

  partes.push('')
  partes.push('Pode retirar na portaria quando conveniente.')

  return partes.join('\n')
}

// Botão que envia notificação por WhatsApp com foto, data e hora da encomenda
export function AvisoEncomendaWhatsApp({ encomenda, onAviso }) {
  const { moradores, usuarios } = useApp()
  const [enviando, setEnviando] = useState(false)

  const contato = moradorDaUnidade(moradores, encomenda.unidade) || usuarioDaUnidade(usuarios, encomenda.unidade)

  if (!contato) return null

  const mensagem = montarMensagemEncomenda(encomenda, contato)
  const numeroWhats = formatarWhatsApp(contato.whatsapp)
  const urlWhats = whatsappUrl(contato.whatsapp, mensagem)

  // Registra que o aviso foi enviado (data/hora)
  function registrarAviso() {
    if (onAviso) onAviso()
  }

  // Tenta usar Web Share API (celular) para compartilhar texto + foto
  async function compartilharComFoto(e) {
    if (!encomenda.foto) return // sem foto, usa o link wa.me normalmente

    setEnviando(true)
    try {
      const compartilhamento = {
        text: mensagem,
        title: `Encomenda - ${contato.nome}`,
      }

      // Se tiver foto e o navegador suportar compartilhamento de arquivos
      if (encomenda.foto && navigator.canShare) {
        const arquivo = dataUrlParaFile(encomenda.foto, `encomenda-${contato.nome.replace(/\s+/g, '-')}.jpg`)
        const arquivos = [arquivo]
        if (navigator.canShare({ files: arquivos })) {
          compartilhamento.files = arquivos
        }
      }

      if (compartilhamento.files) {
        await navigator.share(compartilhamento)
        registrarAviso()
        return // compartilhou nativamente, não precisa abrir wa.me
      }
    } catch (err) {
      // Usuário cancelou ou erro — cai no fallback wa.me
      if (err.name !== 'AbortError') {
        console.warn('Compartilhamento nativo falhou, usando wa.me:', err)
      }
    } finally {
      setEnviando(false)
    }
  }

  // Se tem foto, tenta compartilhamento nativo; senão, abre wa.me direto
  const temFoto = Boolean(encomenda.foto)

  async function handleClick(e) {
    // Registra o aviso ANTES de navegar
    registrarAviso()

    if (temFoto) {
      e.preventDefault() // impede navegação imediata
      await compartilharComFoto()
      // Se o compartilhamento nativo não abriu, abre wa.me
      if (!navigator.canShare || !navigator.canShare({ files: [dataUrlParaFile(encomenda.foto, 'test')] })) {
        window.open(urlWhats, '_blank', 'noopener,noreferrer')
      }
    }
    // Sem foto: navegação normal pelo href
  }

  return (
    <a
      className="btn btn-whatsapp btn-small"
      href={urlWhats}
      target="_blank"
      rel="noreferrer"
      onClick={handleClick}
      title={`WhatsApp: ${numeroWhats}`}
    >
      {enviando ? 'Enviando...' : 'Avisar encomenda'}
    </a>
  )
}

// Botão que abre a conversa no WhatsApp para avisar o morador sobre visitante
export function AvisoVisitanteWhatsApp({ visitante }) {
  const { moradores, usuarios } = useApp()
  // Prioriza o morador que autorizou, depois qualquer morador/usuário da unidade
  const alvo = visitante.autorizadoPor
    ? (moradores.find((m) => m.nome?.toLowerCase() === visitante.autorizadoPor?.toLowerCase())
      || usuarios.find((u) => u.nome?.toLowerCase() === visitante.autorizadoPor?.toLowerCase()))
    : null
  const contato = alvo
    || moradorDaUnidade(moradores, visitante.unidade)
    || usuarioDaUnidade(usuarios, visitante.unidade)
  const url = contato
    ? whatsappUrl(
        contato.whatsapp,
        `Olá, ${contato.nome}! ${visitante.nome} está na portaria para te visitar (${visitante.motivo || 'visita'}).`
      )
    : null

  if (!url) return null

  return (
    <a className="btn btn-whatsapp btn-small" href={url} target="_blank" rel="noreferrer">
      Avisar visitante
    </a>
  )
}
