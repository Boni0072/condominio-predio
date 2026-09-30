// Regras PURAS do boleto registrado no Mercado Pago (sem Firebase, sem rede).
//
// Este arquivo é importado pela Cloud Function (functions/index.js) — que é
// quem fala com a API usando o Access Token — e também pelo app
// (src/components/pagamentos/mercadoPago.js), que usa as mesmas validações
// antes de enviar os dados. Assim o que o app valida é exatamente o que o
// servidor monta: uma única fonte de verdade para o payload e para a leitura
// da resposta.
//
// API usada: POST https://api.mercadopago.com/v1/payments com
// payment_method_id "bolbradesco". A resposta traz o código de barras
// (barcode.content, 44 dígitos), a linha digitável
// (transaction_details.digitable_line, 47 dígitos), a URL do boleto oficial
// (transaction_details.external_resource_url) e o status (pending até o
// morador pagar). Conferido na API de produção em 30/09/2026.

export const API_MERCADO_PAGO = 'https://api.mercadopago.com'
export const MEIO_PAGAMENTO_BOLETO = 'bolbradesco'

// O Mercado Pago aceita vencimento de 1 a 30 dias a partir da emissão.
export const DIAS_MINIMOS_VENCIMENTO = 1
export const DIAS_MAXIMOS_VENCIMENTO = 30

// Fuso usado na data de vencimento enviada ao Mercado Pago (horário de
// Brasília). O boleto vence às 23:59:59 do dia escolhido.
export const FUSO_BRASILIA = '-03:00'

const MS_POR_DIA = 24 * 60 * 60 * 1000

export function somenteDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '')
}

// ---------- Documento do pagador (CPF/CNPJ) ----------

function cpfValido(digitos) {
  if (!/^\d{11}$/.test(digitos)) return false
  if (/^(\d)\1{10}$/.test(digitos)) return false
  const digito = (base) => {
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i)
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }
  const dv1 = digito(digitos.slice(0, 9))
  const dv2 = digito(digitos.slice(0, 9) + dv1)
  return digitos === digitos.slice(0, 9) + String(dv1) + String(dv2)
}

function cnpjValido(digitos) {
  if (!/^\d{14}$/.test(digitos)) return false
  if (/^(\d)\1{13}$/.test(digitos)) return false
  const digito = (base) => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let soma = 0
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i]
    const resto = soma % 11
    return resto < 2 ? 0 : 11 - resto
  }
  const dv1 = digito(digitos.slice(0, 12))
  const dv2 = digito(digitos.slice(0, 12) + dv1)
  return digitos === digitos.slice(0, 12) + String(dv1) + String(dv2)
}

// ---------- Credencial: produção x teste ----------

// Produção movimenta dinheiro de verdade: APP_USR-...
// Teste (conta Vendedor de teste, ex. User ID 3723216120) gera boleto apenas
// para validar o fluxo: TEST-...
export function ehTokenTesteMercadoPago(token) {
  const texto = String(token ?? '').trim().toUpperCase()
  return texto.startsWith('TEST-') || texto.startsWith('TEST_USR')
}

export function modoCredencialMercadoPago(token) {
  const texto = String(token ?? '').trim()
  if (!texto) return ''
  return ehTokenTesteMercadoPago(texto) ? 'teste' : 'producao'
}

// 'CPF' | 'CNPJ' quando o documento é válido; '' quando não é.
export function tipoDocumentoBoleto(documento) {
  const digitos = somenteDigitos(documento)
  if (digitos.length === 11) return cpfValido(digitos) ? 'CPF' : ''
  if (digitos.length === 14) return cnpjValido(digitos) ? 'CNPJ' : ''
  return ''
}

export function documentoValido(documento) {
  return Boolean(tipoDocumentoBoleto(documento))
}

// Separa "João da Silva" em first_name/last_name, como o Mercado Pago exige.
export function dividirNome(nomeCompleto) {
  const partes = String(nomeCompleto ?? '').trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return { primeiroNome: '', sobrenome: '' }
  if (partes.length === 1) return { primeiroNome: partes[0], sobrenome: '' }
  return { primeiroNome: partes[0], sobrenome: partes.slice(1).join(' ') }
}

export function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim())
}

