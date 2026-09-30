// Utils compartilhados pelas telas de cobrança, consulta e PIX. O documento
// oficial de uma cobrança é tenants/{condominioId}/boletos.

export function gerarNossoNumero(sequencial) {
  // Gera um nosso número de 7 dígitos com dígito verificador. Quando não é
  // informado um sequencial (caso normal da emissão), sorteia um número — é um
  // identificador de controle interno do condomínio, não de registro bancário.
  const base = sequencial != null && String(sequencial).trim() !== ''
    ? String(sequencial)
    : String(Math.floor(Math.random() * 9999999) + 1)
  const numeroBase = base.replace(/\D/g, '').padStart(7, '0').slice(-7)
  const dv = calcularDigitoVerificador(numeroBase)
  return `${numeroBase}-${dv}`
}

export function calcularDigitoVerificador(numero) {
  // Algoritmo de módulo 11 para dígito verificador
  let soma = 0
  let peso = 2
  for (let i = numero.length - 1; i >= 0; i--) {
    soma += parseInt(numero[i]) * peso
    peso++
  }
  const resto = soma % 11
  if (resto < 2) return 0
  return 11 - resto
}

// Aceita number ou string ("120,50" vindo de input) sem estourar quando o
// valor ainda não foi preenchido pelo usuário.
export function formatarValorBoleto(valor) {
  const numero = typeof valor === 'string'
    ? Number(valor.replace(',', '.'))
    : Number(valor)
  return (Number.isFinite(numero) ? numero : 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  })
}

export function formatarDataVencimento(data) {
  if (!data) return '-'
  const d = new Date(data)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

// ---------- Boleto: código de barras e linha digitável ----------
// BOLETO DE DEMONSTRAÇÃO (sem registro em banco): os números abaixo seguem a
// ESTRUTURA de um boleto de cobrança (44 posições no código de barras e 47 na
// linha digitável), mas são calculados dentro do próprio app a partir da
// cobrança do condomínio — o condomínio não tem convênio de registro bancário.
// Servem para identificar/conferir a cobrança e imprimir um boleto de
// demonstração; NÃO TENTE PAGAR com eles no banco/app do banco — o banco vai
// recusar ("boleto inválido/inexistente"). O pagamento continua pelo PIX (ou
// na administração). Para um boleto PAGÁVEL de verdade, o síndico precisa
// clicar em "Registrar no Mercado Pago": aí o código de barras/linha passa a
// vir do BANCO (campos codigoBarras/linhaDigitavel da cobrança).
// IMPORTANTE: o cálculo é 100% local e NÃO grava nada no Firestore — o morador
// Firestore — o morador não tem (e não deve ter) permissão de escrita em
// tenants/{condominioId}/boletos.

const DATA_BASE_FATOR_VENCIMENTO = Date.UTC(1997, 9, 7) // 07/10/1997 (FEBRABAN)
const MS_POR_DIA = 24 * 60 * 60 * 1000

// "1.234,56", "R$ 1234,56" ou 1234.56 → 123456 (centavos). Nunca lança erro.
function valorEmCentavos(valor) {
  const numero = typeof valor === 'string'
    ? Number(valor.replace(/R\$\s?/gi, '').replace(/\./g, '').replace(',', '.').trim())
    : Number(valor)
  if (!Number.isFinite(numero) || numero <= 0) return 0
  return Math.round(numero * 100)
}

// Somente dígitos, sempre com o tamanho pedido (zeros à esquerda). Valores
// ausentes viram zeros — é o que evita o "undefined.replace(...)" que existia
// em gerarLinhaDigitavel quando o boleto ainda não tinha nosso número.
export function somenteDigitosBoleto(valor, tamanho) {
  return String(valor ?? '')
    .replace(/\D/g, '')
    .slice(0, tamanho)
    .padStart(tamanho, '0')
}

// Nosso número sem o dígito verificador da emissão ("0000123-4" → "0000123").
export function normalizarNossoNumero(nossoNumero) {
  return somenteDigitosBoleto(String(nossoNumero ?? '').split('-')[0], 7)
}

// Dados mínimos para montar o boleto: banco, agência e conta cadastrados pelo
// síndico em Pagamentos › Configurar Contas.
export function temDadosBancarios({ banco, agencia, conta } = {}) {
  return [banco, agencia, conta].every((valor) => String(valor ?? '').replace(/\D/g, '').length > 0)
}

// Fator de vencimento: dias desde 07/10/1997 (padrão FEBRABAN). Data ausente ou
// inválida vira 0 em vez de lançar erro.
export function calcularFatorVencimento(dataVencimento) {
  const iso = String(dataVencimento ?? '').slice(0, 10)
  const data = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(dataVencimento)
  if (isNaN(data.getTime())) return 0
  const dias = Math.floor((Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()) - DATA_BASE_FATOR_VENCIMENTO) / MS_POR_DIA)
  return dias > 0 ? dias % 10000 : 0
}

