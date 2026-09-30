// Verificação manual (sem framework de testes) das regras do boleto
// registrado no Mercado Pago.
// Uso: node scripts/verificar-mercadopago.mjs
import {
  ajustarVencimentoBoleto,
  boletoEstaPago,
  completarPagador,
  construirUrlWebhookMercadoPago,
  dividirNome,
  ehTokenTesteMercadoPago,
  extrairDadosBoletoResposta,
  extrairDadosWebhookMercadoPago,
  formatarUf,
  mensagemDeErroMercadoPago,
  modoCredencialMercadoPago,
  montarPagamentoBoleto,
  pagadorCompleto,
  statusMercadoPagoLegivel,
  tipoDocumentoBoleto,
  validarEnderecoPagador,
  validarPagador,
  VALOR_MINIMO_BOLETO,
  valorDoBoleto
} from '../functions/mercadopagoBoleto.js'
import { gerarLinhaDigitavel, linhaDigitavelSoDigitos } from '../src/components/pagamentos/boletoUtils.js'

let falhas = 0
function conferir(descricao, condicao, detalhe = '') {
  if (condicao) {
    console.log(`ok   ${descricao}`)
    return
  }
  falhas++
  console.error(`FALHA ${descricao}${detalhe ? ` → ${detalhe}` : ''}`)
}

// ---------- Documento do pagador ----------
conferir('CPF válido reconhecido', tipoDocumentoBoleto('111.444.777-35') === 'CPF')
conferir('CPF com dígito errado é recusado', tipoDocumentoBoleto('111.444.777-36') === '')
conferir('CPF repetido é recusado', tipoDocumentoBoleto('11111111111') === '')
conferir('CNPJ válido reconhecido', tipoDocumentoBoleto('11.222.333/0001-81') === 'CNPJ')
conferir('CNPJ com dígito errado é recusado', tipoDocumentoBoleto('11.222.333/0001-82') === '')
conferir('documento vazio é recusado', tipoDocumentoBoleto('') === '')

// ---------- Nome do pagador ----------
conferir('nome com sobrenome é dividido', (
  dividirNome('João da Silva').primeiroNome === 'João'
  && dividirNome('João da Silva').sobrenome === 'da Silva'
))
conferir('nome com uma palavra não inventa sobrenome', dividirNome('João').sobrenome === '')

// ---------- Endereço do pagador (obrigatório: regra do BACEN) ----------
const enderecoOk = {
  cep: '01310-100',
  logradouro: 'Avenida Paulista',
  numero: '1578',
  bairro: 'Bela Vista',
  cidade: 'São Paulo',
  uf: 'sp'
}
const enderecoValidado = validarEnderecoPagador(enderecoOk)
conferir('endereço completo é aceito', enderecoValidado.ok, enderecoValidado.erros.join(' | '))
conferir('endereço vira o bloco address da API', (
  enderecoValidado.endereco.zip_code === '01310-100'
  && enderecoValidado.endereco.street_name === 'Avenida Paulista'
  && enderecoValidado.endereco.street_number === '1578'
  && enderecoValidado.endereco.neighborhood === 'Bela Vista'
  && enderecoValidado.endereco.city === 'São Paulo'
  && enderecoValidado.endereco.federal_unit === 'SP'
))
conferir('número vazio vira S/N', validarEnderecoPagador({ ...enderecoOk, numero: '' }).endereco.street_number === 'S/N')
conferir('UF inválida é recusada', (
  formatarUf('XX') === '' && formatarUf('sp') === 'SP' && validarEnderecoPagador({ ...enderecoOk, uf: 'XX' }).ok === false
))
conferir('endereço sem rua/bairro/cidade acusa os campos', (
  validarEnderecoPagador({ cep: '01310-100', uf: 'SP' }).erros.length === 3
))

