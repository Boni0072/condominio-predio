// Utils para geração de código de barras e números de boleto
// Implementação simplificada do padrão BOCU (Boleto União) / FEBRABAN

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

export function gerarCodigoBarras(campi, nossoNumero, valor) {
  // Gera código de barras simplificado (não é um boleto real bancário)
  // Esta é uma implementação para fins de demonstração/identificação
  const valorFormatado = valor.toFixed(2).replace('.', '').padStart(10, '0')
  const campos = `${campi}${nossoNumero.replace('-', '')}${valorFormatado}`
  // Adiciona dv no final
  const dv = calcularDigitoVerificador(campos)
  return campos + dv
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

export function gerarLinhaDigitavel(campi, banco, agencia, conta, nossoNumero, valor, dataVencimento) {
  // Gera uma linha digitável fictícia para demonstração
  // Formato: AAAAA.BBBBB.CCCCC.DDDDD.EEEEE.FFFFF.GGGGG.HHHH
  const partes = [
    '00000.00000', // Código do banco + cidade
    '00000.00000', // Fator de vencimento + nosso número
    '00000.00000', // Valor
    '00000.00000', // Cnab / informações complementares
    '00000.00000', // Conta + other fields
    '00000.00000',
    '00000.00000',
    '0000.0000'   // DV
  ]

  // Preenche com dados fictícios formatados
  const fatorVencimento = Math.floor((new Date(dataVencimento) - new Date('2020-01-01')) / (1000 * 60 * 60 * 24))
  const fatorStr = String(fatorVencimento).padStart(4, '0')
  const nossoStr = nossoNumero.replace('-', '').padStart(7, '0')

  partes[1] = `${fatorStr}.${nossoStr}`

  const valorInt = Math.round(valor * 100)
  partes[2] = String(valorInt).padStart(10, '0').replace(/(\d{5})(\d{5})/, '$1.$2')

  // Valor com string mais longa
  return partes.join(' ')
}

// Um boleto é "do usuário" quando foi emitido para o uid dele, para o id do
// cadastro de morador vinculado, ou para o e-mail dele (morador que ainda não
// tem conta no app — a emissão guarda moradorEmail justamente para este caso).
export function boletoPertenceAoUsuario(boleto, usuario) {
  if (!boleto || !usuario) return false
  const ids = [usuario.uid, usuario.id].filter(Boolean)
  if (boleto.moradorUserId && ids.includes(boleto.moradorUserId)) return true
  if (boleto.moradorId && ids.includes(boleto.moradorId)) return true
  const email = String(usuario.email || '').trim().toLowerCase()
  const emailBoleto = String(boleto.moradorEmail || '').trim().toLowerCase()
  return Boolean(email) && email === emailBoleto
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

// Boleto "gerado" cuja data de vencimento já passou é tratado como vencido na
// exibição — evita depender de rotina no servidor para atualizar o status.
export function statusEfetivo(boleto) {
  if (boleto?.status === 'gerado' && boleto.dataVencimento) {
    const vencimento = new Date(`${boleto.dataVencimento}T23:59:59`)
    if (!isNaN(vencimento.getTime()) && vencimento < new Date()) return 'vencido'
  }
  return boleto?.status || 'gerado'
}
