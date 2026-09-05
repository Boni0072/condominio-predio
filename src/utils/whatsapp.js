// Helpers de WhatsApp: normalização de telefone (padrão Brasil) e links wa.me

const DDI_BRASIL = '55'

// Mantém apenas os dígitos, aceitando formatos como "(11) 98765-4321" ou "+55 11 98765-4321"
export function digitosTelefone(valor) {
  return String(valor || '').replace(/\D/g, '')
}

// Normaliza para o formato internacional exigido pelo wa.me.
// Aceita DDD + número (10 ou 11 dígitos) e números já com DDI 55 (12 ou 13 dígitos).
// Retorna null quando o número não é um telefone brasileiro válido.
export function normalizarWhatsApp(valor) {
  const digitos = digitosTelefone(valor)
  if (!digitos) return null
  if (digitos.length === 12 || digitos.length === 13) {
    return digitos.startsWith(DDI_BRASIL) ? digitos : null
  }
  if (digitos.length === 10 || digitos.length === 11) {
    return DDI_BRASIL + digitos
  }
  return null
}

// Monta o link https://wa.me/<numero>?text=<mensagem> ou null se o telefone for inválido
export function whatsappUrl(telefone, texto = '') {
  const numero = normalizarWhatsApp(telefone)
  if (!numero) return null
  const query = texto ? `?text=${encodeURIComponent(texto)}` : ''
  return `https://wa.me/${numero}${query}`
}

// Formata para exibição: 5511987654321 -> (11) 98765-4321
export function formatarWhatsApp(valor) {
  const numero = normalizarWhatsApp(valor)
  if (!numero) return String(valor || '')
  const local = numero.startsWith(DDI_BRASIL) ? numero.slice(DDI_BRASIL.length) : numero
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
  }
  return numero
}