const pagadorOk = {
  nome: 'João da Silva',
  documento: '111.444.777-35',
  email: 'joao@exemplo.com',
  ...enderecoOk
}
const validacao = validarPagador(pagadorOk)
conferir('pagador completo é aceito', validacao.ok, validacao.erros.join(' | '))
conferir('validarPagador organiza nome, documento e endereço', (
  validacao.primeiroNome === 'João'
  && validacao.sobrenome === 'da Silva'
  && validacao.documento === '11144477735'
  && validacao.tipoDocumento === 'CPF'
  && validacao.cep === '01310-100'
  && validacao.endereco.federal_unit === 'SP'
))
const validacaoIncompleta = validarPagador({ nome: 'João', documento: '123', email: 'sem-arroba' })
conferir('pagador incompleto devolve todos os problemas', validacaoIncompleta.erros.length === 8, validacaoIncompleta.erros.length)
const semEndereco = validarPagador({ ...pagadorOk, cep: '', logradouro: '', bairro: '', cidade: '', uf: '' })
conferir('pagador sem endereço é recusado', !semEndereco.ok && semEndereco.erros.length === 5, semEndereco.erros.join(' | '))

// ---------- Valor ----------
conferir('valor "1.234,56" vira 1234.56', valorDoBoleto('1.234,56') === 1234.56)
conferir('valor "R$ 1.234,56" vira 1234.56', valorDoBoleto('R$ 1.234,56') === 1234.56)
conferir('valor numérico é preservado', valorDoBoleto(1234.56) === 1234.56)
conferir('valor vazio vira 0', valorDoBoleto('') === 0)
conferir('valor mínimo do boleto é R$ 4,00', VALOR_MINIMO_BOLETO === 4)

// ---------- Vencimento (janela de 1 a 30 dias do Mercado Pago) ----------
const hoje = new Date('2026-09-28T12:00:00')
const dentroDaJanela = ajustarVencimentoBoleto('2026-10-10', hoje)
conferir('vencimento dentro da janela é mantido', (
  dentroDaJanela.data === '2026-10-10'
  && dentroDaJanela.dias === 12
  && dentroDaJanela.ajustada === false
))
conferir('vencimento enviado com hora e fuso de Brasília', (
  dentroDaJanela.iso === '2026-10-10T23:59:59.000-03:00'
), dentroDaJanela.iso)
const distante = ajustarVencimentoBoleto('2026-12-31', hoje)
conferir('vencimento acima de 30 dias é limitado', (
  distante.data === '2026-10-28' && distante.dias === 30 && distante.ajustada === true
), `${distante.data} / ${distante.dias}`)
const passado = ajustarVencimentoBoleto('2026-09-01', hoje)
conferir('vencimento no passado vai para o dia seguinte', (
  passado.data === '2026-09-29' && passado.dias === 1 && passado.ajustada === true
), `${passado.data} / ${passado.dias}`)
conferir('sem vencimento usa o limite de 30 dias', ajustarVencimentoBoleto('', hoje).data === '2026-10-28')

// ---------- Payload enviado à API ----------
const { corpo, erros, vencimento } = montarPagamentoBoleto({
  valor: '1.234,56',
  descricao: 'Mensalidade de outubro/2026',
  dataVencimento: '2026-10-10',
  pagador: pagadorOk,
  referenciaExterna: 'condo123-cota_abc',
  agora: hoje
})
conferir('payload é montado sem erros', erros.length === 0 && Boolean(corpo), erros.join(' | '))
conferir('valor em reais no payload', corpo.transaction_amount === 1234.56)
conferir('meio de pagamento é bolbradesco', corpo.payment_method_id === 'bolbradesco')
conferir('vencimento no payload', corpo.date_of_expiration === vencimento.iso && vencimento.data === '2026-10-10')
conferir('pagador vai no formato da API', (
  corpo.payer.first_name === 'João'
  && corpo.payer.last_name === 'da Silva'
  && corpo.payer.identification.type === 'CPF'
  && corpo.payer.identification.number === '11144477735'
  && corpo.payer.address.zip_code === '01310-100'
))
// O boleto é RECUSADO (HTTP 400) pelo Mercado Pago desde 30/09/2024 quando o
// payer não leva o endereço completo — é esta a correção do "código real".
conferir('endereço completo vai no payer', (
  corpo.payer.address.street_name === 'Avenida Paulista'
  && corpo.payer.address.street_number === '1578'
  && corpo.payer.address.neighborhood === 'Bela Vista'
  && corpo.payer.address.city === 'São Paulo'
  && corpo.payer.address.federal_unit === 'SP'
))
conferir('descrição e referência externa presentes', (
  corpo.description === 'Mensalidade de outubro/2026'
  && corpo.external_reference === 'condo123-cota_abc'
))
const semValor = montarPagamentoBoleto({ valor: 0, dataVencimento: '2026-10-10', pagador: pagadorOk, agora: hoje })
conferir('valor zerado impede o payload', semValor.corpo === null && semValor.erros.length === 1, semValor.erros.join(' | '))
conferir('R$ 3,99 (abaixo do mínimo) impede o payload', (
  montarPagamentoBoleto({ valor: 3.99, dataVencimento: '2026-10-10', pagador: pagadorOk, agora: hoje }).corpo === null
))
conferir('R$ 4,00 (mínimo da API) monta o payload', (
  montarPagamentoBoleto({ valor: 4, dataVencimento: '2026-10-10', pagador: pagadorOk, agora: hoje }).corpo?.transaction_amount === 4
))
const semPagador = montarPagamentoBoleto({ valor: 10, dataVencimento: '2026-10-10', pagador: {}, agora: hoje })
conferir('pagador vazio impede o payload', semPagador.corpo === null && semPagador.erros.length === 8, semPagador.erros.length)

