import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { BANCO_OPCOES, PERFIS_GESTORES_PAGAMENTO } from './tipos.js'
import { temDadosBancarios } from './boletoUtils.js'
import {
  PERFIS_CREDENCIAIS_MERCADO_PAGO,
  ROTULO_CREDENCIAL,
  carregarCredenciaisMercadoPago,
  construirUrlWebhookMercadoPago,
  modoCredencialMercadoPago,
  removerCredenciaisMercadoPago,
  salvarCredenciaisMercadoPago
} from './mercadoPago.js'
import { nowISO, load, save } from '../../utils/storage.js'

const chavePix = (condominioId) => `${condominioId}_config_pix`

export default function ConfigurarContas() {
  const { userProfile, firebaseOK } = useAuth()
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [tipoMsg, setTipoMsg] = useState('success')
  const [chavePIX, setChavePIX] = useState('')
  const [pixAtivo, setPixAtivo] = useState(true)
  const [nomeRecebedor, setNomeRecebedor] = useState('')
  const [cidadeRecebedor, setCidadeRecebedor] = useState('')
  // Seção "Chave PIX para recebimento" inicia recolhida para não ocupar
  // a tela; o cabeçalho segue visível com o botão Expandir/Recolher.
  const [secaoAberta, setSecaoAberta] = useState(false)
  // Dados bancários usados para montar o boleto do morador (Pagamentos ›
  // Meus Pagamentos › Gerar boleto). Sem eles o boleto não é exibido e o
  // morador continua pagando por PIX.
  const [banco, setBanco] = useState('')
  const [agencia, setAgencia] = useState('')
  const [conta, setConta] = useState('')
  const [carteira, setCarteira] = useState('')
  const [convenio, setConvenio] = useState('')
  const [secaoBoletoAberta, setSecaoBoletoAberta] = useState(false)
  // Boleto REGISTRADO no Mercado Pago: o Access Token (segredo) fica no
  // documento privado config_privada/{condomínio} — só o síndico lê — e a flag
  // pública `mercadoPagoAtivo` vai no mesmo documento da chave PIX, para o
  // morador saber que o condomínio emite boleto registrado.
  const [mercadoPagoAtivo, setMercadoPagoAtivo] = useState(false)
  const [accessTokenMP, setAccessTokenMP] = useState('')
  const [publicKeyMP, setPublicKeyMP] = useState('')
  const [credenciaisMPCarregadas, setCredenciaisMPCarregadas] = useState(false)
  const [mostrarTokenMP, setMostrarTokenMP] = useState(false)
  const [secaoMercadoPagoAberta, setSecaoMercadoPagoAberta] = useState(false)
  const [salvandoMP, setSalvandoMP] = useState(false)

  const condominioId = userProfile?.condominioId || 'local'
  const podeEditar = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)
  // As credenciais do Mercado Pago são mais restritas que os dados bancários:
  // as regras do Firestore (config_privada) permitem apenas ao síndico.
  const podeEditarCredenciais = PERFIS_CREDENCIAIS_MERCADO_PAGO.includes(userProfile?.role)
  const somenteLeitura = !podeEditar

  // Aplica no formulário tudo o que vive no documento de configuração (chave
  // PIX + dados bancários do boleto). O MESMO documento alimenta a aba "Meus
  // Pagamentos", onde o morador gera o boleto — por isso as duas seções ficam
  // juntas aqui.
  const aplicarConfig = (dados) => {
    setChavePIX(dados?.chavePIX || '')
    setPixAtivo(dados?.ativo !== false)
    setNomeRecebedor(dados?.nomeRecebedor || '')
    setCidadeRecebedor(dados?.cidadeRecebedor || '')
    setBanco(dados?.banco || '')
    setAgencia(dados?.agencia || '')
    setConta(dados?.conta || '')
    setCarteira(dados?.carteira || '')
    setConvenio(dados?.convenio || '')
    setMercadoPagoAtivo(dados?.mercadoPagoAtivo === true)
  }

  // Configuração do condomínio: documento de ID fixo ("principal") — cada
  // gravação atualiza a MESMA configuração em vez de criar um documento novo.
  // A cópia local (localStorage) mantém PIX e dados bancários visíveis offline.
  useEffect(() => {
    const local = load(chavePix(condominioId))
    if (local) aplicarConfig(local)
    if (!firebaseOK || !userProfile?.condominioId) return
    const unsub = onSnapshot(doc(db, 'tenants', condominioId, 'config_pix', 'principal'), (snap) => {
      if (!snap.exists()) return
      const dados = { id: snap.id, ...snap.data() }
      aplicarConfig(dados)
      save(chavePix(condominioId), dados)
    }, (erro) => {
      console.error('Erro ao sincronizar a configuração de pagamentos:', erro)
    })
    return () => unsub()
  }, [firebaseOK, condominioId, userProfile?.condominioId])

  // Credenciais do Mercado Pago: o documento é privado e as regras do Firestore
  // liberam a leitura apenas para o síndico. Para os demais perfis a leitura é
  // negada de forma esperada (a seção fica só informativa).
  useEffect(() => {
    let encerrado = false
    if (!firebaseOK || !userProfile?.condominioId || !podeEditarCredenciais) {
      setCredenciaisMPCarregadas(false)
      return undefined
    }
    carregarCredenciaisMercadoPago(userProfile.condominioId).then((dados) => {
      if (encerrado) return
      setAccessTokenMP(dados?.accessToken || '')
      setPublicKeyMP(dados?.publicKey || '')
      setCredenciaisMPCarregadas(Boolean(dados?.accessToken))
    }).catch((erro) => {
      if (encerrado) return
      if (erro?.code === 'permission-denied') {
        setMensagem('Sem permissão para ler o token. Publique o firestore.rules no console do Firebase (Firestore Database → Rules → Publish) e recarregue a página.')
        setTipoMsg('error')
      }
    })
    return () => { encerrado = true }
  }, [firebaseOK, userProfile?.condominioId, podeEditarCredenciais])

  const salvarMercadoPago = async () => {
    if (!podeEditarCredenciais) return
    setSalvandoMP(true)
    try {
      await salvarCredenciaisMercadoPago({
        condominioId,
        accessToken: accessTokenMP,
        publicKey: publicKeyMP,
        atualizadoPor: userProfile?.nome || userProfile?.email || ''
      })
      setMercadoPagoAtivo(true)
      setCredenciaisMPCarregadas(true)
      setMensagem('Credenciais do Mercado Pago salvas! Confirmando no servidor...')
      try {
        const conferidas = await carregarCredenciaisMercadoPago(condominioId, { doServidor: true, lancarErro: true })
        if (conferidas?.accessToken) {
          setAccessTokenMP(conferidas.accessToken)
          setPublicKeyMP(conferidas.publicKey || '')
          setMensagem('Credenciais do Mercado Pago salvas! Agora o boleto de cada cobrança pode ser registrado.')
        } else {
          setMensagem('Salvo, mas o token não voltou na leitura do servidor. Publique o firestore.rules (Rules -> Publish) e recarregue a página.')
          setTipoMsg('error')
        }
      } catch (erroConf) {
        if (erroConf?.code === 'permission-denied') {
          setMensagem('Salvo, mas sem permissão de leitura: publique o firestore.rules (Rules -> Publish) e recarregue a página.')
          setTipoMsg('error')
        } else {
          setMensagem('Salvo! Não foi possível confirmar a leitura agora — recarregue a página para conferir.')
        }
      }
      setTipoMsg('success')
    } catch (erro) {
      console.error('Erro ao salvar as credenciais do Mercado Pago:', erro)
      setMensagem(erro?.message || 'Não foi possível salvar as credenciais. Verifique a conexão e tente novamente.')
      setTipoMsg('error')
    } finally {
      setSalvandoMP(false)
    }
  }

  const removerMercadoPago = async () => {
    if (!podeEditarCredenciais) return
    if (!window.confirm('Remover as credenciais do Mercado Pago? Os boletos já gerados continuam válidos, mas o condomínio deixa de registrar novos.')) return
    setSalvandoMP(true)
    try {
      await removerCredenciaisMercadoPago(condominioId)
      setAccessTokenMP('')
      setPublicKeyMP('')
      setCredenciaisMPCarregadas(false)
      setMercadoPagoAtivo(false)
      setMensagem('Credenciais do Mercado Pago removidas.')
      setTipoMsg('success')
    } catch (erro) {
      console.error('Erro ao remover as credenciais do Mercado Pago:', erro)
      setMensagem('Não foi possível remover as credenciais. Verifique a conexão e tente novamente.')
      setTipoMsg('error')
    } finally {
      setSalvandoMP(false)
    }
  }

  // Gravação única das duas seções (chave PIX e dados bancários) no mesmo
  // documento: o { merge: true } preserva os campos que não vieram no formulário.
  const salvarConfig = async (dados, mensagemSucesso, mensagemLocal) => {
    if (!podeEditar) return
    setSalvando(true)
    const registro = { ...dados, atualizadoEm: nowISO() }
    try {
      await setDoc(doc(db, 'tenants', condominioId, 'config_pix', 'principal'), registro, { merge: true })
      setMensagem(mensagemSucesso); setTipoMsg('success')
    } catch (erro) {
      console.error('Erro ao salvar a configuração de pagamentos:', erro)
      setMensagem(mensagemLocal)
      setTipoMsg('info')
    } finally {
      save(chavePix(condominioId), { ...(load(chavePix(condominioId)) || {}), ...registro })
      setSalvando(false)
    }
  }

  // Dados bancários que alimentam o boleto do morador. Só salva quando banco,
  // agência e conta estão preenchidos — a mesma checagem usada ao gerar o boleto.
  const salvarDadosBancarios = () => {
    if (!temDadosBancarios({ banco, agencia, conta })) {
      setMensagem('Informe banco, agência e conta para o morador conseguir gerar o boleto.')
      setTipoMsg('error')
      return
    }
    salvarConfig(
      {
        banco: banco.trim(),
        agencia: agencia.trim(),
        conta: conta.trim(),
        carteira: carteira.trim(),
        convenio: convenio.trim()
      },
      'Dados bancários salvos! Os moradores já podem gerar o boleto da mensalidade.',
      'Dados bancários salvos apenas neste dispositivo (sem conexão com o banco).'
    )
  }

  const bancoSelecionado = BANCO_OPCOES.find((item) => item.codigo === banco)

  const copiarTexto = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto)
      setMensagem('Chave PIX copiada!'); setTipoMsg('success')
    } catch {
      setMensagem(`Não foi possível copiar automaticamente. Chave PIX: ${texto}`)
      setTipoMsg('info')
    }
  }

  const getPixBadge = (ativa) => ativa
    ? <span className='badge badge-green'>Ativo</span>
    : <span className='badge badge-gray'>Inativo</span>
  return (
    <div>
      {mensagem && <div className={'alert ' + (tipoMsg === 'error' ? 'alert-error' : tipoMsg === 'success' ? 'alert-success' : 'alert-info')}>{mensagem}</div>}

      <div className='card'>
        <div className='card-header'>
          <h3>Chave PIX para recebimento</h3>
          <button
            type='button'
            className='btn btn-ghost btn-small'
            onClick={() => setSecaoAberta((aberto) => !aberto)}
            aria-expanded={secaoAberta}
          >
            {secaoAberta ? '▾ Recolher' : '▸ Expandir'}
          </button>
        </div>
        {secaoAberta && (
        <div className='card-body'>
          {somenteLeitura ? (
            <p className='sub'>Somente síndico, zelador ou portaria podem alterar os dados de recebimento.</p>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault()
              if (!chavePIX.trim()) { setMensagem('Informe a chave PIX!'); setTipoMsg('error'); return }
              salvarConfig(
                {
                  chavePIX: chavePIX.trim(),
                  ativo: pixAtivo,
                  nomeRecebedor: nomeRecebedor.trim(),
                  cidadeRecebedor: cidadeRecebedor.trim()
                },
                'Chave PIX salva!',
                'Chave PIX salva apenas neste dispositivo (sem conexão com o banco).'
              )
            }}>
              <div className='form-grid'>
                <div className='form-group'>
                  <label htmlFor='pix-chave'>Chave PIX *</label>
                  <input type='text' id='pix-chave' value={chavePIX}
                    onChange={(e) => setChavePIX(e.target.value)}
                    placeholder='CPF, CNPJ, e-mail, telefone ou chave aleatória' className='input' />
                </div>
                <div className='form-group'>
                  <label htmlFor='pix-nome'>Nome do recebedor</label>
                  <input type='text' id='pix-nome' value={nomeRecebedor} maxLength={25}
                    onChange={(e) => setNomeRecebedor(e.target.value)}
                    placeholder='Ex.: Condomínio Edifício Aurora' className='input' />
                </div>
                <div className='form-group'>
                  <label htmlFor='pix-cidade'>Cidade do recebedor</label>
                  <input type='text' id='pix-cidade' value={cidadeRecebedor} maxLength={15}
                    onChange={(e) => setCidadeRecebedor(e.target.value)}
                    placeholder='Ex.: Sao Paulo' className='input' />
                </div>
                <div className='form-group'>
                  <label htmlFor='pix-ativo'>Status da chave</label>
                  <select id='pix-ativo' value={pixAtivo ? 'ativo' : 'inativo'}
                    onChange={(e) => setPixAtivo(e.target.value === 'ativo')} className='select'>
                    <option value='ativo'>Ativa</option>
                    <option value='inativo'>Inativa</option>
                  </select>
                </div>
              </div>
              <div className='form-actions'>
                <button type='submit' className='btn btn-brass' disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Salvar Chave PIX'}
                </button>
                {chavePIX && (
                  <button type='button' className='btn btn-ghost' onClick={() => copiarTexto(chavePIX)}>
                    Copiar chave
                  </button>
                )}
              </div>
            </form>
          )}
          {somenteLeitura && (
            <div className='pix-visual'>
              <div className='pix-dado'>
                <span className='pix-label'>Chave PIX:</span>
                <strong>{chavePIX || 'Não configurada'}</strong>
              </div>
              <div className='pix-dado'>
                <span className='pix-label'>Status:</span> {getPixBadge(pixAtivo)}
              </div>
            </div>
          )}
        </div>
        )}
      </div>

      {/* Dados bancários do boleto: preenchidos pelo síndico, lidos pelo morador
          em "Meus Pagamentos" para gerar o boleto da mensalidade. */}
      <div className='card'>
        <div className='card-header'>
          <h3>Dados bancários para boleto</h3>
          <button
            type='button'
            className='btn btn-ghost btn-small'
            onClick={() => setSecaoBoletoAberta((aberto) => !aberto)}
            aria-expanded={secaoBoletoAberta}
          >
            {secaoBoletoAberta ? '▾ Recolher' : '▸ Expandir'}
          </button>
        </div>
        {secaoBoletoAberta && (
        <div className='card-body'>
          {somenteLeitura ? (
            <div className='pix-visual'>
              <div className='pix-dado'>
                <span className='pix-label'>Banco:</span>
                <strong>
                  {bancoSelecionado ? `${bancoSelecionado.codigo} — ${bancoSelecionado.nome}` : 'Não configurado'}
                </strong>
              </div>
              <div className='pix-dado'>
                <span className='pix-label'>Agência / Conta:</span>
                <strong>{agencia && conta ? `${agencia} / ${conta}` : 'Não configuradas'}</strong>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); salvarDadosBancarios() }}>
              <p className='sub'>
                Com banco, agência e conta cadastrados, cada morador gera o boleto da própria mensalidade em
                "Meus Pagamentos" — o cálculo é feito no aparelho dele, sem gravar nada no banco de dados.
                Sem esses dados a tela avisa o morador e o pagamento continua pelo PIX.
              </p>
              <div className='form-grid'>
                <div className='form-group'>
                  <label htmlFor='boleto-banco'>Banco *</label>
                  <select id='boleto-banco' value={banco} onChange={(e) => setBanco(e.target.value)} className='select'>
                    <option value=''>Selecione o banco</option>
                    {BANCO_OPCOES.map((item) => (
                      <option key={item.codigo} value={item.codigo}>{item.codigo} — {item.nome}</option>
                    ))}
                  </select>
                </div>
                <div className='form-group'>
                  <label htmlFor='boleto-agencia'>Agência *</label>
                  <input type='text' id='boleto-agencia' value={agencia} inputMode='numeric'
                    onChange={(e) => setAgencia(e.target.value)} placeholder='Ex.: 1234' className='input' />
                </div>
                <div className='form-group'>
                  <label htmlFor='boleto-conta'>Conta *</label>
                  <input type='text' id='boleto-conta' value={conta} inputMode='numeric'
                    onChange={(e) => setConta(e.target.value)} placeholder='Ex.: 12345678' className='input' />
                </div>
                <div className='form-group'>
                  <label htmlFor='boleto-carteira'>Carteira</label>
                  <input type='text' id='boleto-carteira' value={carteira} inputMode='numeric'
                    onChange={(e) => setCarteira(e.target.value)} placeholder='Ex.: 017' className='input' />
                </div>
                <div className='form-group'>
                  <label htmlFor='boleto-convenio'>Convênio / cedente</label>
                  <input type='text' id='boleto-convenio' value={convenio}
                    onChange={(e) => setConvenio(e.target.value)} placeholder='Opcional' className='input' />
                </div>
              </div>
              <div className='form-actions'>
                <button type='submit' className='btn btn-brass' disabled={salvando}>
                  {salvando ? 'Salvando...' : 'Salvar dados bancários'}
                </button>
              </div>
              <span className='form-hint'>
                {mercadoPagoAtivo
                  ? 'Estes dados são usados apenas no boleto de demonstração (sem registro em banco). Com o Mercado Pago ativo, use "Registrar no Mercado Pago" no boleto para obter o código de barras oficial.'
                  : 'Boleto de demonstração, calculado a partir da própria cobrança — não há registro em banco. O morador confere a linha digitável (47 dígitos) e paga por PIX, enviando o comprovante. Para emitir boleto registrado de verdade, cadastre as credenciais do Mercado Pago na seção abaixo.'}
              </span>
            </form>
          )}
        </div>
        )}
      </div>

      {/* Boleto REGISTRADO no Mercado Pago: com o Access Token cadastrado aqui,
          o código de barras (44 dígitos) e a linha digitável (47) passam a vir
          do próprio Mercado Pago, e não mais do cálculo local. O token é um
          SEGREDO: fica em config_privada/{condomínio} e só o síndico lê. */}
      <div className='card'>
        <div className='card-header'>
          <h3>Boleto registrado (Mercado Pago)</h3>
          <div className='filtros-header'>
            {mercadoPagoAtivo
              ? <span className='badge badge-green'>Ativo</span>
              : <span className='badge badge-gray'>Não configurado</span>}
            <button
              type='button'
              className='btn btn-ghost btn-small'
              onClick={() => setSecaoMercadoPagoAberta((aberto) => !aberto)}
              aria-expanded={secaoMercadoPagoAberta}
            >
              {secaoMercadoPagoAberta ? '▾ Recolher' : '▸ Expandir'}
            </button>
          </div>
        </div>
        {secaoMercadoPagoAberta && (
        <div className='card-body'>
          {!podeEditarCredenciais ? (
            <p className='sub'>
              {mercadoPagoAtivo
                ? 'O condomínio emite boleto registrado pelo Mercado Pago. Somente o síndico altera as credenciais.'
                : 'Somente o síndico cadastra as credenciais do Mercado Pago (Access Token).'}
            </p>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); salvarMercadoPago() }}>
              <p className='sub'>
                Com o <strong>Access Token</strong> cadastrado, o síndico registra o boleto de cada
                cobrança no Mercado Pago e o morador recebe o código de barras oficial (44 dígitos), a linha
                digitável (47) e o link do boleto para imprimir ou pagar.
                {modoCredencialMercadoPago(accessTokenMP) === 'teste' ? (
                  <> <span className='badge badge-blue'>Modo teste</span> Token TEST-… da conta Vendedor de teste: o boleto é gerado só para validar o fluxo — <strong>não tente pagar no banco</strong>, use os dados do comprador de teste.</>
                ) : (
                  <> As credenciais de produção (<strong>APP_USR-…</strong>) movimentam dinheiro de verdade — se o token já apareceu em algum lugar público, gere um novo no painel do Mercado Pago antes de cadastrar aqui.</>
                )}
              </p>
              <p className='sub'>
                Mercado Pago › Developers › Suas integrações › sua aplicação › <strong>Credenciais de teste</strong> (token <strong>TEST-…</strong> da conta Vendedor, ex. User ID 3723216120, país Brasil) para homologar, ou <strong>Credenciais de produção</strong> (APP_USR-…) para cobrar de verdade.
              </p>
              <div className='form-grid'>
                <div className='form-group'>
                  <label htmlFor='mp-token'>{ROTULO_CREDENCIAL} *</label>
                  <input
                    type={mostrarTokenMP ? 'text' : 'password'}
                    id='mp-token'
                    value={accessTokenMP}
                    onChange={(e) => setAccessTokenMP(e.target.value)}
                    placeholder={credenciaisMPCarregadas ? 'Token salvo — preencha para trocar' : 'APP_USR-... (produção) ou TEST-... (teste)'}
                    className='input'
                    autoComplete='off'
                    spellCheck='false'
                  />
                  <span className='form-hint'>
                    {modoCredencialMercadoPago(accessTokenMP) === 'teste'
                      ? 'Token de TESTE detectado (TEST-…). O boleto gerado serve para homologar o fluxo — não é pagável no banco.'
                      : 'Mercado Pago › Developers › Credenciais de produção › Access Token (APP_USR-…). Ele fica guardado no servidor e nunca é enviado ao aparelho do morador.'}
                  </span>
                </div>
                <div className='form-group'>
                  <label htmlFor='mp-public'>Public Key (opcional)</label>
                  <input
                    type='text'
                    id='mp-public'
                    value={publicKeyMP}
                    onChange={(e) => setPublicKeyMP(e.target.value)}
                    placeholder='APP_USR-...'
                    className='input'
                    autoComplete='off'
                    spellCheck='false'
                  />
                  <span className='form-hint'>Não é usada para gerar o boleto hoje; guardada para integrações futuras.</span>
                </div>
              </div>
              <div className='form-actions'>
                <button type='submit' className='btn btn-brass' disabled={salvandoMP}>
                  {salvandoMP ? 'Salvando...' : 'Salvar credenciais'}
                </button>
                <button type='button' className='btn btn-ghost' onClick={() => setMostrarTokenMP((v) => !v)}>
                  {mostrarTokenMP ? 'Ocultar token' : 'Mostrar token'}
                </button>
                {credenciaisMPCarregadas && (
                  <button type='button' className='btn btn-ghost btn-danger' onClick={removerMercadoPago} disabled={salvandoMP}>
                    Remover credenciais
                  </button>
                )}
              </div>
              {credenciaisMPCarregadas && (
                <span className='form-hint'>
                  Credenciais salvas. Abra um boleto (Emitir Boletos ou Meus Pagamentos) e use
                  {' '}<strong>Registrar no Mercado Pago</strong> para gerar o código de barras oficial.
                </span>
              )}
              {credenciaisMPCarregadas && (
                <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
                  <label style={{ fontWeight: 600, display: 'block', marginBottom: '0.25rem' }}>
                    Webhook para baixa automática (Mercado Pago)
                  </label>
                  <p className='sub' style={{ marginBottom: '0.5rem' }}>
                    Os novos boletos emitidos já registram esta URL automaticamente para você. Se quiser que pagamentos antigos ou pagamentos via Pix da sua conta Mercado Pago também recebam baixa imediata sem você clicar em nada, cadastre esta URL no painel do Mercado Pago:
                  </p>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type='text'
                      readOnly
                      value={construirUrlWebhookMercadoPago('portaria-condominio-8fbc9', userProfile?.condominioId)}
                      className='input'
                      style={{ flex: 1, minWidth: '280px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                      onClick={(e) => e.target.select()}
                    />
                    <button
                      type='button'
                      className='btn btn-ghost btn-small'
                      onClick={() => {
                        const url = construirUrlWebhookMercadoPago('portaria-condominio-8fbc9', userProfile?.condominioId)
                        navigator.clipboard?.writeText(url)
                        setMensagem('URL do Webhook copiada!')
                        setTipoMsg('success')
                      }}
                    >
                      Copiar URL
                    </button>
                  </div>
                  <span className='form-hint' style={{ marginTop: '0.35rem', display: 'block' }}>
                    Mercado Pago › Developers › Suas integrações › Notificações Webhooks › URL de produção (Marcar eventos: "Pagamentos").
                  </span>
                </div>
              )}

            </form>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

