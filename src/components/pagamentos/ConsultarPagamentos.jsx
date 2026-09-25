import React, { useState, useEffect, useMemo } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { TIPOS_PAGAMENTO, STATUS_BOLETO, PERFIS_VISAO_GERAL, PERFIS_GESTORES_PAGAMENTO } from './tipos.js'
import {
  formatarValorBoleto,
  formatarDataVencimento,
  boletoPertenceAoUsuario,
  gerarPixCopiaECola,
  statusEfetivo,
  temDadosBancarios
} from './boletoUtils.js'
import BoletoGerado from './BoletoGerado.jsx'
import { getMonthKey, nowISO, load, save } from '../../utils/storage.js'
import { COLECAO_BOLETOS, colecaoDoRegistro } from './cobrancas.js'
import { useCobrancas } from './useCobrancas.js'
import { QRCodeSVG } from 'qrcode.react'

const chavePix = (condominioId) => `${condominioId}_config_pix`

const NOMES_MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
]

// Rótulo da separação por mês da lista de boletos ("2026-09" → "Setembro de 2026").
function rotuloMes(chave) {
  if (!chave || chave === 'sem-data') return 'Sem vencimento'
  const [ano, mes] = String(chave).split('-').map(Number)
  if (!ano || !mes) return 'Sem vencimento'
  return `${NOMES_MESES[mes - 1] || mes} de ${ano}`
}

