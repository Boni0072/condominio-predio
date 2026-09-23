import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import { db } from '../../firebase/config.js'
import { collection, onSnapshot } from 'firebase/firestore'
import {
  chaveCobrancas,
  cobrancaPertenceAoUsuario,
  statusEfetivoCobranca,
  ROTULO_STATUS_COBRANCA,
  CLASSE_BADGE_COBRANCA
} from './cobrancaUtils.js'
import { formatarValorBoleto } from '../pagamentos/boletoUtils.js'
import { load, save } from '../../utils/storage.js'

// Visualização das COBRANÇAS do próprio usuário (morador e conselheiro).
// Somente leitura: a baixa (marcar como paga) é feita pela administração
// na seção "Cobrança mensal dos moradores".
export default function MinhasCobrancas() {
  const { userProfile, firebaseOK } = useAuth()
  const [cobrancas, setCobrancas] = useState([])

  const condominioId = userProfile?.condominioId
  const firestoreAtivo = Boolean(firebaseOK && condominioId)
  const visivel = ['morador', 'conselheiro'].includes(userProfile?.role) && Boolean(condominioId)

  useEffect(() => {
    if (!visivel) return
    if (!firestoreAtivo) {
      setCobrancas(load(chaveCobrancas(condominioId)) || [])
      return
    }
    const unsub = onSnapshot(collection(db, 'tenants', condominioId, 'cobrancas'), (snap) => {
      const lista = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      setCobrancas(lista)
      save(chaveCobrancas(condominioId), lista)
    }, (erro) => {
      console.error('Erro ao sincronizar cobranças:', erro)
      setCobrancas(load(chaveCobrancas(condominioId)) || [])
    })
    return () => unsub()
  }, [visivel, firestoreAtivo, condominioId])

  if (!visivel) return null

  const minhas = cobrancas
    .filter((c) => !c.removido && cobrancaPertenceAoUsuario(c, userProfile))
    .sort((a, b) => new Date(b.dataVencimento || 0) - new Date(a.dataVencimento || 0))
  const totalEmAberto = minhas
    .filter((c) => ['pendente', 'vencida'].includes(statusEfetivoCobranca(c)))
    .reduce((soma, c) => soma + (Number(c.valor) || 0), 0)

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h3>Minhas cobranças</h3>
      </div>
      <div className="card-body">
        {minhas.length === 0 ? (
          <div className="empty">
            <p>Nenhuma cobrança registrada.</p>
            <span>As cotas condominiais geradas pela administração aparecem aqui.</span>
          </div>
        ) : (
          <>
            <p className="hint" style={{ marginBottom: 12, color: 'var(--ink-soft)', fontSize: 15.6 }}>
              Total em aberto: <strong>{formatarValorBoleto(totalEmAberto)}</strong> · {minhas.length} cobrança(s)
            </p>
            <div className="boletos-lista">
              {minhas.map((c) => {
                const status = statusEfetivoCobranca(c)
                return (
                  <div key={c.id} className="boleto-item">
                    <div className="boleto-info">
                      <div className="boleto-header">
                        <strong>{c.descricao || 'Cota condominial'}</strong>
                        <span className={`badge ${CLASSE_BADGE_COBRANCA[status] || 'badge-gray'}`}>
                          {ROTULO_STATUS_COBRANCA[status] || status}
                        </span>
                      </div>
                      <div className="boleto-dados">
                        <span>Valor: <strong>{formatarValorBoleto(c.valor)}</strong></span>
                        <span>Vencimento: <strong>{c.dataVencimento || '-'}</strong></span>
                        {c.status === 'paga' && c.pagaEm && (
                          <span>Pago em: <strong>{new Date(c.pagaEm).toLocaleDateString('pt-BR')}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
