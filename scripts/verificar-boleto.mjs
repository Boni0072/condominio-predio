// Verificação manual (sem framework de testes) dos números do boleto.
// Uso: node scripts/verificar-boleto.mjs
import {
  analisarVencimentoBoleto,
  dataDoFatorVencimento,
  gerarCodigoBarras,
  gerarLinhaDigitavel,
  linhaDigitavelSoDigitos,
  temDadosBancarios,
  calcularFatorVencimento,
  formatarValorBoleto,
  gerarBarrasI25,
  validarCodigoBarras,
  validarLinhaDigitavel
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

// Verificação do gerador I25 (Febraban)
const barrasI25 = gerarBarrasI25(codigoBarras)
conferir('gerarBarrasI25 gera 114 barras para 44 dígitos', barrasI25.barras.length === 114, barrasI25.barras.length)
conferir('gerarBarrasI25 largura total de 405 módulos', barrasI25.totalLargura === 405, barrasI25.totalLargura)
conferir('gerarBarrasI25 com código vazio devolve lista vazia', gerarBarrasI25('').barras.length === 0)
conferir('gerarBarrasI25 com código ímpar devolve lista vazia', gerarBarrasI25('123').barras.length === 0)

// Validação FEBRABAN exibida na tela (o que evita o "COD.BARRAS INVALIDO" no banco).
conferir('boleto gerado passa na validação do código de barras', validarCodigoBarras(codigoBarras).ok, validarCodigoBarras(codigoBarras).erros.join(' | '))
conferir('boleto gerado passa na validação da linha digitável', validarLinhaDigitavel(linhaDigitavel, codigoBarras).ok, validarLinhaDigitavel(linhaDigitavel, codigoBarras).erros.join(' | '))
const invalido = '1234191059500028078950170001004723459741029654'
const validacaoInvalida = validarCodigoBarras(invalido)
conferir('código "1234..." do aviso é recusado (46 dígitos)', (
  !validacaoInvalida.ok
  && validacaoInvalida.erros.some((e) => e.includes('46'))
), validacaoInvalida.erros.join(' | '))
conferir('banco 123 inexistente é recusado', !validarCodigoBarras(`123${codigoBarras.slice(3)}`).ok)
conferir('linha digitável adulterada é recusada', !validarLinhaDigitavel(`${digitos.slice(0, 9)}${(Number(digitos[9]) + 1) % 10}${digitos.slice(10)}`, codigoBarras).ok)

// Vencimento embutido no fator (com ciclo FEBRABAN resolvido pela cobrança):
// a linha 34190…0595… SEM data de referência cai no ciclo mais próximo de
// hoje (10/10/2026, a vencer); COM vencimento antigo conhecido, resolve para
// o ciclo original (25/05/1999, vencido há décadas — o caso do banco recusar).
const data0595 = dataDoFatorVencimento('0595')
conferir('fator 0595 sem referência cai no ciclo atual (2026)', (
  data0595 instanceof Date
  && data0595.toISOString().slice(0, 10) === '2026-10-10'
), String(data0595))
conferir('fator 0595 com referência 1999 resolve 25/05/1999', (
  dataDoFatorVencimento('0595', '1999-05-25').toISOString().slice(0, 10) === '1999-05-25'
))
conferir('fator 0595 com referência antiga é analisado como vencido', analisarVencimentoBoleto({ fator: '0595', dataVencimento: '1999-05-25' }).estado === 'vencido')
conferir('linha 34190…0595… passa nos DVs', validarLinhaDigitavel(
  '34190.17003.01004.723456.97411.277516.5.05950002807895',
  '34195059500028078950170001004723459741127751'
).ok)
conferir('linha 34190…0595… diverge da cobrança atual (pede 2ª via)', (
  analisarVencimentoBoleto({ fator: '0595', dataVencimento: '2026-09-28' }).data.toISOString().slice(0, 10) !== '2026-09-28'
  && validarCodigoBarras('34195059500028078950170001004723459741127751').ok
))
conferir('boleto gerado agora é analisado como a-vencer/vence-hoje', ['a-vencer', 'vence-hoje'].includes(
  analisarVencimentoBoleto({ fator: codigoBarras.slice(5, 9) }).estado
))
conferir('fator zerado é sem-vencimento', analisarVencimentoBoleto({ fator: '0000' }).estado === 'sem-vencimento')

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTodas as verificações passaram.')
process.exit(falhas ? 1 : 0)
