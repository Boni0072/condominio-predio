import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { db } from '../../firebase/config.js'
import { collection, addDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore'
import { TIPOS_PAGAMENTO, STATUS_BOLETO, PERFIS_GESTORES_PAGAMENTO } from './tipos.js'
import { formatarValorBoleto, formatarDataVencimento, gerarNossoNumero, statusEfetivo } from './boletoUtils.js'
import { uid, nowISO, load, save } from '../../utils/storage.js'

const chaveBoletos = (condominioId) => `${condominioId}_boletos`

function formVazio() {
  return {
    id: '',
    moradorId: '',
    moradorUserId: '',
    moradorNome: '',
    moradorUnidade: '',
    moradorEmail: '',
    tipo: 'mensalidade',
    descricao: '',
    valor: '',
    dataVencimento: new Date().toISOString().split('T')[0],
    status: 'gerado',
    observacoes: '',
    nossoNumero: ''
  }
}

export default function EmissaoBoleto() {
  const { userProfile, firebaseOK } = useAuth()
  const { moradores, usuarios } = useApp()
  const [boletos, setBoletos] = useState([])
  const [loading, setLoading] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [tipoMsg, setTipoMsg] = useState('success')
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [form, setForm] = useState(formVazio)

  const condominioId = userProfile?.condominioId || 'local'
  const podeEditar = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)

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

  // Opções de cobrança: cadastro de moradores do condomínio (AppContext) +
  // contas de usuário com login (Firestore). O "value" leva prefixo para não
  // confundir os dois identificadores.
  const emailsMoradores = new Set(
    (moradores || []).map((m) => String(m.email || '').trim().toLowerCase()).filter(Boolean)
  )
  const opcoesMoradores = [
    ...(moradores || []).map((m) => ({
      value: `morador:${m.id}`,
      nome: m.nome || 'Sem nome',
      unidade: m.unidade || '',
      email: m.email || '',
      moradorId: m.id,
      moradorUserId: ''
    })),
    ...(usuarios || [])
      .filter((u) => ['morador', 'conselheiro'].includes(u.role))
      .filter((u) => !emailsMoradores.has(String(u.email || '').trim().toLowerCase()))
      .map((u) => ({
        value: `usuario:${u.id}`,
        nome: u.nome || u.email || 'Usuário',
        unidade: u.unidade || '',
        email: u.email || '',
        moradorId: '',
        moradorUserId: u.id
      }))
  ]

  const rotuloMorador = (o) =>
    `${o.nome}${o.unidade ? ' — ' + o.unidade : ''}${o.email ? ' (' + o.email + ')' : ''}`

  const selecionarMorador = (value) => {
    const opcao = opcoesMoradores.find((o) => o.value === value)
    setForm((prev) => ({
      ...prev,
      moradorId: opcao?.moradorId || '',
      moradorUserId: opcao?.moradorUserId || '',
      moradorNome: opcao?.nome || '',
      moradorUnidade: opcao?.unidade || '',
      moradorEmail: opcao?.email || ''
    }))
  }

  const limparForm = () => {
    setForm(formVazio())
    setMostrarForm(false)
  }

  const editarBoleto = (boleto) => {
    setForm({
      id: boleto.id,
      moradorId: boleto.moradorId || '',
      moradorUserId: boleto.moradorUserId || '',
      moradorNome: boleto.moradorNome || '',
      moradorUnidade: boleto.moradorUnidade || '',
      moradorEmail: boleto.moradorEmail || '',
      tipo: boleto.tipo || 'mensalidade',
      descricao: boleto.descricao || '',
      valor: boleto.valor != null ? String(boleto.valor) : '',
      dataVencimento: boleto.dataVencimento || formVazio().dataVencimento,
      status: boleto.status || 'gerado',
      observacoes: boleto.observacoes || '',
      nossoNumero: boleto.nossoNumero || ''
    })
    setMostrarForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!podeEditar) {
      setMensagem('Você não tem permissão para emitir boletos.')
      setTipoMsg('error')
      return
    }
    if (!form.moradorNome) {
      setMensagem('Selecione o morador que receberá a cobrança.')
      setTipoMsg('error')
      return
    }
    const valor = Number(String(form.valor).replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(valor) || valor <= 0) {
      setMensagem('Informe um valor válido (ex.: 250,00).')
      setTipoMsg('error')
      return
    }
    if (!form.dataVencimento) {
      setMensagem('Informe a data de vencimento.')
      setTipoMsg('error')
      return
    }

    const dados = {
      moradorId: form.moradorId,
      moradorUserId: form.moradorUserId,
      moradorNome: form.moradorNome,
      moradorUnidade: form.moradorUnidade,
      moradorEmail: form.moradorEmail,
      tipo: form.tipo,
      descricao: form.descricao.trim(),
      valor,
      dataVencimento: form.dataVencimento,
      status: form.status,
      observacoes: form.observacoes.trim(),
      nossoNumero: form.nossoNumero || gerarNossoNumero(),
      emitidoPor: userProfile?.nome || userProfile?.email || 'sistema'
    }
    setSalvando(true)
    try {
      if (firebaseOK && userProfile?.condominioId) {
        if (form.id) {
          await updateDoc(doc(db, 'tenants', condominioId, 'boletos', form.id), { ...dados, atualizadoEm: nowISO() })
        } else {
          await addDoc(collection(db, 'tenants', condominioId, 'boletos'), {
            ...dados, criadoEm: nowISO(), atualizadoEm: nowISO(), condominioId, removido: false
          })
        }
        setMensagem(form.id ? 'Boleto atualizado!' : 'Boleto emitido!')
      } else {
        throw new Error('sem-firestore')
      }
      setTipoMsg('success')
    } catch (erro) {
      if (erro?.message !== 'sem-firestore') console.error('Erro ao salvar boleto:', erro)
      // Sem conexão com o Firestore: mantém a emissão neste dispositivo para
      // que o síndico não perca o trabalho (a lista local é substituída assim
      // que o Firestore volta a responder).
      const locais = load(chaveBoletos(condominioId)) || []
      const atualizados = form.id
        ? locais.map((b) => (b.id === form.id ? { ...b, ...dados, atualizadoEm: nowISO() } : b))
        : [...locais, { ...dados, id: uid(), criadoEm: nowISO(), atualizadoEm: nowISO(), removido: false }]
      save(chaveBoletos(condominioId), atualizados)
      setBoletos(atualizados)
      setMensagem(form.id ? 'Boleto atualizado neste dispositivo.' : 'Boleto emitido neste dispositivo.')
      setTipoMsg('info')
    } finally {
      setSalvando(false)
      limparForm()
    }
  }

  const atualizarStatus = async (id, novoStatus) => {
    if (!podeEditar) return
    const alteracao = { status: novoStatus, atualizadoEm: nowISO() }
    if (novoStatus === 'pago') alteracao.pagoEm = nowISO()
    try {
      if (firebaseOK && userProfile?.condominioId) {
        await updateDoc(doc(db, 'tenants', condominioId, 'boletos', id), alteracao)
        setMensagem('Status do boleto atualizado!')
        setTipoMsg('success')
        return
      }
      throw new Error('sem-firestore')
    } catch (erro) {
      if (erro?.message !== 'sem-firestore') console.error('Erro ao atualizar boleto:', erro)
      const locais = (load(chaveBoletos(condominioId)) || []).map((b) => (b.id === id ? { ...b, ...alteracao } : b))
      save(chaveBoletos(condominioId), locais)
      setBoletos(locais)
      setMensagem('Status atualizado neste dispositivo.')
      setTipoMsg('info')
    }
  }

  // Exclusão lógica do boleto: marca "removido" em vez de apagar, para
  // preservar o histórico. Sai de todas as listagens (EmissaoBoleto,
  // ConsultarPagamentos e a consulta do morador filtram esse campo).
  const excluirBoleto = async (boleto) => {
    if (!podeEditar) return
    const rotulo = `${boleto.moradorNome || 'Sem morador'} (${formatarValorBoleto(boleto.valor)})`
    if (!window.confirm(`Excluir o boleto de ${rotulo}? O registro sai das listagens.`)) return
    const alteracao = { removido: true, removidoEm: nowISO(), atualizadoEm: nowISO() }
    try {
      if (firebaseOK && userProfile?.condominioId) {
        await updateDoc(doc(db, 'tenants', condominioId, 'boletos', boleto.id), alteracao)
        setMensagem('Boleto excluído.')
        setTipoMsg('success')
        if (form.id === boleto.id) limparForm()
        return
      }
      throw new Error('sem-firestore')
    } catch (erro) {
      if (erro?.message !== 'sem-firestore') console.error('Erro ao excluir boleto:', erro)
      const locais = (load(chaveBoletos(condominioId)) || []).map((b) => (b.id === boleto.id ? { ...b, ...alteracao } : b))
      save(chaveBoletos(condominioId), locais)
      setBoletos(locais)
      setMensagem('Boleto excluído neste dispositivo.')
      setTipoMsg('info')
      if (form.id === boleto.id) limparForm()
    }
  }

  // ---- Filtros e totais exibidos na listagem ----

  const filtrados = boletos.filter((b) => {
    if (b.removido) return false
    if (busca) {
      const alvo = busca.toLowerCase()
      const campos = [b.moradorNome, b.descricao, b.nossoNumero]
      if (!campos.some((v) => String(v || '').toLowerCase().includes(alvo))) return false
    }
    if (filtroTipo && b.tipo !== filtroTipo) return false
    if (filtroStatus && statusEfetivo(b) !== filtroStatus) return false
    return true
  })

  const totalAberto = filtrados
    .filter((b) => ['gerado', 'vencido'].includes(statusEfetivo(b)))
    .reduce((soma, b) => soma + (Number(b.valor) || 0), 0)
  const totalPago = filtrados
    .filter((b) => b.status === 'pago')
    .reduce((soma, b) => soma + (Number(b.valor) || 0), 0)

  // Badges de status e tipo da listagem (mesmo padrão de ConsultarPagamentos).
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
      {mensagem && <div className={'alert ' + (tipoMsg === 'error' ? 'alert-error' : tipoMsg === 'success' ? 'alert-success' : 'alert-info')}>{mensagem}</div>}

      <div className='card'>
        <div className='card-header'><h3>Resumo</h3></div>
        <div className='card-body'>
          <div className='resumo-boletos'>
            <div className='resumo-item'><span>Boletos:</span><strong>{filtrados.length}</strong></div>
            <div className='resumo-item'><span>Em aberto:</span><strong className='text-orange'>{formatarValorBoleto(totalAberto)}</strong></div>
            <div className='resumo-item'><span>Pagos:</span><strong className='text-green'>{formatarValorBoleto(totalPago)}</strong></div>
          </div>
        </div>
      </div>

      <div className='card'>
        <div className='card-header'>
          <h3>Novo Boleto</h3>
          {!mostrarForm && !form.id && (
            <button type='button' className='btn btn-brass btn-small' onClick={() => setMostrarForm(true)}>
              + Novo boleto
            </button>
          )}
        </div>
        <div className='card-body'>
          {!(mostrarForm || form.id) ? (
            <p className='sub'>Clique em "+ Novo boleto" para emitir uma cobrança para um morador.</p>
          ) : (
          <form onSubmit={handleSubmit} className='form-novo-boleto'>
            <div className='form-grid'>
              <div className='form-group'>
                <label htmlFor='morador'>Morador *</label>
                <select id='morador' value={form.moradorId} onChange={(e) => selecionarMorador(e.target.value)} className='select'>
                  <option value=''>Selecione...</option>
                  {opcoesMoradores.map((o) => <option key={o.value} value={o.value}>{rotuloMorador(o)}</option>)}
                </select>
              </div>
              <div className='form-group'>
                <label htmlFor='tipo'>Tipo</label>
                <select id='tipo' value={form.tipo} onChange={(e) => setForm((prev) => ({ ...prev, tipo: e.target.value }))} className='select'>
                  {TIPOS_PAGAMENTO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </div>
              <div className='form-group'>
                <label htmlFor='valor'>Valor (R$) *</label>
                <input type='text' id='valor' value={form.valor} inputMode='decimal'
                  onChange={(e) => setForm((prev) => ({ ...prev, valor: e.target.value.replace(/[^0-9,.]/g, '') }))}
                  placeholder='0,00' className='input' />
              </div>
              <div className='form-group'>
                <label htmlFor='vencimento'>Vencimento *</label>
                <input type='date' id='vencimento' value={form.dataVencimento}
                  onChange={(e) => setForm((prev) => ({ ...prev, dataVencimento: e.target.value }))} className='input' />
              </div>
              <div className='form-group'>
                <label htmlFor='status'>Status</label>
                <select id='status' value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))} className='select'>
                  {STATUS_BOLETO.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
              <div className='form-group'>
                <label htmlFor='nossoNumero'>Nosso número</label>
                <input type='text' id='nossoNumero' value={form.nossoNumero} readOnly
                  placeholder='Gerado automaticamente' className='input' />
                <span className='form-hint'>Gerado automaticamente se ficar em branco</span>
              </div>
            </div>
            <div className='form-group'>
              <label htmlFor='descricao'>Descrição</label>
              <input type='text' id='descricao' value={form.descricao}
                onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
                placeholder='Ex.: Taxa condominial de setembro' className='input' />
            </div>
            <div className='form-group'>
              <label htmlFor='obs'>Observações</label>
              <textarea id='obs' rows={2} value={form.observacoes} className='textarea'
                onChange={(e) => setForm((prev) => ({ ...prev, observacoes: e.target.value }))}
                placeholder='Informações extras para o morador' />
            </div>
            <div className='form-actions'>
              <button type='submit' className='btn btn-brass' disabled={salvando}>
                {salvando ? 'Salvando...' : form.id ? 'Atualizar Boleto' : 'Emitir Boleto'}
              </button>
              {form.id && (
                <button type='button' className='btn btn-ghost' onClick={limparForm}>
                  Cancelar edição
                </button>
              )}
            </div>
          </form>
          )}
        </div>
      </div>

      <div className='card'>
        <div className='card-header'>
          <h3>Boletos</h3>
          <div className='filtros-header'>
            <input type='text' placeholder='Buscar morador, descrição ou nº...' value={busca}
              onChange={(e) => setBusca(e.target.value)} className='input-busca' />
            <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className='select-filtro'>
              <option value=''>Todos os tipos</option>
              {TIPOS_PAGAMENTO.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className='select-filtro'>
              <option value=''>Todos os status</option>
              {STATUS_BOLETO.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
        </div>
        <div className='card-body'>
          {loading ? (
            <div className='loading'>Carregando boletos...</div>
          ) : filtrados.length === 0 ? (
            <div className='empty'>
              <p>Nenhum boleto encontrado.</p>
              <span>Use o formulário acima para emitir uma cobrança.</span>
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
                        {b.nossoNumero && <span>Nosso nº: <strong>{b.nossoNumero}</strong></span>}
                      </div>
                      {b.observacoes && <p className='boleto-obs'>{b.observacoes}</p>}
                    </div>
                    {podeEditar && (
                      <div className='boleto-actions'>
                        <button type='button' className='btn btn-ghost btn-small' onClick={() => editarBoleto(b)}>Editar</button>
                        {['gerado', 'vencido'].includes(status) && (
                          <button type='button' className='btn btn-ghost btn-small' onClick={() => atualizarStatus(b.id, 'pago')}>
                            Marcar como pago
                          </button>
                        )}
                        {status === 'pago' && (
                          <button type='button' className='btn btn-ghost btn-small' onClick={() => atualizarStatus(b.id, 'gerado')}>
                            Reabrir
                          </button>
                        )}
                        {!['cancelado', 'pago'].includes(status) && (
                          <button type='button' className='btn btn-ghost btn-small btn-danger' onClick={() => atualizarStatus(b.id, 'cancelado')}>
                            Cancelar
                          </button>
                        )}
                        <button type='button' className='btn btn-ghost btn-small btn-danger' onClick={() => excluirBoleto(b)}>
                          Excluir
                        </button>
                      </div>
                    )}
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

