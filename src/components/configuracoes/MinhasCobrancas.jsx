import React from 'react'
import { useAuth } from '../../context/AuthContext.jsx'
import {
  cobrancaPertenceAoUsuario,
  statusEfetivoCobranca,
  ROTULO_STATUS_COBRANCA,
  CLASSE_BADGE_COBRANCA
} from './cobrancaUtils.js'
import { formatarValorBoleto } from '../pagamentos/boletoUtils.js'
import { useCobrancas } from '../pagamentos/useCobrancas.js'

// Visualização das COBRANÇAS do próprio usuário (morador e conselheiro).
// É o mesmo listener de Pagamentos, por isso uma baixa feita pelo gestor
// aparece imediatamente aqui e na consulta de pagamentos.
export default function MinhasCobrancas() {
  const { userProfile } = useAuth()
  const visivel = ['morador', 'conselheiro'].includes(userProfile?.role) && Boolean(userProfile?.condominioId)
  const { cobrancas, carregando, erroSincronizacao } = useCobrancas({ ativo: visivel })

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
        {erroSincronizacao && <div className="alert alert-error" style={{ marginBottom: 12 }}>{erroSincronizacao}</div>}
        {carregando ? (
          <div className="loading">Carregando cobranças...</div>
        ) : minhas.length === 0 ? (
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
                        {c.status === 'pago' && c.pagoEm && (
                          <span>Pago em: <strong>{new Date(c.pagoEm).toLocaleDateString('pt-BR')}</strong></span>
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
