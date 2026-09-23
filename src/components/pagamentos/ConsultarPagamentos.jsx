import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { collection, doc, onSnapshot, updateDoc } from 'firebase/firestore'
import { TIPOS_PAGAMENTO, STATUS_BOLETO, PERFIS_VISAO_GERAL, PERFIS_GESTORES_PAGAMENTO } from './tipos.js'
import {
  formatarValorBoleto,
  formatarDataVencimento,
  boletoPertenceAoUsuario,
  gerarPixCopiaECola,
  statusEfetivo
} from './boletoUtils.js'
import { getMonthKey, nowISO, load, save } from '../../utils/storage.js'
import { QRCodeSVG } from 'qrcode.react'

const chaveBoletos = (condominioId) => `${condominioId}_boletos`
const chavePix = (condominioId) => `${condominioId}_config_pix`

export default function ConsultarPagamentos() {
  const { userProfile, firebaseOK, condominio } = useAuth()
  const [boletos, setBoletos] = useState([])
  const [pix, setPix] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mensagem, setMensagem] = useState('')
  const [tipoMsg, setTipoMsg] = useState('info')
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroMes, setFiltroMes] = useState('')

  const condominioId = userProfile?.condominioId || 'local'
  const gerencia = PERFIS_VISAO_GERAL.includes(userProfile?.role)
  // Só os gestores (síndico/zelador/portaria) podem excluir boletos.
  const podeExcluir = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)
  useEffect(() => {
    if (!firebaseOK || !userProfile?.condominioId) {
      setBoletos(load(chaveBoletos(condominioId)) || [])
      setLoading(false)
      return
    }
    const unsub = onSnapshot(collection(db, 'tenants', condominioId, 'boletos'), (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      lista.sort((a, b) => new Date(b.dataVencimento || 0) - new Date(a.dataVencimento || 0))
      setBoletos(lista)
      save(chaveBoletos(condominioId), lista)
      setLoading(false)
    }, (erro) => {
      console.error('Erro ao sincronizar boletos:', erro)
      setBoletos(load(chaveBoletos(condominioId)) || [])
      setLoading(false)
    })
    return () => unsub()
  }, [firebaseOK, condominioId, userProfile?.condominioId])

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

  // Morador/conselheiro vê apenas os próprios boletos; gestão vê o condomínio todo.
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

  // Exclusão lógica do boleto: marca "removido" em vez de apagar, mantendo o
  // histórico no Firestore. O boleto some das listagens (aqui, na emissão e na
  // consulta do morador) porque todas filtram esse campo.
  const excluirBoleto = async (boleto) => {
    if (!podeExcluir) return
    const rotulo = `${boleto.moradorNome || 'Sem morador'} (${formatarValorBoleto(boleto.valor)})`
    if (!window.confirm(`Excluir o boleto de ${rotulo}? O registro sai das listagens.`)) return
    const alteracao = { removido: true, removidoEm: nowISO(), atualizadoEm: nowISO() }
    try {
      if (!firebaseOK || !userProfile?.condominioId) throw new Error('sem-firestore')
      await updateDoc(doc(db, 'tenants', condominioId, 'boletos', boleto.id), alteracao)
      setMensagem('Boleto excluído.')
      setTipoMsg('success')
    } catch (erro) {
      if (erro?.message !== 'sem-firestore') console.error('Erro ao excluir boleto:', erro)
      const locais = (load(chaveBoletos(condominioId)) || []).map((b) => (b.id === boleto.id ? { ...b, ...alteracao } : b))
      save(chaveBoletos(condominioId), locais)
      setBoletos(locais)
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
  return (
    <div>
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
          ) : (
            <div className='boletos-lista'>
              {filtrados.map((b) => {
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
                        <button type='button' className='btn btn-brass btn-small' onClick={() => gerarPixDoBoleto(b)}>
                          PIX deste boleto
                        </button>
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
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

