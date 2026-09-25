import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { BANCO_OPCOES, PERFIS_GESTORES_PAGAMENTO } from './tipos.js'
import { temDadosBancarios } from './boletoUtils.js'
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

  const condominioId = userProfile?.condominioId || 'local'
  const podeEditar = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)
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
                Boleto de demonstração, calculado a partir da própria cobrança — não há registro em banco. O
                morador confere a linha digitável (47 dígitos) e paga por PIX, enviando o comprovante.
              </span>
            </form>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

