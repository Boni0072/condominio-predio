import React, { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { PERFIS_GESTORES_PAGAMENTO } from './tipos.js'
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

  const condominioId = userProfile?.condominioId || 'local'
  const podeEditar = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)
  const somenteLeitura = !podeEditar

  // ConfiguraÃ§Ã£o do PIX: documento de ID fixo ("principal") â€” cada gravaÃ§Ã£o
  // atualiza a MESMA configuraÃ§Ã£o em vez de criar um documento novo.
  useEffect(() => {
    const local = load(chavePix(condominioId))
    if (local) {
      setChavePIX(local.chavePIX || '')
      setPixAtivo(local.ativo !== false)
      setNomeRecebedor(local.nomeRecebedor || '')
      setCidadeRecebedor(local.cidadeRecebedor || '')
    }
    if (!firebaseOK || !userProfile?.condominioId) return
    const unsub = onSnapshot(doc(db, 'tenants', condominioId, 'config_pix', 'principal'), (snap) => {
      if (!snap.exists()) return
      const dados = { id: snap.id, ...snap.data() }
      setChavePIX(dados.chavePIX || '')
      setPixAtivo(dados.ativo !== false)
      setNomeRecebedor(dados.nomeRecebedor || '')
      setCidadeRecebedor(dados.cidadeRecebedor || '')
      save(chavePix(condominioId), dados)
    }, (erro) => {
      console.error('Erro ao sincronizar chave PIX:', erro)
    })
    return () => unsub()
  }, [firebaseOK, condominioId, userProfile?.condominioId])

  const salvarPIX = async (dados) => {
    if (!podeEditar) return
    setSalvando(true)
    const registro = { ...dados, atualizadoEm: nowISO() }
    try {
      await setDoc(doc(db, 'tenants', condominioId, 'config_pix', 'principal'), registro, { merge: true })
      setMensagem('Chave PIX salva!'); setTipoMsg('success')
    } catch (erro) {
      console.error('Erro ao salvar chave PIX:', erro)
      setMensagem('Chave PIX salva apenas neste dispositivo (sem conexÃ£o com o banco).')
      setTipoMsg('info')
    } finally {
      save(chavePix(condominioId), { ...(load(chavePix(condominioId)) || {}), ...registro })
      setSalvando(false)
    }
  }

  const copiarTexto = async (texto) => {
    try {
      await navigator.clipboard.writeText(texto)
      setMensagem('Chave PIX copiada!'); setTipoMsg('success')
    } catch {
      setMensagem(`NÃ£o foi possÃ­vel copiar automaticamente. Chave PIX: ${texto}`)
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
        <div className='card-header'><h3>Chave PIX para recebimento</h3></div>
        <div className='card-body'>
          {somenteLeitura ? (
            <p className='sub'>Somente sÃ­ndico, zelador ou portaria podem alterar os dados de recebimento.</p>
          ) : (
            <form onSubmit={(e) => {
              e.preventDefault()
              if (!chavePIX.trim()) { setMensagem('Informe a chave PIX!'); setTipoMsg('error'); return }
              salvarPIX({
                chavePIX: chavePIX.trim(),
                ativo: pixAtivo,
                nomeRecebedor: nomeRecebedor.trim(),
                cidadeRecebedor: cidadeRecebedor.trim()
              })
            }}>
              <div className='form-grid'>
                <div className='form-group'>
                  <label htmlFor='pix-chave'>Chave PIX *</label>
                  <input type='text' id='pix-chave' value={chavePIX}
                    onChange={(e) => setChavePIX(e.target.value)}
                    placeholder='CPF, CNPJ, e-mail, telefone ou chave aleatÃ³ria' className='input' />
                </div>
                <div className='form-group'>
                  <label htmlFor='pix-nome'>Nome do recebedor</label>
                  <input type='text' id='pix-nome' value={nomeRecebedor} maxLength={25}
                    onChange={(e) => setNomeRecebedor(e.target.value)}
                    placeholder='Ex.: CondomÃ­nio EdifÃ­cio Aurora' className='input' />
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
                <strong>{chavePIX || 'NÃ£o configurada'}</strong>
              </div>
              <div className='pix-dado'>
                <span className='pix-label'>Status:</span> {getPixBadge(pixAtivo)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