export default function ConsultarPagamentos() {
  const { userProfile, firebaseOK, condominio } = useAuth()
  const [pix, setPix] = useState(null)
  const [mensagem, setMensagem] = useState('')
  const [tipoMsg, setTipoMsg] = useState('info')
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroMes, setFiltroMes] = useState('')
  // Recolhimento da lista de boletos: por mês e, dentro do mês, por
  // pagos/não pagos. Tudo inicia RECOLHIDO.
  const [mesesExpandidos, setMesesExpandidos] = useState(() => new Set())
  const [gruposPagamentoAbertos, setGruposPagamentoAbertos] = useState(() => new Set())
  // Cobrança exibida no modal "Gerar boleto": a linha digitável e o código de
  // barras são calculados no navegador, a partir da cobrança que o morador já
  // pode LER + os dados bancários do condomínio. Nada é gravado no Firestore.
  const [boletoGerado, setBoletoGerado] = useState(null)

  const condominioId = userProfile?.condominioId || 'local'
  // Visão geral (todo o condomínio) é exclusiva dos gestores: síndico, zelador e
  // portaria. Qualquer outro perfil consulta somente os próprios boletos.
  const gerencia = PERFIS_VISAO_GERAL.includes(userProfile?.role)
  // Só os gestores (síndico/zelador/portaria) podem excluir boletos.
  const podeExcluir = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)
  const {
    cobrancas,
    carregando: loading,
    erroSincronizacao,
    firestoreAtivo,
    atualizarLocal
  } = useCobrancas()
  const boletos = useMemo(
    () => [...cobrancas].sort((a, b) => new Date(b.dataVencimento || 0) - new Date(a.dataVencimento || 0)),
    [cobrancas]
  )

  // Chave PIX: documento de ID fixo do condomínio, com cópia local para
  // continuar visível quando o dispositivo está sem conexão.
  useEffect(() => {
    const local = load(chavePix(condominioId))
    if (local?.chavePIX) setPix(local)
    if (!firebaseOK || !userProfile?.condominioId) return
    const unsub = onSnapshot(doc(db, 'tenants', condominioId, 'config_pix', 'principal'), (snap) => {
      if (!snap.exists()) return
      const dados = { id: snap.id, ...snap.data() }
      setPix(dados)
      save(chavePix(condominioId), dados)
    }, (erro) => {
      console.error('Erro ao sincronizar chave PIX:', erro)
    })
    return () => unsub()
  }, [firebaseOK, condominioId, userProfile?.condominioId])

  // Morador e conselheiro veem apenas os PRÓPRIOS boletos; somente os gestores
  // (síndico/zelador/portaria) veem os pagamentos de todo o condomínio.
  const visiveis = gerencia
    ? boletos
    : boletos.filter((b) => boletoPertenceAoUsuario(b, userProfile))

  const filtrados = visiveis.filter((b) => {
    if (b.removido) return false
    if (busca) {
      const alvo = busca.toLowerCase()
      const campos = [b.moradorNome, b.descricao, b.nossoNumero, b.moradorUnidade]
      if (!campos.some((v) => String(v || '').toLowerCase().includes(alvo))) return false
    }
    if (filtroStatus && statusEfetivo(b) !== filtroStatus) return false
    if (filtroTipo && b.tipo !== filtroTipo) return false
    if (filtroMes && getMonthKey(b.dataVencimento) !== filtroMes) return false
    return true
  })

  const totalAberto = filtrados
    .filter((b) => ['gerado', 'vencido'].includes(statusEfetivo(b)))
    .reduce((soma, b) => soma + (Number(b.valor) || 0), 0)
  const totalPago = filtrados
    .filter((b) => b.status === 'pago')
    .reduce((soma, b) => soma + (Number(b.valor) || 0), 0)

  // Separação da lista: mês de vencimento (mais recente primeiro) e, dentro
  // de cada mês, pagos × não pagos. Cancelados entram como "não pagos".
  // Morador e conselheiro veem apenas os PRÓPRIOS boletos em lista simples —
  // o agrupamento por mês (e o recolher/expandir) é só dos gestores.
  const gruposPorMes = (() => {
    if (!gerencia) return []
    const mapa = new Map()
    filtrados.forEach((b) => {
      const chave = getMonthKey(b.dataVencimento) || 'sem-data'
      if (!mapa.has(chave)) {
        mapa.set(chave, { chave, rotulo: rotuloMes(chave), pagos: [], naoPagos: [] })
      }
      const mes = mapa.get(chave)
      if (statusEfetivo(b) === 'pago') mes.pagos.push(b)
      else mes.naoPagos.push(b)
    })
    return [...mapa.values()].sort((a, b) => {
      if (a.chave === 'sem-data') return 1
      if (b.chave === 'sem-data') return -1
      return String(b.chave).localeCompare(String(a.chave))
    })
  })()

  const somaValor = (lista) => lista.reduce((soma, b) => soma + (Number(b.valor) || 0), 0)
  const chaveGrupo = (mes, grupo) => `${mes}:${grupo}`
  const mesAberto = (chave) => mesesExpandidos.has(chave)
  const grupoAberto = (mes, grupo) => gruposPagamentoAbertos.has(chaveGrupo(mes, grupo))

  function alternarMes(chave) {
    setMesesExpandidos((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return proximo
    })
  }

  function alternarGrupo(mes, grupo) {
    const chave = chaveGrupo(mes, grupo)
    setGruposPagamentoAbertos((atual) => {
      const proximo = new Set(atual)
      if (proximo.has(chave)) proximo.delete(chave)
      else proximo.add(chave)
      return proximo
    })
  }

  const todosAbertos = gruposPorMes.length > 0 && gruposPorMes.every((mes) => (
    mesAberto(mes.chave)
    && ['pagos', 'naoPagos'].every((grupo) => grupoAberto(mes.chave, grupo))
  ))

  function alternarTudo() {
    if (todosAbertos) {
      setMesesExpandidos(new Set())
      setGruposPagamentoAbertos(new Set())
      return
    }
    setMesesExpandidos(new Set(gruposPorMes.map((mes) => mes.chave)))
    setGruposPagamentoAbertos(new Set(
      gruposPorMes.flatMap((mes) => ['pagos', 'naoPagos'].map((grupo) => chaveGrupo(mes.chave, grupo)))
    ))
  }
  const boletosVencidos = filtrados.filter((b) => statusEfetivo(b) === 'vencido')
  const totalVencido = boletosVencidos.reduce((soma, b) => soma + (Number(b.valor) || 0), 0)
  const chavePIX = pix?.chavePIX || ''
  const chaveAtiva = pix?.ativo !== false

  // QR Code do PIX: contém o payload Copia e Cola (padrão EMV/BR Code do Banco
  // Central) — o app do banco lê e preenche os dados do recebedor automaticamente.
  const pixQRCode = chavePIX
    ? gerarPixCopiaECola({
        chave: chavePIX,
        nome: pix?.nomeRecebedor || condominio?.nome || 'Condominio',
        cidade: pix?.cidadeRebedor || pix?.cidadeRecebedor || 'SAO PAULO'
      })
    : ''

  // Gera o PIX Copia e Cola já com o valor e a identificação do boleto.
  const gerarPixDoBoleto = (boleto) => {
    const copia = gerarPixCopiaECola({
      chave: chavePIX,
      nome: pix?.nomeRecebedor || condominio?.nome || 'Condominio',
      cidade: pix?.cidadeRecebedor || 'SAO PAULO',
      valor: Number(boleto.valor) || 0,
      txid: String(boleto.nossoNumero || boleto.id || '').replace(/-/g, '').slice(0, 25),
      descricao: boleto.descricao || ''
    })
    copiar(copia, `PIX de ${formatarValorBoleto(boleto.valor)}`)
  }

  const copiar = async (texto, rotulo) => {
    if (!texto) {
      setMensagem('Nada para copiar — configure a chave PIX em "Configurar Contas".')
      setTipoMsg('info')
      return
    }
    try {
      await navigator.clipboard.writeText(texto)
      setMensagem(`${rotulo} copiado!`)
      setTipoMsg('success')
    } catch {
      setMensagem(`Não foi possível copiar automaticamente. ${rotulo}: ${texto}`)
      setTipoMsg('info')
    }
  }

  // Dados bancários cadastrados pelo síndico (Pagamentos › Configurar Contas).
  // Ficam no MESMO documento da chave PIX que o efeito acima já sincroniza —
  // portanto o morador não precisa de leitura nem de escrita extra.
  const dadosBancarios = useMemo(() => ({
    banco: pix?.banco || '',
    agencia: pix?.agencia || '',
    conta: pix?.conta || '',
    carteira: pix?.carteira || '',
    convenio: pix?.convenio || ''
  }), [pix])
  const boletoBancarioConfigurado = temDadosBancarios(dadosBancarios)

  // Abre o boleto da cobrança selecionada. Se o síndico ainda não cadastrou os
  // dados bancários, avisa de forma amigável (e o modal explica o que fazer) —
  // o PIX desta cobrança continua funcionando normalmente.
  const gerarBoleto = (boleto) => {
    if (!boletoBancarioConfigurado) {
      setMensagem('Boleto bancário ainda não configurado pelo síndico — pague por PIX.')
      setTipoMsg('info')
    }
    setBoletoGerado(boleto)
  }

  // Fallback do modal do boleto: copia o PIX da cobrança e fecha o modal, para
  // que a confirmação apareça na tela.
  const pagarComPixDoBoleto = (boleto) => {
    gerarPixDoBoleto(boleto)
    setBoletoGerado(null)
  }

  // Exclusão lógica do boleto: marca "removido" em vez de apagar, mantendo o
  // histórico no Firestore. O boleto some das listagens (aqui, na emissão e na
  // consulta do morador) porque todas filtram esse campo.
  const excluirBoleto = async (boleto) => {
    if (!podeExcluir) return
    const rotulo = `${boleto.moradorNome || 'Sem morador'} (${formatarValorBoleto(boleto.valor)})`
    if (!window.confirm(`Excluir o boleto de ${rotulo}? O registro sai das listagens.`)) return
    const alteracao = { removido: true, removidoEm: nowISO(), atualizadoEm: nowISO() }
    if (firestoreAtivo) {
      try {
        await updateDoc(doc(db, 'tenants', condominioId, colecaoDoRegistro(boleto), boleto.id), alteracao)
        setMensagem('Boleto excluído.')
        setTipoMsg('success')
      } catch (erro) {
        console.error('Erro ao excluir boleto:', erro)
        setMensagem('Não foi possível excluir o boleto. Verifique a conexão e tente novamente.')
        setTipoMsg('error')
      }
    } else {
      atualizarLocal((atuais) => atuais.map((b) => (
        b.id === boleto.id ? { ...b, ...alteracao } : b
      )))
      setMensagem('Boleto excluído neste dispositivo.')
      setTipoMsg('info')
    }
  }

  const getStatusBadge = (s) => {
    if (s === 'pago') return <span className='badge badge-green'>Pago</span>
    if (s === 'vencido') return <span className='badge badge-orange'>Vencido</span>
    if (s === 'cancelado') return <span className='badge badge-gray'>Cancelado</span>
    return <span className='badge badge-blue'>Pendente</span>
  }

  const getTipoBadge = (t) => {
    const tipo = TIPOS_PAGAMENTO.find((x) => x.id === t)
    return <span className='badge badge-purple'>{tipo?.label || t || 'Cobrança'}</span>
  }

  // Card de um boleto (usado dentro dos grupos mês × pagos/não pagos).
  const renderBoleto = (b) => {
    const status = statusEfetivo(b)
    return (
      <div key={b.id} className='boleto-item'>
        <div className='boleto-info'>
          <div className='boleto-header'>
            <strong>{b.moradorNome || 'Sem morador'}{b.moradorUnidade ? ` — ${b.moradorUnidade}` : ''}</strong>
            {getStatusBadge(status)}
            {getTipoBadge(b.tipo)}
          </div>
          <div className='boleto-dados'>
            <span>Descrição: <strong>{b.descricao || '-'}</strong></span>
            <span>Valor: <strong>{formatarValorBoleto(b.valor)}</strong></span>
            <span>Vencimento: <strong>{formatarDataVencimento(b.dataVencimento)}</strong></span>
            {b.pagoEm && <span>Pago em: <strong>{formatarDataVencimento(b.pagoEm)}</strong></span>}
            {b.nossoNumero && <span>Nosso nº: <strong>{b.nossoNumero}</strong></span>}
          </div>
          {b.observacoes && <p className='boleto-obs'>{b.observacoes}</p>}
        </div>
        <div className='boleto-actions'>
          {['gerado', 'vencido'].includes(status) ? (
            <>
              <button type='button' className='btn btn-brass btn-small' onClick={() => gerarPixDoBoleto(b)}>
                PIX deste boleto
              </button>
              {/* Boleto da mensalidade em um clique: usa os dados bancários
                  configurados pelo síndico e a própria cobrança — só leitura. */}
              <button type='button' className='btn btn-ghost btn-small' onClick={() => gerarBoleto(b)}>
                Gerar boleto
              </button>
            </>
          ) : (
            <span className='boleto-status-final'>{status === 'pago' ? 'Pagamento confirmado' : 'Cobrança cancelada'}</span>
          )}
          {podeExcluir && (
            <button type='button' className='btn btn-ghost btn-small btn-danger' onClick={() => excluirBoleto(b)}>
              Excluir
            </button>
          )}
        </div>
      </div>
    )
  }
  return (
    <div>
      {erroSincronizacao && <div className='alert alert-error'>{erroSincronizacao}</div>}
      {mensagem && <div className={'alert ' + (tipoMsg === 'success' ? 'alert-success' : tipoMsg === 'error' ? 'alert-error' : 'alert-info')}>{mensagem}</div>}

      <div className='card'>
        <div className='card-header'><h3>Resumo</h3></div>
        <div className='card-body'>
          <div className='resumo-pagamentos'>
            <div className='resumo-item'>
              <span>{gerencia ? 'Total a receber' : 'Total a pagar'}</span>
              <strong className='text-orange'>{formatarValorBoleto(totalAberto)}</strong>
            </div>
            <div className='resumo-item'>
              <span>{gerencia ? 'Total recebido' : 'Total pago'}</span>
              <strong className='text-green'>{formatarValorBoleto(totalPago)}</strong>
            </div>
            <div className='resumo-item'>
              <span>Boletos listados</span>
              <strong>{filtrados.length}</strong>
            </div>
          </div>
          {boletosVencidos.length > 0 && (
            <div className='resumo-alerta'>
              Atenção: {boletosVencidos.length} boleto(s) vencido(s) somando {formatarValorBoleto(totalVencido)}.
            </div>
          )}
        </div>
      </div>

      <div className='card'>
        <div className='card-header'><h3>Pagamento via PIX</h3></div>
        <div className='card-body'>
          {!chavePIX ? (
            <div className='empty'>
              <p>Chave PIX ainda não configurada.</p>
              <span>Peça ao síndico para cadastrar em Pagamentos › Configurar Contas.</span>
            </div>
          ) : (
            <div className='pix-caixa'>
              <div className='pix-dado'>
                <span className='pix-label'>Chave PIX {chaveAtiva ? '' : '(inativa)'}</span>
                <strong>{chavePIX}</strong>
              </div>
              {pix?.nomeRecebedor && (
                <div className='pix-dado'>
                  <span className='pix-label'>Recebedor</span>
                  <strong>{pix.nomeRecebedor}</strong>
                </div>
              )}
              <div className='pix-qr'>
                {pixQRCode && <QRCodeSVG value={pixQRCode} size={176} level='M' marginSize={2} />}
                <span className='pix-label'>Aponte a câmera do app do seu banco para pagar via PIX</span>
              </div>
              <div className='pix-acoes'>
                <button type='button' className='btn btn-brass btn-small' onClick={() => copiar(chavePIX, 'Chave PIX')}>
                  Copiar chave PIX
                </button>
                <button type='button' className='btn btn-ghost btn-small' onClick={() => {
                  const copia = gerarPixCopiaECola({
                    chave: chavePIX,
                    nome: pix?.nomeRecebedor || condominio?.nome || 'Condominio',
                    cidade: pix?.cidadeRecebedor || 'SAO PAULO'
                  })
                  copiar(copia, 'PIX Copia e Cola')
                }}>
                  Copiar PIX Copia e Cola
                </button>
              </div>
              <span className='form-hint'>
                Depois de pagar, envie o comprovante para a administração dar baixa no boleto.
              </span>
            </div>
          )}
        </div>
      </div>

      <div className='card'>
        <div className='card-header'>
          <h3>{gerencia ? 'Boletos do condomínio' : 'Meus boletos'}</h3>
          <div className='filtros-header'>
            <input type='text' placeholder='Buscar...' value={busca}
              onChange={(e) => setBusca(e.target.value)} className='input-busca' />
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className='select-filtro'>
              <option value=''>Todos os status</option>
              {STATUS_BOLETO.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className='select-filtro'>
              <option value=''>Todos os tipos</option>
              {TIPOS_PAGAMENTO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <div className='filtro-periodo'>
              <span>Vencimento em</span>
              <input type='month' value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)} />
              {filtroMes && <button type='button' className='btn btn-ghost btn-small' onClick={() => setFiltroMes('')}>Limpar</button>}
            </div>
          </div>
        </div>
        <div className='card-body'>
          {loading ? (
            <div className='loading'>Carregando pagamentos...</div>
          ) : filtrados.length === 0 ? (
            <div className='empty'>
              <p>Nenhum boleto encontrado.</p>
              <span>{gerencia ? 'Emita boletos na aba "Emitir Boletos".' : 'Você não possui cobranças no momento.'}</span>
            </div>
          ) : !gerencia ? (
            // Lista simples (sem agrupamento por mês) para morador e conselheiro:
            // eles consultam somente os próprios boletos.
            <>
              <div className='boletos-acoes'>
                <span className='form-hint'>
                  {filtrados.length} boleto(s) · do seu cadastro
                </span>
              </div>
              <div className='boletos-lista'>
                {filtrados.map(renderBoleto)}
              </div>
            </>
          ) : (
            <>
              <div className='boletos-acoes'>
                <span className='form-hint'>{gruposPorMes.length} mês(es) · iniciam recolhidos</span>
                <button type='button' className='btn btn-ghost btn-small' onClick={alternarTudo} aria-expanded={todosAbertos}>
                  {todosAbertos ? 'Recolher tudo' : 'Expandir tudo'}
                </button>
              </div>
              <div className='boletos-lista'>
                {gruposPorMes.map((mes) => {
                  const aberto = mesAberto(mes.chave)
                  const totalMes = somaValor([...mes.pagos, ...mes.naoPagos])
                  return (
                    <section key={mes.chave} className={`boleto-mes${aberto ? ' aberta' : ''}`}>
                      <button
                        type='button'
                        className='boleto-mes-cabecalho'
                        onClick={() => alternarMes(mes.chave)}
                        aria-expanded={aberto}
                        aria-label={`${aberto ? 'Recolher' : 'Expandir'} boletos de ${mes.rotulo}`}
                      >
                        <span className='boleto-grupo-nome'>
                          <strong>{aberto ? '▾' : '▸'} {mes.rotulo}</strong>
                          <small>{mes.pagos.length + mes.naoPagos.length} boleto(s)</small>
                        </span>
                        <span className='boleto-grupo-valor'>{formatarValorBoleto(totalMes)}</span>
                      </button>
                      {aberto && (
                        <div className='boleto-mes-conteudo'>
                          {[
                            { id: 'pagos', rotulo: 'Pagos', lista: mes.pagos },
                            { id: 'naoPagos', rotulo: 'Não pagos', lista: mes.naoPagos }
                          ].map((grupo) => (
                            <section key={grupo.id} className='boleto-grupo'>
                              <button
                                type='button'
                                className={`boleto-grupo-cabecalho${grupo.id === 'pagos' ? ' pagos' : ' nao-pagos'}`}
                                onClick={() => alternarGrupo(mes.chave, grupo.id)}
                                aria-expanded={grupoAberto(mes.chave, grupo.id)}
                                aria-label={`${grupoAberto(mes.chave, grupo.id) ? 'Recolher' : 'Expandir'} ${grupo.rotulo} de ${mes.rotulo}`}
                              >
                                <span className='boleto-grupo-nome'>
                                  <strong>{grupoAberto(mes.chave, grupo.id) ? '▾' : '▸'} {grupo.rotulo} ({grupo.lista.length})</strong>
                                </span>
                                <span className='boleto-grupo-valor'>{formatarValorBoleto(somaValor(grupo.lista))}</span>
                              </button>
                              {grupoAberto(mes.chave, grupo.id) && (
                                <div className='boletos-lista'>
                                  {grupo.lista.length === 0
                                    ? <p className='empty'>Nenhum boleto {grupo.id === 'pagos' ? 'pago' : 'não pago'} neste mês.</p>
                                    : grupo.lista.map(renderBoleto)}
                                </div>
                              )}
                            </section>
                          ))}
                        </div>
                      )}
                    </section>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Boleto do morador: a cobrança + os dados bancários do condomínio são
          transformados em linha digitável/código de barras no próprio
          navegador (nenhum updateDoc/setDoc na coleção de boletos). */}
      {boletoGerado && (
        <BoletoGerado
          boleto={boletoGerado}
          dadosBancarios={dadosBancarios}
          beneficiario={pix?.nomeRecebedor || condominio?.nome || 'Condomínio'}
          onFechar={() => setBoletoGerado(null)}
          onCopiar={copiar}
          onPix={pagarComPixDoBoleto}
        />
      )}
    </div>
  )
}