// Fator FEBRABAN → data de vencimento (Date UTC ou null quando não há data).
// Regra: dias desde 07/10/1997, mas o campo tem só 4 dígitos — a cada 10000
// dias (~27 anos) o ciclo reinicia. O fator 9999 estourou em 21/02/2025, então
// hoje vale o SEGUNDO ciclo: 0000–9999 = 22/02/2025 a 09/07/2052. Por isso
// 0595 = 10/10/2026 (e não 1999) quando a cobrança vence em 2026. Sem data de
// referência, resolve-se pelo ciclo mais próximo de hoje; com dataVencimento
// da cobrança, usa-se o ciclo mais próximo dela (fonte mais confiável).
export function dataDoFatorVencimento(fator, referencia) {
  const numero = Number(String(fator ?? '').replace(/\D/g, ''))
  if (!Number.isFinite(numero) || numero <= 0 || numero >= 10000) return null
  const CICLO = 10000 * MS_POR_DIA
  let refMs = Date.now()
  if (referencia) {
    const iso = String(referencia).slice(0, 10)
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(referencia)
    if (!isNaN(parsed.getTime())) refMs = Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())
  }
  // Candidatos: ciclo original (1997–2025), ciclo atual (2025–2052) e próximo.
  const base = DATA_BASE_FATOR_VENCIMENTO + numero * MS_POR_DIA
  const candidatos = [base - CICLO, base, base + CICLO, base + 2 * CICLO].filter((ms) => ms >= DATA_BASE_FATOR_VENCIMENTO)
  let melhor = candidatos[0]
  for (const ms of candidatos) {
    if (Math.abs(ms - refMs) < Math.abs(melhor - refMs)) melhor = ms
  }
  return new Date(melhor)
}

// Situação do vencimento embutido no código de barras/linha: { estado, data }.
// estado: 'sem-vencimento' | 'vencido' | 'vence-hoje' | 'a-vencer'. Também
// aceita a data ISO da cobrança (boleto.dataVencimento) como referência para
// resolver o ciclo do fator — sem ela, usa-se hoje como referência.
export function analisarVencimentoBoleto({ fator, dataVencimento } = {}) {
  let data = dataDoFatorVencimento(fator, dataVencimento || undefined)
  if (!data && dataVencimento) {
    const iso = String(dataVencimento).slice(0, 10)
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(dataVencimento)
    if (!isNaN(parsed.getTime())) data = new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()))
  }
  if (!data) return { estado: 'sem-vencimento', data: null }
  const hoje = new Date()
  const inicioHoje = Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const diaVenc = Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate())
  if (diaVenc < inicioHoje) return { estado: 'vencido', data }
  if (diaVenc === inicioHoje) return { estado: 'vence-hoje', data }
  return { estado: 'a-vencer', data }
}

// DV geral do código de barras: módulo 11 com pesos 2..9 (da direita para a
// esquerda) e a regra bancária de que 0, 10 e 11 viram 1.
function digitoVerificadorBarras(numero) {
  const digitos = String(numero ?? '').replace(/\D/g, '')
  let soma = 0
  let peso = 2
  for (let i = digitos.length - 1; i >= 0; i--) {
    soma += Number(digitos[i]) * peso
    peso = peso === 9 ? 2 : peso + 1
  }
  const dv = 11 - (soma % 11)
  return dv === 0 || dv > 9 ? 1 : dv
}