// ---------- Resposta da API de Pagamentos ----------
// Estrutura REAL devolvida pela API de produção (POST/GET /v1/payments com
// bolbradesco): o código de barras vem em barcode.content e a LINHA DIGITÁVEL
// vem em transaction_details.digitable_line (barcode.digitable_line é vazio).
const respostaPagamento = {
  id: 180616476013,
  status: 'pending',
  status_detail: 'pending_waiting_payment',
  payment_method_id: 'bolbradesco',
  date_of_expiration: '2026-10-05T23:59:59.000-03:00',
  barcode: {
    content: '42292159000000050007115000064897310695828452'
  },
  transaction_details: {
    barcode: { content: '42292159000000050007115000064897310695828452' },
    digitable_line: '42297115040006489731706958284520215900000005000',
    external_resource_url: 'https://www.mercadopago.com.br/payments/180616476013/ticket?caller_id=1',
    payment_method_reference_id: '10621502512',
    verification_code: '069582845'
  }
}
const registro = extrairDadosBoletoResposta(respostaPagamento)
conferir('código de barras lido com 44 dígitos', registro.codigoBarras.length === 44, registro.codigoBarras.length)
conferir('linha digitável lida de transaction_details com 47 dígitos', registro.linhaDigitavel.length === 47, registro.linhaDigitavel.length)
conferir('código de barras lido igual ao da API', registro.codigoBarras === '42292159000000050007115000064897310695828452')
conferir('URL do boleto oficial lida', registro.urlBoleto.startsWith('https://www.mercadopago.com.br/'))
conferir('identificador e referência lidos', registro.paymentId === '180616476013' && registro.referencia === '10621502512')
conferir('código de verificação lido', registro.codigoVerificacao === '069582845')
conferir('status lido como pending', registro.status === 'pending' && boletoEstaPago(registro.status) === false)
conferir('vencimento lido da resposta', registro.vencimento === '2026-10-05')

// A linha digitável devolvida pelo Mercado Pago precisa bater com a que
// derivamos do código de barras — garante que o boleto registrado é coerente
// (e que a linha mostrada na tela é a mesma que o banco gerou).
const linhaDerivada = linhaDigitavelSoDigitos(gerarLinhaDigitavel({ codigoBarras: registro.codigoBarras }))
conferir('linha digitável derivada do código de barras confere', linhaDerivada === registro.linhaDigitavel, linhaDerivada)

