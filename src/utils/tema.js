// Escalas de cores do sistema (temas). O accent dourado padrão é trocado por
// azul/verde; o restante da interface acompanha automaticamente, pois todos os
// estilos usam as variáveis CSS (--brass, --brass-dark, etc.).
export const TEMAS = [
  {
    id: 'classico',
    nome: 'Clássico',
    descricao: 'Dourado e grafite — o visual original do sistema.',
    amostras: ['#c9a227', '#a3811b', '#f7f0d8']
  },
  {
    id: 'oceano',
    nome: 'Oceano',
    descricao: 'Azul petróleo, ótimo para portaria e telas longas.',
    amostras: ['#35749c', '#27597a', '#dfeaf2']
  },
  {
    id: 'floresta',
    nome: 'Floresta',
    descricao: 'Verde suave, combina com áreas comuns e jardins.',
    amostras: ['#3f8262', '#2f6349', '#e0efe6']
  }
]

const TEMA_PADRAO = 'classico'
const CHAVE_TEMA = 'condominio-tema-cores'
const CHAVE_CORES = 'condominio-cores-personalizadas'
const CORES_PADRAO = { principal: '#c9a227', escura: '#a3811b', suave: '#f7f0d8' }

function idsValidos() {
  return [...TEMAS.map((tema) => tema.id), 'personalizado']
}

export function temaSalvo() {
  try {
    const salvo = localStorage.getItem(CHAVE_TEMA)
    return idsValidos().includes(salvo) ? salvo : TEMA_PADRAO
  } catch {
    return TEMA_PADRAO
  }
}

function hexValido(valor) {
  return typeof valor === 'string' && /^#[0-9a-fA-F]{6}$/.test(valor.trim())
}

function normalizarCores(cores) {
  return {
    principal: hexValido(cores?.principal) ? cores.principal.trim().toLowerCase() : CORES_PADRAO.principal,
    escura: hexValido(cores?.escura) ? cores.escura.trim().toLowerCase() : CORES_PADRAO.escura,
    suave: hexValido(cores?.suave) ? cores.suave.trim().toLowerCase() : CORES_PADRAO.suave
  }
}

function hexParaRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  }
}

// Luminância relativa (WCAG): define se o texto sobre a cor principal deve ser
// escuro (cores claras, como o dourado) ou branco (cores fechadas, azul/verde).
function luminancia(hex) {
  const { r, g, b } = hexParaRgb(hex)
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const canal = v / 255
    return canal <= 0.03928 ? canal / 12.92 : Math.pow((canal + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

const VARIAVEIS_TEMA = [
  '--brass',
  '--brass-dark',
  '--brass-soft',
  '--brass-contrast',
  '--brass-tint-12',
  '--brass-tint-14',
  '--brass-tint-24',
  '--brass-tint-45'
]

function limparCoresPersonalizadas() {
  VARIAVEIS_TEMA.forEach((variavel) => document.documentElement.style.removeProperty(variavel))
}

export function coresPersonalizadas() {
  try {
    return normalizarCores(JSON.parse(localStorage.getItem(CHAVE_CORES) || '{}'))
  } catch {
    return { ...CORES_PADRAO }
  }
}

// Aplica as cores do tema "Personalizado" via variáveis inline no <html>
// (sobrepõem qualquer tema do CSS) e salva a preferência do dispositivo.
export function aplicarCoresPersonalizadas(cores) {
  const limpas = normalizarCores(cores)
  const raiz = document.documentElement
  const { r, g, b } = hexParaRgb(limpas.principal)
  raiz.dataset.theme = 'personalizado'
  raiz.style.setProperty('--brass', limpas.principal)
  raiz.style.setProperty('--brass-dark', limpas.escura)
  raiz.style.setProperty('--brass-soft', limpas.suave)
  raiz.style.setProperty('--brass-contrast', luminancia(limpas.principal) > 0.35 ? '#1c2b33' : '#ffffff')
  raiz.style.setProperty('--brass-tint-12', `rgba(${r}, ${g}, ${b}, 0.12)`)
  raiz.style.setProperty('--brass-tint-14', `rgba(${r}, ${g}, ${b}, 0.14)`)
  raiz.style.setProperty('--brass-tint-24', `rgba(${r}, ${g}, ${b}, 0.24)`)
  raiz.style.setProperty('--brass-tint-45', `rgba(${r}, ${g}, ${b}, 0.45)`)
  try {
    localStorage.setItem(CHAVE_CORES, JSON.stringify(limpas))
  } catch {
    // localStorage indisponível: cores valem apenas nesta sessão.
  }
  return limpas
}

// Aplica o tema no <html> (data-theme) e salva a preferência deste dispositivo.
export function aplicarTema(id) {
  const tema = idsValidos().includes(id) ? id : TEMA_PADRAO
  limparCoresPersonalizadas()
  document.documentElement.dataset.theme = tema
  if (tema === 'personalizado') {
    aplicarCoresPersonalizadas(coresPersonalizadas())
  } else {
    try {
      localStorage.setItem(CHAVE_TEMA, tema)
    } catch {
      // localStorage indisponível (navegador restrito): aplica só nesta sessão.
    }
  }
  return tema
}

export function iniciarTema() {
  aplicarTema(temaSalvo())
}