// DV dos campos 1, 2 e 3 da linha digitável: módulo 10 (pesos 2 e 1).
export function digitoModulo10(numero) {
  const digitos = String(numero ?? '').replace(/\D/g, '')
  let soma = 0
  let peso = 2
  for (let i = digitos.length - 1; i >= 0; i--) {
    const produto = Number(digitos[i]) * peso
    soma += produto > 9 ? produto - 9 : produto
    peso = peso === 2 ? 1 : 2
  }
  return (10 - (soma % 10)) % 10
}

// Campo livre (25 posições): carteira (3) + agência (4) + conta (11) +
// nosso número (7).
function montarCampoLivre({ carteira, agencia, conta, nossoNumero }) {
  return somenteDigitosBoleto(carteira || 17, 3)
    + somenteDigitosBoleto(agencia, 4)
    + somenteDigitosBoleto(conta, 11)
    + normalizarNossoNumero(nossoNumero)
}

// Código de barras (44 dígitos): banco (3) + moeda (1) + DV geral (1) + fator
// de vencimento (4) + valor (10) + campo livre (25). Sem banco, agência ou
// conta cadastrados devolve '' — a tela avisa que o boleto ainda não foi
// configurado, em vez de exibir um número sem significado.
export function gerarCodigoBarras({ banco, agencia, conta, carteira, nossoNumero, valor, dataVencimento } = {}) {
  if (!temDadosBancarios({ banco, agencia, conta })) return ''
  const semDv = `${somenteDigitosBoleto(banco, 3)}9${somenteDigitosBoleto(calcularFatorVencimento(dataVencimento), 4)}${somenteDigitosBoleto(valorEmCentavos(valor), 10)}${montarCampoLivre({ carteira, agencia, conta, nossoNumero })}`
  return `${semDv.slice(0, 4)}${digitoVerificadorBarras(semDv)}${semDv.slice(4)}`
}

// Validação completa de um código de barras de boleto cobrança (44 dígitos).
// Devolve { ok, erros[] } para a tela explicar ANTES de imprimir/tentar pagar
// — evita o "COD.BARRAS INVALIDO" só na hora do banco.
export function validarCodigoBarras(codigo) {
  const digitos = String(codigo ?? '').replace(/\D/g, '')
  const erros = []
  if (!digitos) return { ok: false, digitos: '', erros: ['Código de barras vazio.'] }
  if (!/^\d+$/.test(digitos)) erros.push('Código de barras deve conter só números.')
  if (digitos.length !== 44) erros.push(`Código de barras deve ter 44 dígitos (encontrados ${digitos.length}).`)
  if (digitos.length === 44) {
    const banco = digitos.slice(0, 3)
    const moeda = digitos[3]
    const dv = Number(digitos[4])
    const fator = digitos.slice(5, 9)
    const valor = digitos.slice(9, 19)
    // Códigos de compensação (COMPE) válidos no Brasil. "123" do aviso não
    // existe — nenhum banco responde por ele, então o caixa recusa na hora.
    const BANCOS_VALIDOS = new Set(['001', '033', '104', '237', '341', '041', '077', '260', '336', '707', '422', '745', '021', '025', '036', '037', '085', '211', '212', '218', '222', '224', '318', '323', '330', '340', '356', '366', '370', '376', '389', '453', '454', '477', '479', '487', '488', '494', '623', '626', '633', '634', '637', '638', '641', '643', '652', '653', '654', '655'])
    if (!BANCOS_VALIDOS.has(banco)) erros.push(`Banco "${banco}" inválido ou inexistente na compensação (COMPE).`)
    if (moeda !== '9') erros.push(`Moeda deve ser 9 (Real); encontrado "${moeda}".`)
    const semDv = digitos.slice(0, 4) + digitos.slice(5)
    if (digitoVerificadorBarras(semDv) !== dv) erros.push(`Dígito verificador geral inválido (posição 5: esperado ${digitoVerificadorBarras(semDv)}, encontrado ${dv}).`)
    if (fator === '0000') erros.push('Fator de vencimento zerado — boleto sem vencimento válido.')
    if (valor === '0000000000') erros.push('Valor zerado — boleto sem valor.')
  }
  return { ok: erros.length === 0, digitos, erros }
}

