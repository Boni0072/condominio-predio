import React, { useMemo, useState } from 'react'
import { BANCO_OPCOES } from './tipos.js'
import {
  formatarDataVencimento,
  formatarValorBoleto,
  gerarCodigoBarras,
  gerarLinhaDigitavel,
  linhaDigitavelSoDigitos,
  temDadosBancarios
} from './boletoUtils.js'

// Boleto do morador: recebe a cobrança (documento que já existe em
// tenants/{condominioId}/boletos) e os dados bancários cadastrados pelo síndico
// e monta o boleto NO PRÓPRIO NAVEGADOR — nada é gravado no Firestore (o
// morador não tem permissão de escrita na coleção de boletos e não precisa
// ter: o cálculo é todo local, como já acontece com o PIX Copia e Cola).
// O botão "Baixar boleto" usa a janela de impressão do navegador
// (window.print), que permite salvar como PDF sem adicionar dependência nova.
export default function BoletoGerado({ boleto, dadosBancarios, beneficiario, onFechar, onCopiar, onPix }) {
  const configurado = temDadosBancarios(dadosBancarios)
  const banco = useMemo(
    () => BANCO_OPCOES.find((item) => item.codigo === String(dadosBancarios?.banco || '')) || null,
    [dadosBancarios?.banco]
  )

  const { codigoBarras, linhaDigitavel } = useMemo(() => {
    if (!boleto) return { codigoBarras: '', linhaDigitavel: '' }
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
  }, [boleto, dadosBancarios])

  const emitidoEm = useMemo(() => new Date().toLocaleString('pt-BR'), [])

  // Aviso do resultado das ações DENTRO do modal: a mensagem da página fica
  // atrás do overlay (e às vezes fora da tela), então sem isto o morador não vê
  // que a linha digitável foi copiada e pensa que o botão não funcionou.
  const [aviso, setAviso] = useState('')

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

  // Barras apenas ilustrativas, desenhadas a partir dos dígitos: não formam um
  // código de barras escaneável por banco (o boleto é de demonstração).
  const barras = useMemo(
    () => String(codigoBarras || '').split('').map((digito, indice) => ({
      indice,
      largura: 1 + (Number(digito) % 3),
      clara: Number(digito) % 2 === 1
    })),
    [codigoBarras]
  )

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
          <h2>{configurado ? 'Boleto da cobrança' : 'Boleto ainda não configurado'}</h2>
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
                {' '}<strong>Pagamentos › Configurar Contas › Dados bancários para boleto</strong>.
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
                    <span className='form-hint'>Ag. {dadosBancarios.agencia} · Conta {dadosBancarios.conta}</span>
                  </div>
                </div>

                <div className='boleto-impressao-codigo'>
                  <span className='pix-label'>
                    Linha digitável ({linhaDigitavelSoDigitos(linhaDigitavel).length} dígitos)
                  </span>
                  <strong className='boleto-linha-digitavel'>{linhaDigitavel || '—'}</strong>
                </div>

                <div className='boleto-impressao-grade'>
                  <div><span className='pix-label'>Sacado</span><strong>{sacado}</strong></div>
                  <div><span className='pix-label'>Nosso número</span><strong>{boleto.nossoNumero || '-'}</strong></div>
                  <div><span className='pix-label'>Vencimento</span><strong>{formatarDataVencimento(boleto.dataVencimento)}</strong></div>
                  <div><span className='pix-label'>Valor do documento</span><strong>{formatarValorBoleto(boleto.valor)}</strong></div>
                </div>

                <div className='boleto-barras' aria-hidden='true'>
                  {barras.map((barra) => (
                    <span
                      key={barra.indice}
                      className={barra.clara ? 'barra-clara' : 'barra-escura'}
                      style={{ width: `${barra.largura}px` }}
                    />
                  ))}
                </div>
                <span className='pix-label'>Código de barras</span>
                <code className='boleto-codigo-barras'>{codigoBarras}</code>

                <p className='form-hint'>
                  Boleto de demonstração gerado pelo app a partir desta cobrança em {emitidoEm} — sem registro
                  bancário. Depois de pagar, envie o comprovante para a administração dar baixa no boleto.
                </p>
              </div>

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
