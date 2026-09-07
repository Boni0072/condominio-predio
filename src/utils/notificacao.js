// Utilitário de notificações push para o PWA

// Verifica se o navegador suporta notificações
export function notificacoesSuportadas() {
  return 'Notification' in window
}

// Verifica se o service worker está ativo
export function serviceWorkerAtivo() {
  return 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null
}

// Solicita permissão para enviar notificações
export async function solicitarPermissao() {
  if (!notificacoesSuportadas()) {
    console.warn('[NOTIFICAÇÃO] Navegador não suporta notificações.')
    return 'unsupported'
  }

  if (Notification.permission === 'granted') return 'granted'

  if (Notification.permission === 'denied') {
    console.warn('[NOTIFICAÇÃO] Permissão de notificação negada pelo usuário.')
    return 'denied'
  }

  try {
    const permissao = await Notification.requestPermission()
    return permissao
  } catch (err) {
    console.error('[NOTIFICAÇÃO] Erro ao solicitar permissão:', err)
    return 'error'
  }
}

// Envia uma notificação (usa o service worker se o app estiver em segundo plano)
export async function enviarNotificacao(titulo, opcoes = {}) {
  if (!notificacoesSuportadas()) return false
  if (Notification.permission !== 'granted') return false

  const padrao = {
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'pt-BR',
    renotify: true,
    tag: 'condominio-notificacao',
    requireInteraction: false
  }

  const config = { ...padrao, ...opcoes }

  try {
    // Se o app está em segundo plano, usa o service worker
    if (serviceWorkerAtivo() && document.visibilityState === 'hidden') {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(titulo, config)
    } else {
      // App em primeiro plano ou SW não ativo — usa Notification direto
      new Notification(titulo, config)
    }
    return true
  } catch (err) {
    console.error('[NOTIFICAÇÃO] Erro ao enviar notificação:', err)
    return false
  }
}

// Notificação específica para nova encomenda
export function notificarNovaEncomenda(encomenda) {
  const titulo = `📦 Nova encomenda recebida`
  const corpo = encomenda.destinatario
    ? `${encomenda.destinatario} · ${encomenda.unidade}${encomenda.transportadora ? ` · ${encomenda.transportadora}` : ''}`
    : `${encomenda.unidade}${encomenda.transportadora ? ` · ${encomenda.transportadora}` : ''}`

  return enviarNotificacao(titulo, {
    body: corpo,
    tag: `encomenda-${encomenda.id}`,
    data: {
      tipo: 'encomenda',
      id: encomenda.id,
      url: '/#/portaria/encomendas'
    }
  })
}

// Notificação para novo visitante
export function notificarNovoVisitante(visitante) {
  const titulo = `👤 Visitante na portaria`
  const corpo = `${visitante.nome} · ${visitante.unidade} · ${visitante.motivo || 'visita'}`

  return enviarNotificacao(titulo, {
    body: corpo,
    tag: `visitante-${visitante.id}`,
    data: {
      tipo: 'visitante',
      id: visitante.id,
      url: '/#/portaria/visitantes'
    }
  })
}