// CEP do pagador: 8 dígitos → "01310-100" (formato usado pelo Mercado Pago).
export function formatarCep(cep) {
  const digitos = somenteDigitos(cep).slice(0, 8)
  if (digitos.length !== 8) return ''
  return `${digitos.slice(0, 5)}-${digitos.slice(5)}`
}

// ---------- Endereço do pagador (obrigatório no boleto) ----------
// Desde 30/09/2024 o Mercado Pago (por exigência do BACEN) RECUSA a emissão de
// boleto sem o endereço completo do pagador: rua, número, bairro, CEP, cidade e
// UF. Antes o app enviava apenas o CEP, então a API respondia HTTP 400 e
// NENHUM código de barras era gerado — era essa a causa do "boleto real" não
// sair. URL da regra: developers.mercadopago.com.br/developers/pt/news
// (Novos campos obrigatórios para boleto no Checkout Transparente).

export const UFS_BRASIL = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
]

// Aceita "sp", " SP " ou "São Paulo" (a sigla é extraída) e devolve '' quando
// não é uma UF válida — o Mercado Pago valida a sigla do estado.
export function formatarUf(uf) {
  const sigla = String(uf ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
  return UFS_BRASIL.includes(sigla) ? sigla : ''
}

// Monta o bloco "address" do payer e devolve a lista de problemas (nunca lança
// erro). Número vazio vira "S/N", que é o valor aceito quando o imóvel não tem
// número.
export function validarEnderecoPagador({ cep, logradouro, numero, bairro, cidade, uf } = {}) {
  const zipCode = formatarCep(cep)
  const streetName = String(logradouro ?? '').trim()
  const streetNumber = String(numero ?? '').trim() || 'S/N'
  const neighborhood = String(bairro ?? '').trim()
  const city = String(cidade ?? '').trim()
  const federalUnit = formatarUf(uf)
  const erros = []
  if (!zipCode) erros.push('Informe o CEP do pagador (8 dígitos) — o Mercado Pago exige o endereço completo no boleto.')
  if (!streetName) erros.push('Informe a rua (logradouro) do pagador.')
  if (!neighborhood) erros.push('Informe o bairro do pagador.')
  if (!city) erros.push('Informe a cidade do pagador.')
  if (!federalUnit) erros.push('Informe a UF do pagador (duas letras, ex.: SP).')
  return {
    ok: erros.length === 0,
    erros,
    endereco: {
      zip_code: zipCode,
      street_name: streetName.slice(0, 100),
      street_number: streetNumber.slice(0, 10),
      neighborhood: neighborhood.slice(0, 60),
      city: city.slice(0, 60),
      federal_unit: federalUnit
    }
  }
}

// Valida os dados do pagador SEM lançar erro: devolve a lista de problemas
// para a tela mostrar tudo de uma vez, e os campos já normalizados.
export function validarPagador({ nome, documento, email, cep, logradouro, numero, bairro, cidade, uf } = {}) {
  const { primeiroNome, sobrenome } = dividirNome(nome)
  const tipoDocumento = tipoDocumentoBoleto(documento)
  const emailLimpo = String(email ?? '').trim().toLowerCase()
  const erros = []
  if (!primeiroNome) erros.push('Informe o nome do pagador.')
  else if (!sobrenome) erros.push('Informe o nome e o sobrenome do pagador.')
  if (!tipoDocumento) erros.push('Informe um CPF ou CNPJ válido do pagador (com dígito verificador).')
  if (!emailValido(emailLimpo)) erros.push('Informe um e-mail válido do pagador — o Mercado Pago exige esse dado para o boleto.')
  const endereco = validarEnderecoPagador({ cep, logradouro, numero, bairro, cidade, uf })
  erros.push(...endereco.erros)
  return {
    ok: erros.length === 0,
    erros,
    primeiroNome,
    sobrenome,
    tipoDocumento,
    documento: somenteDigitos(documento),
    email: emailLimpo,
    cep: formatarCep(cep),
    endereco: endereco.endereco
  }
}

// Bloco "payer" da API. O endereço COMPLETO é obrigatório no boleto (regra do
// BACEN): rua, número, bairro, CEP, cidade e UF. Sem ele o Mercado Pago
// responde HTTP 400 ("payer.address... is required") e nenhum código de barras
// real é devolvido.
export function montarPagador({ nome, documento, email, cep, logradouro, numero, bairro, cidade, uf } = {}) {
  const dados = validarPagador({ nome, documento, email, cep, logradouro, numero, bairro, cidade, uf })
  if (!dados.ok) return { pagador: null, erros: dados.erros, dados }
  const pagador = {
    email: dados.email,
    first_name: dados.primeiroNome,
    last_name: dados.sobrenome,
    identification: { type: dados.tipoDocumento, number: dados.documento },
    address: dados.endereco
  }
  return { pagador, erros: [], dados }
}

// ---------- Pagador montado a partir do que o sistema já sabe ----------
// O Mercado Pago exige nome completo, CPF/CNPJ, e-mail e endereço completo do
// pagador. Quem REGISTRA o boleto é a administração (síndico/zelador/portaria);
// o morador apenas consulta o boleto já registrado e paga. Para o gestor não
// precisar digitar tudo de novo a cada cobrança, estes helpers montam o bloco
// com o que já existe, na ordem do mais específico (acabou de digitar) para o
// mais genérico (ficha do devedor/endereço do prédio). É a MESMA função usada
// pela Cloud Function e pelas telas — uma única fonte de verdade.
//
// Fontes:
//   pago        → o que veio no formulário agora (correção manual vence tudo)
//   confirmado  → users/{uid}.pagadorBoleto (dados já confirmados de quem paga)
//   local       → cache do app no aparelho (sessão/mesmo dispositivo)
//   ficha       → a própria cobrança (pagador* de registro anterior, morador*)
//   cadastro    → users/{uid} de QUEM PAGA (usado só quando a cobrança é dele)
//   condominio  → tenants/{id} (o endereço do prédio: é lá que o devedor mora)
const FONTES_PAGADOR = {
  nome: [
    ['pago', 'nome'], ['pago', 'nomeCompleto'], ['confirmado', 'nome'],
    ['ficha', 'pagadorNome'], ['ficha', 'moradorNome'], ['ficha', 'destinatario'],
    ['cadastro', 'nome'], ['cadastro', 'displayName']
  ],
  documento: [
    ['pago', 'documento'], ['pago', 'cpf'], ['pago', 'cnpj'], ['pago', 'cpfCnpj'],
    ['confirmado', 'documento'],
    ['ficha', 'pagadorDocumento'], ['ficha', 'moradorDocumento'], ['ficha', 'moradorCpf'],
    ['cadastro', 'cpf'], ['cadastro', 'documento'], ['cadastro', 'cpfCnpj']
  ],
  email: [
    ['pago', 'email'], ['confirmado', 'email'],
    ['ficha', 'pagadorEmail'], ['ficha', 'moradorEmail'], ['ficha', 'destinatarioEmail'],
    ['cadastro', 'email']
  ],
  telefone: [
    ['pago', 'telefone'], ['pago', 'whatsapp'], ['confirmado', 'telefone'],
    ['ficha', 'pagadorTelefone'], ['ficha', 'moradorTelefone'],
    ['cadastro', 'whatsapp'], ['cadastro', 'telefone']
  ],
  cep: [
    ['pago', 'cep'], ['confirmado', 'cep'],
    ['ficha', 'pagadorCep'], ['ficha', 'moradorCep']
  ],
  logradouro: [
    ['pago', 'logradouro'], ['pago', 'rua'], ['confirmado', 'logradouro'],
    ['ficha', 'pagadorLogradouro'], ['ficha', 'moradorLogradouro'],
    ['cadastro', 'logradouro'], ['cadastro', 'endereco'],
    ['condominio', 'logradouro'], ['condominio', 'rua'], ['condominio', 'endereco']
  ],
  numero: [
    ['pago', 'numero'], ['confirmado', 'numero'],
    ['ficha', 'pagadorNumero'], ['ficha', 'moradorNumero'],
    ['cadastro', 'numero'], ['cadastro', 'unidade'],
    ['condominio', 'numero']
  ],
  complemento: [
    ['pago', 'complemento'], ['confirmado', 'complemento'],
    ['ficha', 'pagadorComplemento'], ['ficha', 'moradorComplemento'],
    ['cadastro', 'complemento']
  ],
  bairro: [
    ['pago', 'bairro'], ['confirmado', 'bairro'],
    ['ficha', 'pagadorBairro'], ['ficha', 'moradorBairro'],
    ['cadastro', 'bairro'], ['condominio', 'bairro']
  ],
  cidade: [
    ['pago', 'cidade'], ['confirmado', 'cidade'],
    ['ficha', 'pagadorCidade'], ['ficha', 'moradorCidade'],
    ['cadastro', 'cidade'], ['cadastro', 'municipio'],
    ['condominio', 'cidade'], ['condominio', 'municipio']
  ],
  uf: [
    ['pago', 'uf'], ['confirmado', 'uf'],
    ['ficha', 'pagadorUf'], ['ficha', 'moradorUf'],
    ['cadastro', 'uf'], ['cadastro', 'estado'],
    ['condominio', 'uf'], ['condominio', 'estado']
  ]
}

export const CAMPOS_PAGADOR = Object.keys(FONTES_PAGADOR)

/**
 * Monta o pagador do boleto unindo o que foi digitado + a ficha da cobrança +
 * o cadastro de quem paga + o endereço do condomínio.
 * Valores vêm SEMPRE como texto já aparado (a validação cuida do resto).
 */
export function completarPagador({ payload, cobranca, perfil, condominio, local, usarCadastro = true } = {}) {
  const bloco = (valor) => (valor && typeof valor === 'object' ? valor : {})
  // O que o cadastro confirma (users/{uid}.pagadorBoleto) manda sobre o cache
  // do aparelho; o cache só completa o que o perfil ainda não tem.
  const confirmado = { ...bloco(local), ...bloco(bloco(perfil).pagadorBoleto) }
  // usarCadastro=false: quem está registrando NÃO é o titular da cobrança (o
  // síndico registrando o boleto do morador). Nesse caso os dados PESSOAIS de
  // quem clica ficam de fora — o pagador sai do que foi digitado e da ficha da
  // cobrança. Sem isso, o CPF/endereço do síndico viraria o do devedor.
  // O endereço do condomínio continua valendo: é o lugar onde o devedor mora
  // (não é dado pessoal de quem clicou) e serve de sugestão editável.
  const pessoal = usarCadastro !== false
  const origem = {
    pago: bloco(bloco(payload).pagador),
    confirmado: pessoal ? confirmado : {},
    ficha: bloco(cobranca),
    cadastro: pessoal ? bloco(perfil) : {},
    condominio: bloco(condominio)
  }
  const montado = {}
  for (const campo of CAMPOS_PAGADOR) {
    let valor = ''
    for (const [fonte, chave] of FONTES_PAGADOR[campo]) {
      const candidato = String(origem[fonte]?.[chave] ?? '').trim()
      if (candidato) {
        valor = candidato
        break
      }
    }
    montado[campo] = valor
  }
  return montado
}

// Os dados já chegam suficientes para emitir? Devolve { ok, erros } no mesmo
// formato de validarPagador para a tela avisar o que falta ANTES de chamar a
// Cloud Function (e para a função responder com a lista exata do que falta).
export function pagadorCompleto(pagador) {
  return validarPagador({
    nome: pagador?.nome,
    documento: pagador?.documento,
    email: pagador?.email,
    cep: pagador?.cep,
    logradouro: pagador?.logradouro,
    numero: pagador?.numero,
    bairro: pagador?.bairro,
    cidade: pagador?.cidade,
    uf: pagador?.uf
  })
}

// ---------- Vencimento ----------

function diaNumerico(ano, mes, dia) {
  return Math.floor(Date.UTC(ano, mes - 1, dia) / MS_POR_DIA)
}

function diaDeDataIso(valor) {
  const texto = String(valor ?? '')
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return diaNumerico(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const brasileiro = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (brasileiro) return diaNumerico(Number(brasileiro[3]), Number(brasileiro[2]), Number(brasileiro[1]))
  return null
}

function dataIsoDeDiaNumerico(dia) {
  const data = new Date(dia * MS_POR_DIA)
  const mes = String(data.getUTCMonth() + 1).padStart(2, '0')
  const diaMes = String(data.getUTCDate()).padStart(2, '0')
  return `${data.getUTCFullYear()}-${mes}-${diaMes}`
}

function diaDeAgora(agora) {
  const data = agora instanceof Date ? agora : new Date(agora ?? Date.now())
  if (isNaN(data.getTime())) return diaNumerico(2026, 1, 1)
  // Usa a data do relógio (fuso local/Brasília): é o "hoje" que o síndico vê.
  return diaNumerico(data.getFullYear(), data.getMonth() + 1, data.getDate())
}

// Ajusta o vencimento para a janela aceita pelo Mercado Pago (1 a 30 dias).
// Devolve a data efetiva, o ISO completo com fuso e se houve ajuste — a tela
// avisa o morador quando o vencimento cadastrado não pôde ser mantido.
export function ajustarVencimentoBoleto(dataVencimento, agora = new Date()) {
  const hoje = diaDeAgora(agora)
  const solicitado = diaDeDataIso(dataVencimento)
  const minima = hoje + DIAS_MINIMOS_VENCIMENTO
  const maxima = hoje + DIAS_MAXIMOS_VENCIMENTO
  let dia = solicitado == null ? maxima : solicitado
  let ajustada = false
  if (dia < minima) { dia = minima; ajustada = true }
  if (dia > maxima) { dia = maxima; ajustada = true }
  const data = dataIsoDeDiaNumerico(dia)
  return {
    data,
    iso: `${data}T23:59:59.000${FUSO_BRASILIA}`,
    dias: dia - hoje,
    ajustada,
    solicitada: solicitado == null ? '' : dataIsoDeDiaNumerico(solicitado)
  }
}

// ---------- Payload do pagamento ----------

// Valor mínimo que a API aceita para o boleto (bolbradesco). Conferido em
// produção em 30/09/2026: R$ 3,99 recusado (erro 4037), R$ 4,00 emitido.
export const VALOR_MINIMO_BOLETO = 4

// Converte "1.234,56", "R$ 1234,56" ou 1234.56 em número (nunca lança erro).
export function valorDoBoleto(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0
  const texto = String(valor ?? '').trim()
  if (!texto) return 0
  const brasileiro = texto.replace(/R\$\s?/gi, '').replace(/\s/g, '')
  if (brasileiro.includes(',')) return Number(brasileiro.replace(/\./g, '').replace(',', '.')) || 0
  return Number(brasileiro) || 0
}

// Corpo enviado ao POST /v1/payments. Erros (valor/pagador) voltam em `erros`
// em vez de lançar exceção, para o app mostrar a lista completa.
export function montarPagamentoBoleto({
  valor,
  descricao,
  dataVencimento,
  pagador,
  referenciaExterna,
  urlNotificacao,
  agora
} = {}) {
  const valorNumerico = valorDoBoleto(valor)
  const { pagador: pagadorFormatado, erros: errosPagador } = montarPagador(pagador || {})
  const erros = [...errosPagador]
  if (valorNumerico < VALOR_MINIMO_BOLETO) erros.push('O Mercado Pago só emite boleto a partir de R$ 4,00.')
  if (erros.length) return { corpo: null, erros, vencimento: null }

  const vencimento = ajustarVencimentoBoleto(dataVencimento, agora)
  const corpo = {
    transaction_amount: Number(valorNumerico.toFixed(2)),
    description: String(descricao ?? '').trim().slice(0, 200) || 'Cobrança do condomínio',
    payment_method_id: MEIO_PAGAMENTO_BOLETO,
    date_of_expiration: vencimento.iso,
    payer: pagadorFormatado
  }
  if (referenciaExterna) corpo.external_reference = String(referenciaExterna).slice(0, 60)
  if (urlNotificacao) corpo.notification_url = String(urlNotificacao)
  return { corpo, erros: [], vencimento }
}

// ---------- Resposta da API ----------

// Onde cada número vem de verdade (conferido com a API de produção em
// 30/09/2026, POST /v1/payments com bolbradesco):
//   barcode.content .......................... código de barras (44 dígitos)
//   transaction_details.barcode.content ....... o mesmo código de barras
//   transaction_details.digitable_line ........ LINHA DIGITÁVEL (47 dígitos)
//   transaction_details.external_resource_url . link do boleto no Mercado Pago
// A linha digitável NÃO vem em barcode.digitable_line (campo vazio) — era por
// isso que o boleto registrado ficava sem linha e o app voltava a mostrar o
// boleto de demonstração. A API de Ordens (mais nova) devolve os mesmos dados
// em transactions.payments[].payment_method; lemos as três formas.
export function extrairDadosBoletoResposta(resposta = {}) {
  const pagamento = resposta?.transactions?.payments?.[0] || {}
  const meio = pagamento.payment_method || {}
  const barras = resposta?.barcode || {}
  const detalhes = resposta?.transaction_details || {}

  const codigoBarras = somenteDigitos(
    barras.content || barras.content_ean || detalhes.barcode?.content
    || resposta.barcode_content || meio.barcode_content || ''
  )
  const linhaDigitavel = somenteDigitos(
    detalhes.digitable_line || barras.digitable_line || resposta.digitable_line || meio.digitable_line || ''
  )
  const status = String(resposta?.status || pagamento.status || '').trim()
  const statusDetalhe = String(resposta?.status_detail || pagamento.status_detail || '').trim()

  return {
    paymentId: String(resposta?.id || pagamento.id || '').trim(),
    referencia: String(
      detalhes.payment_method_reference_id || meio.reference || barras.reference || ''
    ).trim(),
    status,
    statusDetalhe,
    codigoBarras,
    linhaDigitavel,
    urlBoleto: String(detalhes.external_resource_url || meio.ticket_url || '').trim(),
    instituicaoFinanceira: String(
      detalhes.financial_institution || meio.financial_institution || barras.financial_institution
      || meio.forward_data?.financial_institution || ''
    ).trim(),
    codigoVerificacao: String(detalhes.verification_code || meio.verification_code || '').trim(),
    vencimento: String(resposta?.date_of_expiration || '').slice(0, 10),
    meioPagamento: String(resposta?.payment_method_id || meio.id || '').trim()
  }
}

export function boletoEstaPago(status) {
  return ['approved', 'paid'].includes(String(status ?? '').trim().toLowerCase())
}
// ---------- Webhook / Notificações IPN ----------

// Extrai o ID do pagamento e o tipo de evento recebido do Mercado Pago.
// Suporta os formatos clássicos (IPN: ?topic=payment&id=123 ou ?type=payment&data.id=123)
// e os webhooks modernos (corpo JSON com action="payment.updated", type="payment", data.id).
export function extrairDadosWebhookMercadoPago({ query = {}, body = {} } = {}) {
  const q = query || {}
  const b = body || {}

  const tipo = String(
    b.type || b.topic || b.action || q.type || q.topic || ''
  ).trim().toLowerCase()

  const paymentId = String(
    b.data?.id || b.id || q['data.id'] || q.id || ''
  ).trim()

  return {
    tipo,
    paymentId,
    eEventoPagamento: tipo.includes('payment') || tipo === ''
  }
}

// Constrói a URL pública padrão da Cloud Function HTTP do webhook para o tenant.
export function construirUrlWebhookMercadoPago(projectId = 'portaria-condominio-8fbc9', tenantId = '', regiao = 'us-central1') {
  const base = `https://${regiao}-${projectId}.cloudfunctions.net/webhookMercadoPago`
  if (!tenantId) return base
  return `${base}?tenantId=${encodeURIComponent(tenantId)}`
}


// Rótulo em português do status do Mercado Pago ('' quando desconhecido).
export function statusMercadoPagoLegivel(status) {
  const chave = String(status ?? '').trim().toLowerCase()
  const rotulos = {
    pending: 'Aguardando pagamento',
    action_required: 'Aguardando pagamento',
    in_process: 'Em processamento',
    authorized: 'Autorizado',
    approved: 'Pago',
    paid: 'Pago',
    rejected: 'Recusado',
    cancelled: 'Cancelado',
    canceled: 'Cancelado',
    expired: 'Vencido',
    refunded: 'Devolvido',
    charged_back: 'Estornado'
  }
  return rotulos[chave] || ''
}

// Mensagem legível de um erro da API do Mercado Pago
// ({ message, error, cause: [{ description }] }).
export function mensagemDeErroMercadoPago(dados) {
  if (!dados) return ''
  const causas = Array.isArray(dados.cause) ? dados.cause : []
  const descricoes = causas
    .map((causa) => causa?.description || causa?.code || '')
    .filter(Boolean)
  const partes = [dados.message, dados.error, ...descricoes].filter(Boolean)
  return [...new Set(partes.map((parte) => String(parte).trim()))].join(' — ').slice(0, 400)
}