// ---------- Resposta da API de Ordens (transactions.payments) ----------
const respostaOrdem = {
  id: 'ORD01J6TC8BYRR0T4ZKY0QRTZ0E24',
  status: 'action_required',
  transactions: {
    payments: [{
      id: 'PAY01J6TC8BYRR0T4ZKY0QRTZ0E24',
      status: 'action_required',
      status_detail: 'waiting_payment',
      payment_method: {
        id: 'boleto',
        type: 'ticket',
        ticket_url: 'https://www.mercadopago.com.br/payments/86797024510/ticket',
        barcode_content: '23797991400000200003380260600543513000633330',
        digitable_line: '23793380296060054351030006333303799140000020000',
        reference: '6004835002',
        financial_institution: 'boleto'
      }
    }]
  }
}
const registroOrdem = extrairDadosBoletoResposta(respostaOrdem)
conferir('resposta da API de ordens também é lida', (
  registroOrdem.codigoBarras.length === 44
  && registroOrdem.linhaDigitavel.length === 47
  && registroOrdem.urlBoleto.includes('/ticket')
  && registroOrdem.referencia === '6004835002'
))
conferir('status action_required é legível', (
  registroOrdem.status === 'action_required'
  && statusMercadoPagoLegivel(registroOrdem.status) === 'Aguardando pagamento'
))
conferir('approved conta como pago', boletoEstaPago('approved') && boletoEstaPago('PAID') && !boletoEstaPago('in_process'))

// ---------- Mensagens de erro ----------
const erroLegivel = mensagemDeErroMercadoPago({
  message: 'Invalid transaction_amount',
  cause: [{ description: 'transaction_amount must be greater than 0' }]
})
conferir('erro da API vira mensagem legível', (
  erroLegivel === 'Invalid transaction_amount — transaction_amount must be greater than 0'
), erroLegivel)
conferir('erro vazio vira string vazia', mensagemDeErroMercadoPago(null) === '')

// ---------- Credencial: produção x teste (conta Vendedor Brasil) ----------
conferir('token TEST-… é modo teste', (
  ehTokenTesteMercadoPago('TEST-1234567890123456-012345-abcdef') === true
  && modoCredencialMercadoPago('TEST-1234567890123456-012345-abcdef') === 'teste'
))
conferir('token APP_USR-… é modo produção', (
  ehTokenTesteMercadoPago('APP_USR-1234567890123456-012345-abcdef') === false
  && modoCredencialMercadoPago('APP_USR-1234567890123456-012345-abcdef') === 'producao'
))
conferir('token vazio não tem modo', modoCredencialMercadoPago('') === '')

// ---------- Webhook / Notificações ----------
const webhookPost = extrairDadosWebhookMercadoPago({
  body: { action: 'payment.updated', type: 'payment', data: { id: '99887766' } }
})
conferir('webhook POST moderno reconhecido', (
  webhookPost.eEventoPagamento === true && webhookPost.paymentId === '99887766'
), JSON.stringify(webhookPost))

const webhookGet = extrairDadosWebhookMercadoPago({
  query: { topic: 'payment', id: '11223344' }
})
conferir('webhook IPN (GET clássico) reconhecido', (
  webhookGet.eEventoPagamento === true && webhookGet.paymentId === '11223344'
), JSON.stringify(webhookGet))

const urlWh = construirUrlWebhookMercadoPago('portaria-condominio-8fbc9', 'condo_teste')
conferir('URL do webhook construída com tenantId', (
  urlWh.includes('portaria-condominio-8fbc9')
  && urlWh.includes('webhookMercadoPago')
  && urlWh.includes('tenantId=condo_teste')
), urlWh)

// ---------- Pagador sugerido para quem REGISTRA o boleto ----------
// Fluxo do sistema: a administração (síndico/zelador/portaria) gera as cobranças
// e REGISTRA os boletos; o morador só abre o boleto já registrado e paga. O que
// o módulo precisa garantir: o pagador sai da ficha da cobrança + do endereço do
// condomínio, e NUNCA dos dados pessoais de quem está clicando.
const fichaComPagador = {
  moradorNome: 'Maria Souza Lima',
  moradorEmail: 'maria@email.com',
  pagadorDocumento: '11144477735',
  pagadorCep: '01310100',
  pagadorLogradouro: 'Avenida Paulista',
  pagadorNumero: '1000',
  pagadorBairro: 'Bela Vista',
  pagadorCidade: 'São Paulo',
  pagadorUf: 'SP'
}
const condominioCadastro = { nome: 'Cond. Central', endereco: 'Rua A, 5' }

const sugeridoDaFicha = completarPagador({ cobranca: fichaComPagador, condominio: condominioCadastro, usarCadastro: false })
conferir('ficha da cobrança monta o pagador sem digitação', pagadorCompleto(sugeridoDaFicha).ok === true, JSON.stringify(pagadorCompleto(sugeridoDaFicha).erros))
conferir('nome e e-mail do devedor vêm da cobrança', (
  sugeridoDaFicha.nome === 'Maria Souza Lima' && sugeridoDaFicha.email === 'maria@email.com'
), JSON.stringify(sugeridoDaFicha))