// Valida a linha digitável (47 dígitos, com ou sem pontos/espaços): tamanho,
// DVs módulo 10 dos 3 campos e coerência com o código de barras que a gerou.
export function validarLinhaDigitavel(linha, codigoBarras) {
  const digitos = String(linha ?? '').replace(/\D/g, '')
  const erros = []
  if (!digitos) return { ok: false, digitos: '', erros: ['Linha digitável vazia.'] }
  if (digitos.length !== 47) {
    return { ok: false, digitos, erros: [`Linha digitável deve ter 47 dígitos (encontrados ${digitos.length}).`] }
  }
  const campoLivre = String(codigoBarras ?? '').replace(/\D/g, '').slice(19)
  const blocos = [
    { rotulo: '1º campo', base: digitos.slice(0, 9), dv: Number(digitos[9]) },
    { rotulo: '2º campo', base: digitos.slice(10, 20), dv: Number(digitos[20]) },
    { rotulo: '3º campo', base: digitos.slice(21, 31), dv: Number(digitos[31]) },
  ]
  blocos.forEach(({ rotulo, base, dv }) => {
    if (digitoModulo10(base) !== dv) {
      erros.push(`Dígito do ${rotulo} da linha digitável inválido (esperado ${digitoModulo10(base)}, encontrado ${dv}).`)
    }
  })
  const barras = String(codigoBarras ?? '').replace(/\D/g, '')
  if (barras.length === 44) {
    const base1 = `${barras.slice(0, 3)}${barras[3]}${campoLivre.slice(0, 5)}`
    const base2 = campoLivre.slice(5, 15)
    const base3 = campoLivre.slice(15)
    const esperado = `${base1}${digitoModulo10(base1)}${base2}${digitoModulo10(base2)}${base3}${digitoModulo10(base3)}${barras[4]}${barras.slice(5, 19)}`
    if (digitos !== esperado && erros.length === 0) erros.push('Linha digitável não confere com o código de barras.')
  }
  return { ok: erros.length === 0, digitos, erros }
}

// Só os 47 dígitos da linha digitável, sem pontos/espaços (conferência/testes).
export function linhaDigitavelSoDigitos(linhaDigitavel) {
  return String(linhaDigitavel ?? '').replace(/\D/g, '')
}

// Formata os 47 dígitos como "AAAAA.AAAAA BBBBB.BBBBBB CCCCC.CCCCCC D …".
export function formatarLinhaDigitavel(linhaDigitavel) {
  const digitos = linhaDigitavelSoDigitos(linhaDigitavel)
  if (digitos.length !== 47) return String(linhaDigitavel ?? '')
  return [
    `${digitos.slice(0, 5)}.${digitos.slice(5, 10)}`,
    `${digitos.slice(10, 15)}.${digitos.slice(15, 21)}`,
    `${digitos.slice(21, 26)}.${digitos.slice(26, 32)}`,
    digitos.slice(32, 33),
    digitos.slice(33)
  ].join(' ')
}

// Linha digitável (47 dígitos) montada a partir do PRÓPRIO código de barras,
// então os dois números sempre batem entre si. Aceita { codigoBarras } já
// calculado para não repetir a conta.
export function gerarLinhaDigitavel(opcoes = {}) {
  const barras = String(opcoes?.codigoBarras ?? '').replace(/\D/g, '') || gerarCodigoBarras(opcoes)
  if (barras.length !== 44) return ''
  const campoLivre = barras.slice(19)
  const campo1 = barras.slice(0, 4) + campoLivre.slice(0, 5)
  const campo2 = campoLivre.slice(5, 15)
  const campo3 = campoLivre.slice(15, 25)
  const campo4 = barras.slice(4, 5)
  const campo5 = barras.slice(5, 19)
  return formatarLinhaDigitavel(
    campo1 + digitoModulo10(campo1)
    + campo2 + digitoModulo10(campo2)
    + campo3 + digitoModulo10(campo3)
    + campo4 + campo5
  )
}

// Padrão 2 de 5 Intercalado (Interleaved 2 of 5 / I25) usado nos boletos
// bancários brasileiros (Febraban). Cada dígito (0 a 9) é codificado por 5
// elementos (sendo 2 largos '1' e 3 estreitos '0').
const PADRAO_I25 = [
  '00110', // 0
  '10001', // 1
  '01001', // 2
  '11000', // 3
  '00101', // 4
  '10100', // 5
  '01100', // 6
  '00011', // 7
  '10010', // 8
  '01010'  // 9
]
const START_I25 = '0000' // barra estreita, espaço estreito, barra estreita, espaço estreito
const STOP_I25 = '100'   // barra larga, espaço estreito, barra estreita

