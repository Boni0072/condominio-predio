const PREFIX = 'condo_'

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // storage unavailable (private mode, quota) — fail silently, app still works in-memory
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function nowISO() {
  return new Date().toISOString()
}

export function formatDateTime(iso) {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export function formatDate(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
}

// Rótulo das barras do gráfico Orçado x realizado: valor integral em R$
// (ex.: 15000 → "R$ 15.000,00"). Com { simbolo: false } remove o prefixo
// "R$" (ex.: 15000 → "15.000") e com { escala: 1000 } divide o valor por 1000
// (ex.: 15000 → "15") — usado no gráfico Orçado x realizado do painel.
export function formatRotuloGrafico(value, { simbolo = true, escala = 1 } = {}) {
  const numero = (Number(value) || 0) / (escala || 1)
  if (numero <= 0) return ''
  const maxFrac = escala > 1 ? 1 : 0
  if (!simbolo) return numero.toLocaleString('pt-BR', { maximumFractionDigits: maxFrac })
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: maxFrac })
}

export function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthKey(value) {
  if (!value) return ''
  if (typeof value === 'string') {
    const iso = value.match(/^(\d{4})-(\d{2})/)
    if (iso) return `${iso[1]}-${iso[2]}`
    const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (br) return `${br[3]}-${br[2]}`
  }
  const date = value?.toDate ? value.toDate() : new Date(value)
  if (isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