const perfilSindico = {
  uid: 'sindico1',
  nome: 'Sergio Oliveira',
  email: 'sindico@email.com',
  cpf: '55511122233',
  endereco: 'Rua do Síndico, 99',
  pagadorBoleto: { documento: '55511122233', cep: '04567000', logradouro: 'Rua do Síndico', numero: '99', bairro: 'Brooklin Novo', cidade: 'São Paulo', uf: 'SP' }
}
const sugeridoSemVazamento = completarPagador({ perfil: perfilSindico, condominio: condominioCadastro, usarCadastro: false })
conferir('dados pessoais de quem registra não viram os do devedor', (
  sugeridoSemVazamento.nome === ''
  && sugeridoSemVazamento.documento === ''
  && sugeridoSemVazamento.email === ''
  && sugeridoSemVazamento.cep === ''
), JSON.stringify(sugeridoSemVazamento))
conferir('endereço do condomínio continua sendo sugerido', sugeridoSemVazamento.logradouro === 'Rua A, 5', sugeridoSemVazamento.logradouro)

const fichaSemEndereco = completarPagador({
  cobranca: { moradorNome: 'Joao Silva', moradorEmail: 'joao@email.com', moradorCpf: '11144477735' },
  condominio: condominioCadastro,
  usarCadastro: false
})
conferir('sem endereço na ficha o registro é barrado antes de chamar a API', pagadorCompleto(fichaSemEndereco).ok === false)
conferir('rua do condomínio entra como sugestão de logradouro', fichaSemEndereco.logradouro === 'Rua A, 5', fichaSemEndereco.logradouro)
conferir('erro aponta o que falta (CEP, cidade...)', (
  pagadorCompleto(fichaSemEndereco).erros.some((e) => /CEP/.test(e))
  && pagadorCompleto(fichaSemEndereco).erros.some((e) => /cidade/.test(e))
), JSON.stringify(pagadorCompleto(fichaSemEndereco).erros))

const montadoComPayload = completarPagador({
  payload: { pagador: { logradouro: 'Rua Corrigida', numero: '42' } },
  cobranca: fichaComPagador,
  condominio: condominioCadastro,
  usarCadastro: false
})
conferir('o que foi digitado no formulário vence a ficha', (
  montadoComPayload.logradouro === 'Rua Corrigida' && montadoComPayload.numero === '42'
))
conferir('cobrança antiga (pagador*) preenche a 2ª via', (
  completarPagador({ cobranca: { pagadorNome: 'Beatriz Alves', pagadorDocumento: '11144477735', pagadorEmail: 'bi@email.com', pagadorCep: '01310100', pagadorLogradouro: 'Avenida Paulista', pagadorNumero: '1000', pagadorBairro: 'Bela Vista', pagadorCidade: 'São Paulo', pagadorUf: 'SP' }, usarCadastro: false }).nome === 'Beatriz Alves'
))

// Quando a cobrança é da própria pessoa (o síndico pagando a própria cota pelo
// perfil dele, por exemplo), o cadastro dele é usado — é o único caso em que
// perfil e devedor são a mesma pessoa.
const montadoDoProprietario = completarPagador({ perfil: perfilSindico })
conferir('usarCadastro=true usa o cadastro de quem paga', (
  montadoDoProprietario.nome === 'Sergio Oliveira' && montadoDoProprietario.documento === '55511122233'
), JSON.stringify(montadoDoProprietario))
const montadoComCache = completarPagador({
  perfil: { nome: 'Ana Castro', email: 'ana@email.com' },
  local: { documento: '11144477735', cep: '01310100', logradouro: 'Avenida Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' }
})
conferir('bloco confirmado no aparelho completa o que o perfil não tem', pagadorCompleto(montadoComCache).ok === true, JSON.stringify(montadoComCache))

console.log(falhas ? `\n${falhas} verificação(ões) falharam.` : '\nTodas as verificações passaram.')
process.exit(falhas ? 1 : 0)
