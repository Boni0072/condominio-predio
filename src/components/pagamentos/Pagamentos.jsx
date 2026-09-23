import React from 'react'
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { PERFIS_GESTORES_PAGAMENTO, PERFIS_VISAO_GERAL } from './tipos.js'
import ConsultarPagamentos from './ConsultarPagamentos.jsx'

// Redirecionamento com guarda anti-loop: navega somente quando o destino é
// DIFERENTE da URL atual. Sem essa guarda, um <Navigate> que resolve para a
// própria URL dispara replace → render → Navigate de novo → "Maximum update
// depth exceeded" (o navegador chega a "Throttling navigation").
function RedirecionarPara({ to }) {
  const { pathname } = useLocation()
  if (pathname === to) return null
  return <Navigate to={to} replace />
}

export default function Pagamentos() {
  const { userProfile } = useAuth()
  // Gestor pode ver o PIX configurado; conselheiro apenas
  // consulta os pagamentos do condomínio; morador consulta os próprios.
  const podeGerenciar = PERFIS_GESTORES_PAGAMENTO.includes(userProfile?.role)
  const veVisaoGeral = PERFIS_VISAO_GERAL.includes(userProfile?.role)
  const classeLink = ({ isActive }) => 'pagamentos-link' + (isActive ? ' ativo' : '')
  // Destino inicial SEMPRE ABSOLUTO. Com a flag v7_relativeSplatPath ativa
  // (HashRouter em main.jsx), um destino RELATIVO ("contas") dentro da rota
  // splat "/pagamentos/*" é resolvido contra a URL COMPLETA do momento:
  // /pagamentos/contas → /pagamentos/contas/consultar →
  // /pagamentos/contas/consultar/consultar ... cada passo casa de novo com o
  // splat e empilha mais um segmento, travando a página em loop infinito.
  const rotaInicial = '/pagamentos/consultar'

  return (
    <div className='page'>
      <div className='page-header'>
        <div>
          <h2>Pagamentos</h2>
          <p className='sub'>Chave PIX e consulta de pagamentos do condomínio.</p>
        </div>
      </div>

      {/* Abas com destino ABSOLUTO: pelas mesmas razões de rotaInicial, um
          "to" relativo aqui viraria /pagamentos/<segmento-atual>/contas e cairia
          de novo no splat. */}
      <div className='pagamentos-links'>
        <NavLink to='/pagamentos/consultar' className={classeLink}>
          <span className='link-icon'>🔍</span>
          <span className='link-text'>{podeGerenciar ? 'Consultar Pagamentos' : 'Meus Pagamentos'}</span>
        </NavLink>
      </div>

      {/* Os CAMINHOS das rotas continuam RELATIVOS ("contas", nunca "/contas")
          porque o aninhamento sob "/pagamentos/*" exige isso. O que precisava
          mudar eram os DESTINOS de navegação (NavLink/Navigate), agora
          absolutos — ver rotaInicial e RedirecionarPara acima. */}
      <Routes>
        <Route index element={<RedirecionarPara to={rotaInicial} />} />
        <Route path='consultar' element={<ConsultarPagamentos />} />
        <Route path='*' element={<RedirecionarPara to={rotaInicial} />} />
      </Routes>
    </div>
  )
}