/**
 * Converte um código numérico de comprimento par (como o código de barras de 44
 * dígitos de boletos) na lista de retângulos escuros para renderização em SVG.
 * @param {string} codigo - Os dígitos do código de barras
 * @returns {{ barras: Array<{ x: number, largura: number }>, totalLargura: number }}
 */
export function gerarBarrasI25(codigo) {
  const digitos = String(codigo || '').replace(/\D/g, '')
  if (!digitos || digitos.length % 2 !== 0) {
    return { barras: [], totalLargura: 0 }
  }

  let padrao = START_I25
  for (let i = 0; i < digitos.length; i += 2) {
    const d1 = PADRAO_I25[Number(digitos[i])]
    const d2 = PADRAO_I25[Number(digitos[i + 1])]
    for (let j = 0; j < 5; j++) {
      padrao += d1[j] + d2[j]
    }
  }
  padrao += STOP_I25

  const barras = []
  let x = 0
  for (let i = 0; i < padrao.length; i++) {
    const largura = padrao[i] === '1' ? 3 : 1
    const ehBarra = i % 2 === 0
    if (ehBarra) {
      barras.push({ x, largura })
    }
    x += largura
  }
  return { barras, totalLargura: x }
}

// Reexporta a comparação usada pela tela de cobrança para manter o módulo
// Pagamentos livre de dependências da tela de Configurações.
import { cobrancaPertenceAoUsuario } from './cobrancas.js'

export function boletoPertenceAoUsuario(boleto, usuario) {
  return cobrancaPertenceAoUsuario(boleto, usuario)
}

// ---------- PIX (padrão EMV / Banco Central) ----------
// Gera o "PIX Copia e Cola" a partir da chave. Implementação sem dependências
// externas: monta os campos TLV exigidos pelo BR Code e fecha com o CRC16.

function normalizarTextoPIX(texto, tamanho) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, tamanho)
}

function campoPIX(id, valor) {
  const texto = String(valor)
  return `${id}${String(texto.length).padStart(2, '0')}${texto}`
}

function crc16PIX(payload) {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function gerarPixCopiaECola({ chave, nome = 'Condominio', cidade = 'SAO PAULO', valor = 0, txid = '***', descricao = '' }) {
  const chaveLimpa = String(chave || '').trim()
  if (!chaveLimpa) return ''
  const nomeRecebedor = normalizarTextoPIX(nome, 25) || 'CONDOMINIO'
  const cidadeRecebedor = normalizarTextoPIX(cidade, 15) || 'SAO PAULO'
  const identificador = String(txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'

  let payload = ''
  payload += campoPIX('00', '01')
  payload += campoPIX('26', campoPIX('00', 'BR.GOV.BCB.PIX') + campoPIX('01', chaveLimpa) + (descricao ? campoPIX('02', normalizarTextoPIX(descricao, 40)) : ''))
  payload += campoPIX('52', '0000')
  payload += campoPIX('53', '986')
  const valorNumerico = Number(valor)
  if (valorNumerico > 0) payload += campoPIX('54', valorNumerico.toFixed(2))
  payload += campoPIX('58', 'BR')
  payload += campoPIX('59', nomeRecebedor)
  payload += campoPIX('60', cidadeRecebedor)
  payload += campoPIX('62', campoPIX('05', identificador))
  payload += '6304'
  return payload + crc16PIX(payload)
}

// O status salvo usa o mesmo vocabulário de Pagamentos. O vencimento passado
// é apenas um estado de apresentação e não modifica o documento.
export function statusEfetivo(boleto) {
  if (['gerado', 'pendente', 'vencido', 'vencida'].includes(boleto?.status) && boleto.dataVencimento) {
    const vencimento = new Date(`${boleto.dataVencimento}T23:59:59`)
    if (!isNaN(vencimento.getTime()) && vencimento < new Date()) return 'vencido'
  }
  if (boleto?.status === 'pendente') return 'gerado'
  if (boleto?.status === 'paga') return 'pago'
  if (boleto?.status === 'cancelada') return 'cancelado'
  return boleto?.status || 'gerado'
}
