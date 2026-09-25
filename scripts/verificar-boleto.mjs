// Verificação manual (sem framework de testes) dos números do boleto.
// Uso: node scripts/verificar-boleto.mjs
import {
  gerarCodigoBarras,
  gerarLinhaDigitavel,
  linhaDigitavelSoDigitos,
  temDadosBancarios,
  calcularFatorVencimento,
  formatarValorBoleto
} from '../src/components/pagamentos/boletoUtils.js'

let falhas = 0
function conferir(descricao, condicao, detalhe = '') {
  if (condicao) {
    console.log(`ok   ${descricao}`)
    return
  }
  falhas++
  console.error(`FALHA ${descricao}${detalhe ? ` → ${detalhe}` : ''}`)
}

const bancarios = { banco: '001', agencia: '1234', conta: '12345678', carteira: '017' }
const boleto = { nossoNumero: '0000123-4', valor: 1234.56, dataVencimento: '2026-10-10' }

console.log(`valor: ${formatarValorBoleto(boleto.valor)} | vencimento: ${boleto.dataVencimento}`)

const codigoBarras = gerarCodigoBarras({ ...bancarios, ...boleto })
const linhaDigitavel = gerarLinhaDigitavel({ ...bancarios, ...boleto, codigoBarras })
const digitos = linhaDigitavelSoDigitos(linhaDigitavel)

console.log(`código de barras (${codigoBarras.length} dígitos): ${codigoBarras}`)
console.log(`linha digitável  (${digitos.length} dígitos): ${linhaDigitavel}`)

conferir('código de barras tem 44 dígitos', codigoBarras.length === 44, codigoBarras.length)
conferir('código de barras só com números', /^\d{44}$/.test(codigoBarras))
conferir('linha digitável tem 47 dígitos', digitos.length === 47, digitos.length)
conferir('linha digitável no formato 5.5 + 5.6 + 5.6 + 1 + 14', /^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/.test(linhaDigitavel), linhaDigitavel)
conferir('banco 001 no início do código de barras', codigoBarras.slice(0, 3) === '001')
conferir('moeda 9 na 4ª posição', codigoBarras[3] === '9')
conferir('valor de R$ 1234,56 gravado em centavos (0000123456)', codigoBarras.slice(9, 19) === '0000123456', codigoBarras.slice(9, 19))
conferir('fator de vencimento coerente com o cálculo direto', codigoBarras.slice(5, 9) === String(calcularFatorVencimento(boleto.dataVencimento)).padStart(4, '0'), codigoBarras.slice(5, 9))
conferir('campo livre (25 posições) presente', codigoBarras.slice(19).length === 25)
conferir('linha digitável derivada do mesmo código de barras', (
  digitos.slice(0, 5) === codigoBarras.slice(0, 3) + codigoBarras[3] + codigoBarras.slice(19, 20)
  && digitos.slice(32, 33) === codigoBarras[4]
  && digitos.slice(33) === codigoBarras.slice(5, 19)
), `${digitos.slice(32, 33)} / ${codigoBarras[4]}`)

// Entradas ausentes/incompletas não podem lançar erro nem gerar número sem sentido.
conferir('sem banco/agência/conta: código de barras vazio', gerarCodigoBarras({ nossoNumero: '1-2', valor: 10, dataVencimento: '2026-10-10' }) === '')
conferir('sem banco/agência/conta: linha digitável vazia', gerarLinhaDigitavel({ nossoNumero: '1-2', valor: 10, dataVencimento: '2026-10-10' }) === '')
conferir('nosso número undefined não lança erro', (() => {
  try {
    const cb = gerarCodigoBarras({ ...bancarios, nossoNumero: undefined, valor: undefined, dataVencimento: undefined })
    return cb.length === 44 && cb.slice(9, 19) === '0000000000'
  } catch (erro) {
    console.error(erro)
    return false
  }
})())
conferir('temDadosBancarios reconhece configuração completa', temDadosBancarios(bancarios))
conferir('temDadosBancarios rejeita configuração incompleta', !temDadosBancarios({ banco: '001', agencia: '', conta: '123' }))

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTodas as verificações passaram.')
process.exit(falhas ? 1 : 0)
