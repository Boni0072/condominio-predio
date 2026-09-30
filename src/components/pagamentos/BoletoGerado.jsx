import React, { useEffect, useMemo, useState } from 'react'
import { BANCO_OPCOES } from './tipos.js'
import {
  analisarVencimentoBoleto,
  formatarDataVencimento,
  formatarLinhaDigitavel,
  formatarValorBoleto,
  gerarBarrasI25,
  gerarCodigoBarras,
  gerarLinhaDigitavel,
  linhaDigitavelSoDigitos,
  temDadosBancarios,
  validarCodigoBarras,
  validarLinhaDigitavel
} from './boletoUtils.js'
import { colecaoDoRegistro } from './cobrancas.js'
import {
  boletoRegistrado,
  buscarEnderecoPorCep,
  gerarBoletoRegistrado,
  mensagemErroMercadoPago,
  pagadorSugerido,
  somenteDigitos,
  statusMercadoPagoLegivel,
  sincronizarBoletoRegistrado,
  validarPagador,
  valorDoBoletoRegistrado,
  VALOR_MINIMO_BOLETO
} from './mercadoPago.js'

// Boleto do morador: recebe a cobrança (documento que já existe em
// tenants/{condominioId}/boletos) e os dados bancários cadastrados pelo síndico
// e monta o boleto NO PRÓPRIO NAVEGADOR — nada é gravado no Firestore (o
// morador não tem permissão de escrita na coleção de boletos e não precisa
// ter: o cálculo é todo local, como já acontece com o PIX Copia e Cola).
// O botão "Baixar boleto" usa a janela de impressão do navegador
// (window.print), que permite salvar como PDF sem adicionar dependência nova.
//
// BOLETO REGISTRADO (Mercado Pago): quando o síndico registra a cobrança no
// Mercado Pago, o código de barras de 44 dígitos e a linha digitável de 47
// passam a vir do BANCO e ficam gravados na própria cobrança (campos
// codigoBarras/linhaDigitavel/mercadoPagoId/urlBoleto). Nesse caso este modal
// usa os números OFICIAIS em vez do cálculo local e oferece o link do boleto
// para impressão. Como a chamada à API exige o Access Token (segredo), ela é
// feita pela Cloud Function gerarBoletoMercadoPago, nunca daqui.
export default function BoletoGerado({
  boleto,
  dadosBancarios,
  beneficiario,
  onFechar,
  onCopiar,
  onPix,
  podeRegistrar = false,
  mercadoPagoAtivo = false,
  onBoletoAtualizado,
  tenantId = '',
  // Cadastro do condomínio (tenants/{id}): o endereço dele é usado para
  // sugerir o endereço do pagador (é lá que o devedor mora).
  condominio = null,
}) {
  const registrado = boletoRegistrado(boleto)
  const configurado = registrado || temDadosBancarios(dadosBancarios)
  const banco = useMemo(() => {
    const codigo = registrado
      ? String(boleto?.codigoBarras || '').slice(0, 3)
      : String(dadosBancarios?.banco || '')
    return BANCO_OPCOES.find((item) => item.codigo === codigo) || null
  }, [dadosBancarios?.banco, registrado, boleto?.codigoBarras])

  const { codigoBarras, linhaDigitavel } = useMemo(() => {
    if (!boleto) return { codigoBarras: '', linhaDigitavel: '' }
    // Números oficiais do boleto registrado: não são recalculados (só a linha
    // digitável é derivada quando o documento antigo só tem o código de barras
    // oficial — é o mesmo cálculo que o banco faz, então continuam coerentes).
    if (boletoRegistrado(boleto)) {
      const barras = somenteDigitos(boleto.codigoBarras)
      const linhaOficial = somenteDigitos(boleto.linhaDigitavel)
      const linha = linhaOficial.length === 47
        ? linhaOficial
        : gerarLinhaDigitavel({ codigoBarras: barras })
      return {
        codigoBarras: barras,
        linhaDigitavel: linha.length === 47 ? formatarLinhaDigitavel(linha) : linha
      }
    }
    const opcoes = {
      banco: dadosBancarios?.banco,
      agencia: dadosBancarios?.agencia,
      conta: dadosBancarios?.conta,
      carteira: dadosBancarios?.carteira,
      nossoNumero: boleto.nossoNumero,
      valor: boleto.valor,
      dataVencimento: boleto.dataVencimento
    }
    const barrasDoBoleto = gerarCodigoBarras(opcoes)
    return {
      codigoBarras: barrasDoBoleto,
      linhaDigitavel: gerarLinhaDigitavel({ ...opcoes, codigoBarras: barrasDoBoleto })
    }
  }, [boleto?.codigoBarras, boleto?.linhaDigitavel, boleto?.nossoNumero, boleto?.valor, boleto?.dataVencimento, dadosBancarios?.banco, dadosBancarios?.agencia, dadosBancarios?.conta, dadosBancarios?.carteira])

  const emitidoEm = useMemo(() => new Date().toLocaleString('pt-BR'), [])

  // Validação FEBRABAN do que está NA TELA: tamanho (44/47), banco, moeda,
  // DV geral e DVs dos 3 campos da linha — MAIS a coerência do vencimento
  // (caso da linha 34190…0595…: DVs ok, mas divergia da cobrança; e boleto
  // de demonstração nunca é pagável no banco, pois não tem registro).
  // Sem isso o morador só descobria o "COD.BARRAS INVALIDO" na hora de pagar
  // no banco — agora o aviso aparece aqui, antes de imprimir.
  const validacaoBoleto = useMemo(() => {
    if (!configurado || !codigoBarras) return null
    const validacaoBarras = validarCodigoBarras(codigoBarras)
    const validacaoLinha = validarLinhaDigitavel(linhaDigitavel, codigoBarras)
    const erros = [...validacaoBarras.erros, ...validacaoLinha.erros]
    const fator = String(codigoBarras).replace(/\D/g, '').slice(5, 9)
    // No boleto REGISTRADO quem manda é o vencimento que o banco gravou na
    // linha (mercadoPagoVencimento): quando a cobrança vence em mais de 30
    // dias o Mercado Pago ajusta a data na emissão, e comparar com a data
    // original acusaria uma divergência que não existe.
    const dataReferencia = registrado
      ? (boleto?.mercadoPagoVencimento || boleto?.dataVencimento)
      : boleto?.dataVencimento
    const vencimento = analisarVencimentoBoleto({ fator, dataVencimento: dataReferencia })
    let avisoVencimento = ''
    if (vencimento.estado === 'sem-vencimento') {
      avisoVencimento = 'Boleto sem vencimento válido (fator zerado) — solicite a 2ª via atualizada.'
    } else if (dataReferencia && vencimento.data) {
      // O fator tem só 4 dígitos e o ciclo reinicia a cada ~27 anos (9999
      // estourou em 21/02/2025): 0595 pode ser 1999 ou 2026. Se a data que o
      // fator representa diverge da data da cobrança, a linha está
      // desatualizada e o banco recusa — peça a 2ª via.
      const iso = String(dataReferencia).slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const diaFator = vencimento.data.toISOString().slice(0, 10)
        if (diaFator !== iso) {
          const dataFmt = vencimento.data.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
          avisoVencimento = `Vencimento da linha (${dataFmt}) diferente da cobrança (${formatarDataVencimento(dataReferencia)}) — solicite a 2ª via atualizada. O banco recusa linha desatualizada como "inexistente".`
        } else if (vencimento.estado === 'vencido') {
          const dataFmt = vencimento.data.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
          avisoVencimento = `Boleto vencido em ${dataFmt} — solicite a 2ª via atualizada para pagar sem divergência no banco.`
        }
      } else if (vencimento.estado === 'vencido' && vencimento.data) {
        const dataFmt = vencimento.data.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
        avisoVencimento = `Boleto vencido em ${dataFmt} — solicite a 2ª via atualizada. O banco recusa boleto vencido há muito tempo como "inexistente".`
      }
    } else if (vencimento.estado === 'vencido' && vencimento.data) {
      const dataFmt = vencimento.data.toLocaleDateString('pt-BR', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
      avisoVencimento = `Boleto vencido em ${dataFmt} — solicite a 2ª via atualizada. O banco recusa boleto vencido há muito tempo como "inexistente".`
    }
    return { ok: erros.length === 0 && !avisoVencimento, erros, avisoVencimento, vencimento: vencimento.estado }
  }, [configurado, codigoBarras, linhaDigitavel, boleto?.dataVencimento, boleto?.mercadoPagoVencimento, registrado])

  // Aviso do resultado das ações DENTRO do modal: a mensagem da página fica
  // atrás do overlay (e às vezes fora da tela), então sem isto o morador não vê
  // que a linha digitável foi copiada e pensa que o botão não funcionou.
  const [aviso, setAviso] = useState('')

  // Dados do pagador exigidos pelo Mercado Pago para registrar o boleto:
  // nome completo, CPF/CNPJ, e-mail e o ENDEREÇO COMPLETO (rua, número,
  // bairro, CEP, cidade e UF — exigência do BACEN desde 30/09/2024; sem o
  // endereço a API recusa e nenhum código de barras real é gerado).
  //
  // REGISTRAR boleto é ação da administração, e o formulário já sai preenchido
  // com o que o sistema sabe do DEVEDOR: a ficha da cobrança (morador*/pagador*
  // de um registro anterior) e o endereço do condomínio. Os dados pessoais de
  // quem está clicando (o síndico) nunca entram — ver pagadorSugerido.
  const [pagador, setPagador] = useState(() => pagadorSugerido({ boleto, condominio }))
  const [registrando, setRegistrando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [buscandoCep, setBuscandoCep] = useState(false)

  // Trocar de cobrança (ou receber os dados já gravados) reajusta o formulário
  // do pagador. Depende só do id: o que o usuário digitou não é sobrescrito a
  // cada render.
  useEffect(() => {
    setPagador(pagadorSugerido({ boleto, condominio }))
  }, [boleto?.id])

  const alterarPagador = (campo, valor) => setPagador((atual) => ({ ...atual, [campo]: valor }))

  // CEP digitado → busca rua/bairro/cidade/UF no ViaCEP e completa os campos
  // (o gestor só confere o número). Falha na consulta não bloqueia: ele
  // preenche à mão.
  const completarEnderecoPeloCep = async () => {
    setBuscandoCep(true)
    setAviso('Consultando o CEP...')
    try {
      const endereco = await buscarEnderecoPorCep(pagador.cep)
      setPagador((atual) => ({ ...atual, ...endereco }))
      setAviso('Endereço preenchido pelo CEP — confira o número e o complemento.')
    } catch (erro) {
      setAviso(erro?.message || 'Não foi possível consultar o CEP.')
    } finally {
      setBuscandoCep(false)
    }
  }

  // Registra a cobrança no Mercado Pago via Cloud Function. A validação usa as
  // MESMAS regras do servidor (functions/mercadopagoBoleto.js), então o usuário
  // recebe o problema aqui em vez de um erro genérico da API.
  const registrarBoleto = async () => {
    if (!boleto?.id) {
      setAviso('Esta cobrança ainda não foi salva — emita o boleto antes de registrar no Mercado Pago.')
      return
    }
    const validacao = validarPagador(pagador)
    if (!validacao.ok) {
      setAviso(validacao.erros.join(' '))
      return
    }
    if (valorDoBoletoRegistrado(boleto?.valor) < VALOR_MINIMO_BOLETO) {
      setAviso('O Mercado Pago só emite boleto a partir de R$ 4,00.')
      return
    }
    setRegistrando(true)
    setAviso('Registrando o boleto no Mercado Pago...')
    try {
      const dados = await gerarBoletoRegistrado({
        boletoId: boleto.id,
        colecao: colecaoDoRegistro(boleto),
        valor: boleto.valor,
        descricao: boleto.descricao || 'Cobrança do condomínio',
        dataVencimento: boleto.dataVencimento,
        pagador,
        tenantId
      })
      onBoletoAtualizado?.({
        ...boleto,
        codigoBarras: dados.codigoBarras,
        linhaDigitavel: dados.linhaDigitavel,
        urlBoleto: dados.urlBoleto,
        mercadoPagoId: dados.paymentId,
        mercadoPagoReferencia: dados.referencia,
        mercadoPagoStatus: dados.status,
        mercadoPagoStatusDetalhe: dados.statusDetalhe,
        mercadoPagoVencimento: dados.vencimento?.data || boleto.dataVencimento,
        pagadorNome: pagador.nome,
        pagadorDocumento: somenteDigitos(pagador.documento),
        pagadorEmail: pagador.email,
        pagadorCep: somenteDigitos(pagador.cep),
        pagadorLogradouro: pagador.logradouro,
        pagadorNumero: pagador.numero,
        pagadorBairro: pagador.bairro,
        pagadorCidade: pagador.cidade,
        pagadorUf: pagador.uf
      })
      const vencimento = dados.vencimento
      const avisoVencimento = vencimento?.ajustada
        ? ` O vencimento foi ajustado para ${formatarDataVencimento(vencimento.data)} — o Mercado Pago aceita no máximo 30 dias.`
        : ''
      const avisoSalvo = dados.salvo === false
        ? ' Atenção: os números foram gerados, mas não foi possível gravá-los na cobrança — copie-os agora.'
        : ''
      setAviso(`Boleto registrado no Mercado Pago!${avisoVencimento}${avisoSalvo}`)
    } catch (erro) {
      console.error('Não foi possível registrar o boleto no Mercado Pago:', erro)
      setAviso(mensagemErroMercadoPago(erro))
    } finally {
      setRegistrando(false)
    }
  }

  // Consulta o status no Mercado Pago e, quando o pagamento está aprovado, a
  // própria função dá baixa na cobrança.
  const conferirPagamento = async () => {
    setSincronizando(true)
    setAviso('Consultando o pagamento no Mercado Pago...')
    try {
      const dados = await sincronizarBoletoRegistrado({
        boletoId: boleto.id,
        colecao: colecaoDoRegistro(boleto),
        paymentId: boleto.mercadoPagoId,
        tenantId
      })
      const alteracao = dados.alteracao || {}
      onBoletoAtualizado?.({
        ...boleto,
        mercadoPagoStatus: dados.status,
        mercadoPagoStatusDetalhe: dados.statusDetalhe,
        status: alteracao.status || boleto.status,
        pagoEm: alteracao.pagoEm || boleto.pagoEm
      })
      setAviso(dados.pago
        ? 'Pagamento confirmado no Mercado Pago — o boleto foi baixado como pago.'
        : `O Mercado Pago ainda não confirmou o pagamento (${statusMercadoPagoLegivel(dados.status) || 'aguardando'}).`)
    } catch (erro) {
      console.error('Não foi possível consultar o boleto no Mercado Pago:', erro)
      setAviso(mensagemErroMercadoPago(erro))
    } finally {
      setSincronizando(false)
    }
  }

  const abrirBoletoOficial = () => {
    if (!boleto?.urlBoleto) {
      setAviso('O Mercado Pago não devolveu o link deste boleto.')
      return
    }
    window.open(boleto.urlBoleto, '_blank', 'noopener')
  }

  // Cópia antiga (textarea + execCommand), usada quando a Clipboard API não
  // existe ou recusa a escrita — acontece em http:// na rede local, WebView e
  // navegadores antigos. É justamente por isso que o botão parecia "não fazer
  // nada": a cópia falhava em silêncio e o aviso ficava fora da tela.
  const copiarComSelecao = (conteudo) => {
    const area = document.createElement('textarea')
    area.value = conteudo
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    document.body.appendChild(area)
    area.select()
    const copiou = document.execCommand('copy')
    document.body.removeChild(area)
    return copiou
  }

  const copiar = async (texto, rotulo) => {
    const conteudo = String(texto || '')
    if (!conteudo) {
      setAviso(`Nada para copiar em ${rotulo}.`)
      return
    }
    let copiado = false
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(conteudo)
        copiado = true
      } catch (erro) {
        console.warn('Clipboard API recusou a cópia — tentando o método antigo:', erro)
      }
    }
    if (!copiado) {
      try {
        copiado = copiarComSelecao(conteudo)
      } catch (erro) {
        console.error(`Não foi possível copiar ${rotulo}:`, erro)
      }
    }
    if (copiado) {
      setAviso(`${rotulo} copiado!`)
      onCopiar?.(conteudo, rotulo)
      return
    }
    setAviso(`Não foi possível copiar ${rotulo} — selecione o texto e copie manualmente.`)
  }

  // Código de barras no padrão bancário brasileiro (Interleaved 2 of 5 / Febraban).
  // Renderizado em SVG vetorial de ponta a ponta na caixa, garantindo leitura
  // por leitores e aspecto oficial tanto na tela quanto na folha impressa.
  const dadosBarras = useMemo(() => {
    return gerarBarrasI25(codigoBarras)
  }, [codigoBarras])

  if (!boleto) return null

  const sacado = [boleto.moradorNome || 'Sem morador', boleto.moradorUnidade].filter(Boolean).join(' — ')

  const imprimir = () => {
    setAviso('')
    try {
      if (typeof window.print !== 'function') throw new Error('impressão indisponível neste navegador')
      window.print()
    } catch (erro) {
      console.error('Não foi possível abrir a impressão do boleto:', erro)
      setAviso('Não foi possível abrir a impressão neste aparelho — use "Copiar linha digitável" e pague por PIX.')
    }
  }

  return (
    <div className='modal-overlay' role='presentation'>
      <div className='modal modal-boleto' role='dialog' aria-modal='true' aria-label='Boleto da cobrança'>
        <div className='modal-header'>
          <h2>
            {registrado
              ? 'Boleto registrado (Mercado Pago)'
              : configurado ? 'Boleto da cobrança' : 'Boleto ainda não configurado'}
          </h2>
          <button type='button' className='modal-fechar' onClick={onFechar} aria-label='Fechar'>×</button>
        </div>
        <div className='modal-body'>
          {!configurado ? (
            <>
              <div className='alert alert-info'>
                Boleto bancário ainda não configurado pelo síndico — pague por PIX.
              </div>
              <p className='modal-info'>
                Para gerar o boleto desta mensalidade, o síndico precisa cadastrar banco, agência e conta em
                {' '}<strong>Pagamentos › Configurar Contas › Dados bancários para boleto</strong> — ou registrar
                as credenciais do Mercado Pago e emitir o boleto registrado na seção
                {' '}<strong>Boleto registrado (Mercado Pago)</strong>.
                Enquanto isso, o PIX deste boleto continua funcionando normalmente.
              </p>
            </>
          ) : (
            <>
              <div className='boleto-impressao'>
                <div className='boleto-impressao-topo'>
                  <div>
                    <span className='pix-label'>Beneficiário</span>
                    <strong>{beneficiario}</strong>
                    <span className='form-hint'>{boleto.descricao || 'Cobrança do condomínio'}</span>
                  </div>
                  <div>
                    <span className='pix-label'>Banco</span>
                    <strong>{banco ? `${banco.codigo} — ${banco.nome}` : dadosBancarios.banco}</strong>
                    <span className='form-hint'>
                      {registrado
                        ? `Registrado no Mercado Pago${boleto.mercadoPagoReferencia ? ` · ref. ${boleto.mercadoPagoReferencia}` : ''}`
                        : `Ag. ${dadosBancarios.agencia} · Conta ${dadosBancarios.conta}`}
                    </span>
                  </div>
                </div>

                <div className='boleto-impressao-codigo'>
                  <span className='pix-label'>
                    Linha digitável ({linhaDigitavelSoDigitos(linhaDigitavel).length} dígitos)
                  </span>
                  <strong className='boleto-linha-digitavel'>{linhaDigitavel || '—'}</strong>
                </div>

                {/* Validação exibida NA TELA antes de imprimir/pagar: se o banco
                    recusaria com "COD.BARRAS INVALIDO", o motivo aparece aqui.
                    Cobre DVs/tamanho E vencimento (fator antigo = vencido). */}
                {validacaoBoleto && validacaoBoleto.avisoVencimento && (
                  <div className='boleto-alerta boleto-alerta-vencido boleto-nao-imprimir' role='alert'>
                    <strong>{validacaoBoleto.avisoVencimento}</strong>
                    {!registrado && (
                      <span className='form-hint'>
                        Não tente pagar com esta linha — peça a 2ª via atualizada na
                        administração ou pague pelo PIX e envie o comprovante.
                      </span>
                    )}
                  </div>
                )}
                {/* Mesmo com DVs e vencimento OK, o boleto de DEMONSTRAÇÃO (sem
                    registro no banco) é recusado no caixa como inexistente.
                    Mostra o porquê AQUI em vez de deixar o morador descobrir
                    no "COD.BARRAS INVALIDO" do banco. */}
                {validacaoBoleto && validacaoBoleto.ok && !registrado && (
                  <div className='boleto-alerta boleto-nao-imprimir' role='note'>
                    <strong>Boleto de demonstração — o banco vai recusar como inexistente.</strong>
                    <span className='form-hint'>
                      Os números acima estão matematicamente corretos, mas não têm registro
                      no Itaú: o condomínio não tem convênio de cobrança. Não tente pagar
                      com eles — pague pelo PIX e envie o comprovante para a administração,
                      ou peça ao síndico para clicar em «Registrar no Mercado Pago» e gerar
                      o código oficial do banco.
                    </span>
                  </div>
                )}
                {validacaoBoleto && !validacaoBoleto.ok && validacaoBoleto.erros.length > 0 && (
                  <div className='boleto-alerta boleto-nao-imprimir' role='alert'>
                    <strong>Este boleto seria recusado no banco — não tente pagar com ele.</strong>
                    <ul>
                      {validacaoBoleto.erros.map((erro, i) => <li key={i}>{erro}</li>)}
                    </ul>
                    {!registrado && (
                      <span className='form-hint'>
                        Boleto de demonstração (sem registro): pague pelo PIX e envie o
                        comprovante para a administração — ou peça ao síndico para clicar em
                        «Registrar no Mercado Pago» e gerar o código oficial do banco.
                      </span>
                    )}
                  </div>
                )}

                <div className='boleto-impressao-grade'>
                  <div><span className='pix-label'>Sacado</span><strong>{sacado}</strong></div>
                  <div><span className='pix-label'>Nosso número</span><strong>{boleto.nossoNumero || '-'}</strong></div>
                  <div><span className='pix-label'>Vencimento</span><strong>{formatarDataVencimento(boleto.dataVencimento)}</strong></div>
                  <div><span className='pix-label'>Valor do documento</span><strong>{formatarValorBoleto(boleto.valor)}</strong></div>
                </div>

                <div className='boleto-barras' aria-hidden='true'>
                  {dadosBarras.totalLargura > 0 && (
                    <svg
                      viewBox={`0 0 ${dadosBarras.totalLargura} 50`}
                      preserveAspectRatio='none'
                      className='boleto-barras-svg'
                    >
                      {dadosBarras.barras.map((barra, i) => (
                        <rect
                          key={i}
                          x={barra.x}
                          y={0}
                          width={barra.largura}
                          height={50}
                          fill='#000000'
                        />
                      ))}
                    </svg>
                  )}
                </div>
                <span className='pix-label'>Código de barras</span>
                <code className='boleto-codigo-barras'>{codigoBarras}</code>

                <p className='form-hint'>
                  {registrado
                    ? 'Boleto registrado no Mercado Pago — pague pelo aplicativo do banco com a linha digitável acima. O pagamento é confirmado automaticamente.'
                    : `Boleto de demonstração gerado pelo app a partir desta cobrança em ${emitidoEm} — sem registro bancário. ${mercadoPagoAtivo
                      ? 'O código de barras oficial é registrado pela administração; enquanto isso, pague pelo PIX.'
                      : 'Depois de pagar por PIX, envie o comprovante para a administração dar baixa no boleto.'}`}
                </p>
              </div>

              {/* Painel do Mercado Pago: REGISTRAR o boleto é ação da
                  ADMINISTRAÇÃO (síndico/zelador/portaria). O morador não
                  registra nada — quando a cobrança já está registrada ele vê os
                  números oficiais e paga. Não sai na impressão — o impresso é
                  só o documento do boleto. */}
              {(podeRegistrar || mercadoPagoAtivo || registrado) && (
                <div className='boleto-mercado-pago boleto-nao-imprimir'>
                  <div className='boleto-mp-cabecalho'>
                    <strong>Mercado Pago</strong>
                    {registrado
                      ? <span className='badge badge-green'>{statusMercadoPagoLegivel(boleto.mercadoPagoStatus) || 'Registrado'}</span>
                      : <span className='badge badge-gray'>Boleto não registrado</span>}
                  </div>

                  {registrado ? (
                    <>
                      <div className='boleto-mp-dados'>
                        <span>Nosso número no banco: <strong>{boleto.mercadoPagoReferencia || '-'}</strong></span>
                        <span>Identificador no Mercado Pago: <strong>{boleto.mercadoPagoId || '-'}</strong></span>
                        <span>Vencimento no banco: <strong>{formatarDataVencimento(boleto.mercadoPagoVencimento || boleto.dataVencimento)}</strong></span>
                      </div>
                      <div className='form-actions'>
                        <button type='button' className='btn btn-brass btn-small' onClick={abrirBoletoOficial}>
                          Abrir boleto oficial
                        </button>
                        {podeRegistrar && (
                          <button
                            type='button'
                            className='btn btn-ghost btn-small'
                            onClick={conferirPagamento}
                            disabled={sincronizando}
                          >
                            {sincronizando ? 'Consultando...' : 'Conferir pagamento'}
                          </button>
                        )}
                      </div>
                    </>
                  ) : !podeRegistrar ? (
                    // MORADOR não registra boleto: ele espera/confere o que a
                    // administração registrou e paga por aqui mesmo.
                    <p className='form-hint'>
                      A administração ainda não registrou esta cobrança no Mercado Pago.
                      Assim que registrar, o <strong>código de barras (44 dígitos)</strong> e a
                      <strong> linha digitável (47)</strong> oficiais aparecem aqui para você
                      pagar pelo aplicativo do banco. Enquanto isso, use o
                      {' '}<strong>PIX deste boleto</strong> — a baixa é automática.
                    </p>
                  ) : !mercadoPagoAtivo ? (
                    <p className='form-hint'>
                      O síndico ainda não cadastrou o Access Token do Mercado Pago. Em
                      {' '}<strong>Pagamentos › Configurar Contas › Boleto registrado (Mercado Pago)</strong>,
                      o condomínio passa a emitir o boleto com o código de barras oficial do banco.
                    </p>
                  ) : (
                    <form onSubmit={(e) => { e.preventDefault(); registrarBoleto() }}>
                      <p className='form-hint'>
                        Preencha os dados do pagador — o Mercado Pago exige CPF/CNPJ, e-mail e o
                        endereço completo (rua, número, bairro, CEP, cidade e UF) para registrar
                        o boleto. O que o sistema já sabia deste devedor (nome, e-mail e o
                        endereço da cobrança/condomínio) está preenchido: confira e ajuste o que
                        for preciso. O código de barras (44 dígitos) e a linha digitável (47) são
                        gerados pelo banco e ficam gravados nesta cobrança.
                      </p>
                      <div className='form-grid'>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-nome'>Nome completo do pagador *</label>
                          <input
                            type='text'
                            id='mp-pagador-nome'
                            value={pagador.nome}
                            onChange={(e) => alterarPagador('nome', e.target.value)}
                            placeholder='Ex.: Maria Aparecida Souza'
                            className='input'
                          />
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-doc'>CPF ou CNPJ *</label>
                          <input
                            type='text'
                            id='mp-pagador-doc'
                            value={pagador.documento}
                            onChange={(e) => alterarPagador('documento', e.target.value)}
                            inputMode='numeric'
                            placeholder='000.000.000-00'
                            className='input'
                          />
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-email'>E-mail do pagador *</label>
                          <input
                            type='email'
                            id='mp-pagador-email'
                            value={pagador.email}
                            onChange={(e) => alterarPagador('email', e.target.value)}
                            placeholder='morador@email.com'
                            className='input'
                          />
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-cep'>CEP *</label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input
                              type='text'
                              id='mp-pagador-cep'
                              value={pagador.cep}
                              onChange={(e) => alterarPagador('cep', e.target.value)}
                              onBlur={() => {
                                if (somenteDigitos(pagador.cep).length === 8) completarEnderecoPeloCep()
                              }}
                              inputMode='numeric'
                              placeholder='00000-000'
                              className='input'
                            />
                            <button
                              type='button'
                              className='btn btn-ghost btn-small'
                              onClick={completarEnderecoPeloCep}
                              disabled={buscandoCep}
                            >
                              {buscandoCep ? 'Buscando...' : 'Buscar CEP'}
                            </button>
                          </div>
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-rua'>Rua (logradouro) *</label>
                          <input
                            type='text'
                            id='mp-pagador-rua'
                            value={pagador.logradouro}
                            onChange={(e) => alterarPagador('logradouro', e.target.value)}
                            placeholder='Ex.: Rua das Acácias'
                            className='input'
                          />
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-numero'>Número</label>
                          <input
                            type='text'
                            id='mp-pagador-numero'
                            value={pagador.numero}
                            onChange={(e) => alterarPagador('numero', e.target.value)}
                            placeholder='Ex.: 120 (em branco vira S/N)'
                            className='input'
                          />
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-bairro'>Bairro *</label>
                          <input
                            type='text'
                            id='mp-pagador-bairro'
                            value={pagador.bairro}
                            onChange={(e) => alterarPagador('bairro', e.target.value)}
                            placeholder='Ex.: Centro'
                            className='input'
                          />
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-cidade'>Cidade *</label>
                          <input
                            type='text'
                            id='mp-pagador-cidade'
                            value={pagador.cidade}
                            onChange={(e) => alterarPagador('cidade', e.target.value)}
                            placeholder='Ex.: São Paulo'
                            className='input'
                          />
                        </div>
                        <div className='form-group'>
                          <label htmlFor='mp-pagador-uf'>UF *</label>
                          <input
                            type='text'
                            id='mp-pagador-uf'
                            value={pagador.uf}
                            onChange={(e) => alterarPagador('uf', e.target.value.toUpperCase())}
                            maxLength={2}
                            placeholder='SP'
                            className='input'
                          />
                        </div>
                      </div>
                      <div className='form-actions'>
                        <button type='submit' className='btn btn-brass btn-small' disabled={registrando}>
                          {registrando ? 'Registrando...' : 'Registrar no Mercado Pago'}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

            </>
          )}
        </div>

        {/* Rodapé de ações SEMPRE visível: em telas baixas o corpo do modal rola,
            mas estes botões ficam fora da área rolável. Antes eram os últimos
            elementos do corpo e ficavam cortados (não recebiam o toque). */}
        <div className='modal-boleto-acoes boleto-nao-imprimir'>
          {aviso && <span className='boleto-aviso' role='status'>{aviso}</span>}
          {configurado ? (
            <>
              <button
                type='button'
                className='btn btn-ghost btn-small'
                onClick={() => copiar(linhaDigitavel, 'Linha digitável')}
              >
                Copiar linha digitável
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-small'
                onClick={() => copiar(codigoBarras, 'Código de barras')}
              >
                Copiar código de barras
              </button>
              <button
                type='button'
                className='btn btn-brass btn-small'
                onClick={imprimir}
                title='Abre a janela de impressão — escolha "Salvar como PDF"'
              >
                Baixar boleto
              </button>
              {registrado && boleto.urlBoleto && (
                <button
                  type='button'
                  className='btn btn-ghost btn-small'
                  onClick={abrirBoletoOficial}
                  title='Abre o boleto oficial gerado pelo Mercado Pago'
                >
                  Boleto oficial
                </button>
              )}
              {onPix && (
                <button type='button' className='btn btn-ghost btn-small' onClick={() => onPix(boleto)}>
                  PIX deste boleto
                </button>
              )}
              <button type='button' className='btn btn-ghost btn-small' onClick={onFechar}>
                Fechar
              </button>
            </>
          ) : (
            <>
              <button
                type='button'
                className='btn btn-brass btn-small'
                onClick={() => onPix?.(boleto)}
                disabled={!onPix}
              >
                Pagar com PIX deste boleto
              </button>
              <button type='button' className='btn btn-ghost btn-small' onClick={onFechar}>
                Fechar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
