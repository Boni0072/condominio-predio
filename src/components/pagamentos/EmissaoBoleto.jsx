import React, { useState, useMemo, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { useApp } from '../../context/AppContext.jsx'
import { db } from '../../firebase/config.js'
import { collection, addDoc, updateDoc, doc, onSnapshot } from 'firebase/firestore'
import { TIPOS_PAGAMENTO, STATUS_BOLETO, PERFIS_GESTORES_PAGAMENTO } from './tipos.js'
import {
  formatarValorBoleto,
  formatarDataVencimento,
  formatarLinhaDigitavel,
  gerarNossoNumero,
  statusEfetivo
} from './boletoUtils.js'
import { uid, nowISO, load, save } from '../../utils/storage.js'
import { construirDestinatariosCobranca, COLECAO_BOLETOS, colecaoDoRegistro } from './cobrancas.js'
import { useCobrancas } from './useCobrancas.js'
import BoletoGerado from './BoletoGerado.jsx'
import {
  boletoRegistrado,
  buscarEnderecoPorCep,
  gerarBoletoRegistrado,
  mercadoPagoAtivo,
  mensagemErroMercadoPago
} from './mercadoPago.js'

const chavePix = (condominioId) => `${condominioId}_config_pix`

function formVazio() {
  return {
    id: '',
    destinoKey: '',
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
    nossoNumero: '',
    // Pagador do boleto REGISTRADO no Mercado Pago: sem nome completo, CPF/CNPJ
    // válido e e-mail o banco não registra a cobrança.
    pagadorNome: '',
    pagadorDocumento: '',
    pagadorEmail: '',
    pagadorCep: '',
    // Endereço do pagador: obrigatório para o Mercado Pago registrar o boleto
    // (exigência do BACEN desde 30/09/2024 — rua, número, bairro, CEP, cidade
    // e UF). Sem ele a API recusa a emissão e não existe código real.
    pagadorLogradouro: '',
    pagadorNumero: '',
    pagadorBairro: '',
    pagadorCidade: '',
    pagadorUf: '',
    registrarMercadoPago: false
  }
}

export default function EmissaoBoleto() {
  const { userProfile, firebaseOK, condominio } = useAuth()
  const { moradores, usuarios } = useApp()
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [tipoMsg, setTipoMsg] = useState('success')
  const [busca, setBusca] = useState('')
  const [filtroTipo, setFiltroTipo] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [form, setForm] = useState(formVazio)
  const [registrandoMP, setRegistrandoMP] = useState(false)
  const [buscandoCep, setBuscandoCep] = useState(false)

  const condominioId = userProfile?.condominioId || 'local'
  const podeEditar = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)
  const { cobrancas, atualizarLocal, carregando: loading, firestoreAtivo } = useCobrancas()
  const boletos = useMemo(
    () => [...cobrancas].sort((a, b) => new Date(b.dataVencimento || 0) - new Date(a.dataVencimento || 0)),
    [cobrancas]
  )

  // Configuração de pagamentos do condomínio (chave PIX, dados bancários e a
  // flag pública do Mercado Pago). É o MESMO documento que o morador lê — aqui
  // o gestor usa para saber se pode registrar o boleto no Mercado Pago e para
  // abrir o modal do boleto com os dados bancários.
  const [pix, setPix] = useState(() => load(chavePix(condominioId)))
  const [boletoGerado, setBoletoGerado] = useState(null)

  useEffect(() => {
    const local = load(chavePix(condominioId))
    if (local) setPix(local)
    if (!firebaseOK || !userProfile?.condominioId) return undefined
    const unsub = onSnapshot(doc(db, 'tenants', condominioId, 'config_pix', 'principal'), (snap) => {
      if (!snap.exists()) return
      const dados = { id: snap.id, ...snap.data() }
      setPix(dados)
      save(chavePix(condominioId), dados)
    }, (erro) => {
      console.warn('Não foi possível sincronizar a configuração de pagamentos:', erro)
    })
    return () => unsub()
  }, [firebaseOK, condominioId, userProfile?.condominioId])

  // Boleto registrado no Mercado Pago disponível para o condomínio?
  const mpAtivo = mercadoPagoAtivo(pix)
  const dadosBancarios = useMemo(() => ({
    banco: pix?.banco || '',
    agencia: pix?.agencia || '',
    conta: pix?.conta || '',
    carteira: pix?.carteira || '',
    convenio: pix?.convenio || ''
  }), [pix])

  // Registra a cobrança no Mercado Pago (Cloud Function) e devolve o aviso que
  // a tela mostra junto da mensagem de sucesso. O código de barras de 44
  // dígitos e a linha digitável de 47 vêm do banco e ficam gravados na cobrança.
  const registrarNoMercadoPago = async (cobranca) => {
    setRegistrandoMP(true)
    try {
      const dados = await gerarBoletoRegistrado({
        boletoId: cobranca.id,
        colecao: COLECAO_BOLETOS,
        valor: cobranca.valor,
        descricao: cobranca.descricao || 'Cobrança do condomínio',
        dataVencimento: cobranca.dataVencimento,
        pagador: {
          nome: cobranca.pagadorNome,
          documento: cobranca.pagadorDocumento,
          email: cobranca.pagadorEmail,
          cep: cobranca.pagadorCep,
          logradouro: cobranca.pagadorLogradouro,
          numero: cobranca.pagadorNumero,
          bairro: cobranca.pagadorBairro,
          cidade: cobranca.pagadorCidade,
          uf: cobranca.pagadorUf
        },
        tenantId: condominioId
      })
      const ajuste = dados.vencimento?.ajustada
        ? ` Vencimento ajustado para ${formatarDataVencimento(dados.vencimento.data)} (o Mercado Pago aceita até 30 dias).`
        : ''
      return ` Boleto registrado no Mercado Pago!${ajuste}`
    } catch (erro) {
      console.error('Boleto salvo, mas não registrado no Mercado Pago:', erro)
      return ` O boleto foi salvo, mas o registro no Mercado Pago falhou: ${mensagemErroMercadoPago(erro)}`
    } finally {
      setRegistrandoMP(false)
    }
  }

  // O modal recebe a cobrança atualizada (números oficiais) sem depender do
  // próximo snapshot do Firestore.
  const atualizarBoletoNaTela = (atualizado) => {
    setBoletoGerado((atual) => (atual && atual.id === atualizado?.id ? { ...atual, ...atualizado } : atual))
  }

  // O mesmo helper da cobrança mensal vinculha cadastro e conta por e-mail ou
  // unidade, evitando duas cobranças para a mesma unidade.
  const opcoesMoradores = useMemo(
    () => construirDestinatariosCobranca(moradores, usuarios).map((o) => ({
      ...o,
      value: o.moradorId ? `morador:${o.moradorId}` : `usuario:${o.moradorUserId}`
    })),
    [moradores, usuarios]
  )

  const rotuloMorador = (o) =>
    `${o.nome}${o.unidade ? ' — ' + o.unidade : ''}${o.email ? ' (' + o.email + ')' : ''}`

  const selecionarMorador = (value) => {
    const opcao = opcoesMoradores.find((o) => o.value === value)
    setForm((prev) => ({
      ...prev,
      destinoKey: value,
      moradorId: opcao?.moradorId || '',
      moradorUserId: opcao?.moradorUserId || '',
      moradorNome: opcao?.nome || '',
      moradorUnidade: opcao?.unidade || '',
      moradorEmail: opcao?.email || '',
      // Já adianta o nome e o e-mail do pagador do boleto registrado: falta só
      // o CPF/CNPJ, que o app não guarda no cadastro do morador.
      pagadorNome: prev.pagadorNome || opcao?.nome || '',
      pagadorEmail: prev.pagadorEmail || opcao?.email || ''
    }))
  }

  // CEP → ViaCEP: completa rua/bairro/cidade/UF do pagador. É só um atalho —
  // quando a consulta falha, o gestor digita o endereço à mão (o Mercado Pago
  // exige os campos, mas não valida contra o ViaCEP).
  const completarEnderecoPeloCep = async () => {
    setBuscandoCep(true)
    try {
      const endereco = await buscarEnderecoPorCep(form.pagadorCep)
      setForm((prev) => ({
        ...prev,
        pagadorCep: endereco.cep,
        pagadorLogradouro: endereco.logradouro || prev.pagadorLogradouro,
        pagadorBairro: endereco.bairro || prev.pagadorBairro,
        pagadorCidade: endereco.cidade || prev.pagadorCidade,
        pagadorUf: endereco.uf || prev.pagadorUf
      }))
      setMensagem('Endereço do pagador preenchido pelo CEP — confira o número.')
      setTipoMsg('info')
    } catch (erro) {
      setMensagem(erro?.message || 'Não foi possível consultar o CEP agora.')
      setTipoMsg('error')
    } finally {
      setBuscandoCep(false)
    }
  }

  const limparForm = () => {
    setForm(formVazio())
    setMostrarForm(false)
  }

  const editarBoleto = (boleto) => {
    setForm({
      id: boleto.id,
      destinoKey: boleto.moradorId
        ? `morador:${boleto.moradorId}`
        : boleto.moradorUserId ? `usuario:${boleto.moradorUserId}` : '',
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
      nossoNumero: boleto.nossoNumero || '',
      pagadorNome: boleto.pagadorNome || boleto.moradorNome || '',
      pagadorDocumento: boleto.pagadorDocumento || '',
      pagadorEmail: boleto.pagadorEmail || boleto.moradorEmail || '',
      pagadorCep: boleto.pagadorCep || '',
      pagadorLogradouro: boleto.pagadorLogradouro || '',
      pagadorNumero: boleto.pagadorNumero || '',
      pagadorBairro: boleto.pagadorBairro || '',
      pagadorCidade: boleto.pagadorCidade || '',
      pagadorUf: boleto.pagadorUf || '',
      // Reabrir a edição de um boleto já registrado não o registra de novo.
      registrarMercadoPago: false
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
      emitidoPor: userProfile?.nome || userProfile?.email || 'sistema',
      // Pagador usado no boleto registrado do Mercado Pago (fica gravado para
      // não precisar digitar de novo quando a cobrança for registrada depois).
      pagadorNome: form.pagadorNome.trim() || form.moradorNome,
      pagadorDocumento: form.pagadorDocumento.replace(/\D/g, ''),
      pagadorEmail: (form.pagadorEmail || form.moradorEmail).trim(),
      pagadorCep: form.pagadorCep.replace(/\D/g, ''),
      pagadorLogradouro: form.pagadorLogradouro.trim(),
      pagadorNumero: form.pagadorNumero.trim(),
      pagadorBairro: form.pagadorBairro.trim(),
      pagadorCidade: form.pagadorCidade.trim(),
      pagadorUf: form.pagadorUf.trim().toUpperCase()
    }
    setSalvando(true)
    const boletoAtual = cobrancas.find((b) => b.id === form.id)
    if (firestoreAtivo) {
      try {
        let idSalvo = form.id
        if (form.id) {
          await updateDoc(doc(db, 'tenants', condominioId, colecaoDoRegistro(boletoAtual || { id: form.id }), form.id), { ...dados, atualizadoEm: nowISO() })
        } else {
          const referencia = await addDoc(collection(db, 'tenants', condominioId, COLECAO_BOLETOS), {
            ...dados, criadoEm: nowISO(), atualizadoEm: nowISO(), condominioId, removido: false
          })
          idSalvo = referencia.id
        }
        // Com o Mercado Pago ativo, a cobrança pode ser registrada no banco na
        // mesma ação (o código de barras oficial é gerado pela Cloud Function).
        const jaRegistrado = boletoRegistrado(boletoAtual)
        const avisoMP = form.registrarMercadoPago && mpAtivo && idSalvo && !jaRegistrado
          ? await registrarNoMercadoPago({ id: idSalvo, ...dados })
          : ''
        setMensagem(`${form.id ? 'Boleto atualizado!' : 'Boleto emitido!'}${avisoMP}`)
        setTipoMsg(avisoMP.includes('falhou') ? 'info' : 'success')
      } catch (erro) {
        console.error('Erro ao salvar boleto:', erro)
        setMensagem('Não foi possível salvar a cobrança. Verifique a conexão e tente novamente.')
        setTipoMsg('error')
      } finally {
        setSalvando(false)
        limparForm()
      }
      return
    }

    atualizarLocal((atuais) => form.id
      ? atuais.map((b) => (b.id === form.id ? { ...b, ...dados, atualizadoEm: nowISO() } : b))
      : [...atuais, { ...dados, id: uid(), criadoEm: nowISO(), atualizadoEm: nowISO(), removido: false }])
    setMensagem(
      `${form.id ? 'Boleto atualizado neste dispositivo.' : 'Boleto emitido neste dispositivo.'}`
      + (form.registrarMercadoPago && mpAtivo
        ? ' O registro no Mercado Pago precisa de conexão com o banco de dados — conecte-se e use "Registrar no Mercado Pago" no boleto.'
        : '')
    )
    setTipoMsg('info')
    setSalvando(false)
    limparForm()
  }

  const atualizarStatus = async (id, novoStatus) => {
    if (!podeEditar) return
    const boleto = cobrancas.find((b) => b.id === id)
    const alteracao = { status: novoStatus, atualizadoEm: nowISO() }
    alteracao.pagoEm = novoStatus === 'pago' ? nowISO() : ''
    if (firestoreAtivo) {
      try {
        await updateDoc(doc(db, 'tenants', condominioId, colecaoDoRegistro(boleto || { id }), id), alteracao)
        setMensagem('Status do boleto atualizado!')
        setTipoMsg('success')
      } catch (erro) {
        console.error('Erro ao atualizar boleto:', erro)
        setMensagem('Não foi possível atualizar o status. Verifique a conexão e tente novamente.')
        setTipoMsg('error')
      }
      return
    }
    atualizarLocal((atuais) => atuais.map((b) => (b.id === id ? { ...b, ...alteracao } : b)))
    setMensagem('Status atualizado neste dispositivo.')
    setTipoMsg('info')
  }

  // Exclusão lógica do boleto: marca "removido" em vez de apagar, para
  // preservar o histórico. Sai de todas as listagens (EmissaoBoleto,
  // ConsultarPagamentos e a consulta do morador filtram esse campo).
  const excluirBoleto = async (boleto) => {
    if (!podeEditar) return
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
      atualizarLocal((atuais) => atuais.map((b) => (b.id === boleto.id ? { ...b, ...alteracao } : b)))
      setMensagem('Boleto excluído neste dispositivo.')
      setTipoMsg('info')
    }
    if (form.id === boleto.id) limparForm()
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
                <select id='morador' value={form.destinoKey} onChange={(e) => selecionarMorador(e.target.value)} className='select'>
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
            {/* Boleto REGISTRADO no Mercado Pago: só aparece quando o síndico já
                cadastrou o Access Token em Configurar Contas. O código de barras
                oficial é gerado ao salvar (Cloud Function), nunca no navegador. */}
            {mpAtivo && (
              <div className='boleto-mercado-pago'>
                <div className='boleto-mp-cabecalho'>
                  <strong>Boleto registrado (Mercado Pago)</strong>
                  <span className='badge badge-green'>Disponível</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type='checkbox'
                    checked={form.registrarMercadoPago}
                    onChange={(e) => setForm((prev) => ({ ...prev, registrarMercadoPago: e.target.checked }))}
                  />
                  <span>Registrar esta cobrança no Mercado Pago e gerar o código de barras do banco</span>
                </label>
                <span className='form-hint'>
                  O Mercado Pago exige nome completo, CPF/CNPJ, e-mail e o endereço completo do
                  pagador (rua, número, bairro, CEP, cidade e UF). O código de barras (44
                  dígitos) e a linha digitável (47) passam a ser os oficiais, com vencimento de até 30 dias.
                  Sem esta opção o boleto continua sendo o de demonstração (cálculo local).
                </span>
                {form.registrarMercadoPago && (
                  <div className='form-grid'>
                    <div className='form-group'>
                      <label htmlFor='pagador-nome'>Nome completo do pagador *</label>
                      <input
                        type='text'
                        id='pagador-nome'
                        value={form.pagadorNome}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorNome: e.target.value }))}
                        placeholder='Ex.: Maria Aparecida Souza'
                        className='input'
                      />
                    </div>
                    <div className='form-group'>
                      <label htmlFor='pagador-doc'>CPF ou CNPJ *</label>
                      <input
                        type='text'
                        id='pagador-doc'
                        value={form.pagadorDocumento}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorDocumento: e.target.value }))}
                        inputMode='numeric'
                        placeholder='000.000.000-00'
                        className='input'
                      />
                    </div>
                    <div className='form-group'>
                      <label htmlFor='pagador-email'>E-mail do pagador *</label>
                      <input
                        type='email'
                        id='pagador-email'
                        value={form.pagadorEmail}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorEmail: e.target.value }))}
                        placeholder='morador@email.com'
                        className='input'
                      />
                    </div>
                    <div className='form-group'>
                      <label htmlFor='pagador-cep'>CEP *</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          type='text'
                          id='pagador-cep'
                          value={form.pagadorCep}
                          onChange={(e) => setForm((prev) => ({ ...prev, pagadorCep: e.target.value }))}
                          onBlur={() => {
                            const digitos = String(form.pagadorCep || '').replace(/\D/g, '')
                            if (digitos.length === 8) completarEnderecoPeloCep()
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
                      <label htmlFor='pagador-rua'>Rua (logradouro) *</label>
                      <input
                        type='text'
                        id='pagador-rua'
                        value={form.pagadorLogradouro}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorLogradouro: e.target.value }))}
                        placeholder='Ex.: Rua das Acácias'
                        className='input'
                      />
                    </div>
                    <div className='form-group'>
                      <label htmlFor='pagador-numero'>Número</label>
                      <input
                        type='text'
                        id='pagador-numero'
                        value={form.pagadorNumero}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorNumero: e.target.value }))}
                        placeholder='Ex.: 120 (em branco vira S/N)'
                        className='input'
                      />
                    </div>
                    <div className='form-group'>
                      <label htmlFor='pagador-bairro'>Bairro *</label>
                      <input
                        type='text'
                        id='pagador-bairro'
                        value={form.pagadorBairro}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorBairro: e.target.value }))}
                        placeholder='Ex.: Centro'
                        className='input'
                      />
                    </div>
                    <div className='form-group'>
                      <label htmlFor='pagador-cidade'>Cidade *</label>
                      <input
                        type='text'
                        id='pagador-cidade'
                        value={form.pagadorCidade}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorCidade: e.target.value }))}
                        placeholder='Ex.: São Paulo'
                        className='input'
                      />
                    </div>
                    <div className='form-group'>
                      <label htmlFor='pagador-uf'>UF *</label>
                      <input
                        type='text'
                        id='pagador-uf'
                        value={form.pagadorUf}
                        onChange={(e) => setForm((prev) => ({ ...prev, pagadorUf: e.target.value.toUpperCase() }))}
                        maxLength={2}
                        placeholder='SP'
                        className='input'
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className='form-actions'>
              <button type='submit' className='btn btn-brass' disabled={salvando || registrandoMP}>
                {salvando || registrandoMP
                  ? (registrandoMP ? 'Registrando no Mercado Pago...' : 'Salvando...')
                  : form.id ? 'Atualizar Boleto' : 'Emitir Boleto'}
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
                        {boletoRegistrado(b) && <span className='badge badge-blue'>Mercado Pago</span>}
                      </div>
                      <div className='boleto-dados'>
                        <span>Descrição: <strong>{b.descricao || '-'}</strong></span>
                        <span>Valor: <strong>{formatarValorBoleto(b.valor)}</strong></span>
                        <span>Vencimento: <strong>{formatarDataVencimento(b.dataVencimento)}</strong></span>
                        {b.nossoNumero && <span>Nosso nº: <strong>{b.nossoNumero}</strong></span>}
                        {boletoRegistrado(b) && (
                          <span>
                            Linha digitável: <strong>{formatarLinhaDigitavel(b.linhaDigitavel)}</strong>
                          </span>
                        )}
                      </div>
                      {b.observacoes && <p className='boleto-obs'>{b.observacoes}</p>}
                    </div>
                    {podeEditar && (
                      <div className='boleto-actions'>
                        <button type='button' className='btn btn-ghost btn-small' onClick={() => setBoletoGerado(b)}>
                          {boletoRegistrado(b) ? 'Ver boleto' : 'Boleto'}
                        </button>
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

      {/* Boleto da cobrança (demonstração ou REGISTRADO no Mercado Pago). Pelo
          modal o gestor registra a cobrança no Mercado Pago — com CPF/CNPJ e
          e-mail do pagador — e confere o pagamento. */}
      {boletoGerado && (
        <BoletoGerado
          boleto={boletoGerado}
          dadosBancarios={dadosBancarios}
          beneficiario={pix?.nomeRecebedor || 'Condomínio'}
          onFechar={() => setBoletoGerado(null)}
          podeRegistrar={podeEditar}
          mercadoPagoAtivo={mpAtivo}
          onBoletoAtualizado={atualizarBoletoNaTela}
          tenantId={condominioId}
          // Endereço do condomínio entra como sugestão do endereço do pagador.
          condominio={condominio}
        />
      )}
    </div>
  )
}

