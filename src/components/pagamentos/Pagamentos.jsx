import React from 'react'
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { PERFIS_GESTORES_PAGAMENTO, PERFIS_VISAO_GERAL } from './tipos.js'
import ConsultarPagamentos from './ConsultarPagamentos.jsx'
import EmissaoBoleto from './EmissaoBoleto.jsx'

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
  // Gestores (síndico/zelador/portaria) administram os pagamentos do condomínio;
  // morador e conselheiro consultam apenas os próprios boletos.
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
          <p className='sub'>Chave PIX, boleto e consulta de pagamentos do condomínio.</p>
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
        {/* Decisão do módulo de Pagamentos (revisão do fluxo do boleto): a opção
            (A) foi mantida — EmissaoBoleto.jsx continua existindo como tela
            separada, agora ROTEADA, porque GerarCotas.jsx só gera a mensalidade
            rateada e a emissão manual segue necessária para cobranças avulsas
            (multa, serviço extra, evento) e para editar/cancelar baixas.
            Mesmo assim, o fluxo principal do morador NÃO depende dela: em "Meus
            Pagamentos" ele gera o boleto da própria mensalidade em um clique. */}
        {podeGerenciar && (
          <NavLink to='/pagamentos/emitir' className={classeLink}>
            <span className='link-icon'>🧾</span>
            <span className='link-text'>Emitir Boletos</span>
          </NavLink>
        )}
      </div>

      {/* Os CAMINHOS das rotas continuam RELATIVOS ("contas", nunca "/contas")
          porque o aninhamento sob "/pagamentos/*" exige isso. O que precisava
          mudar eram os DESTINOS de navegação (NavLink/Navigate), agora
          absolutos — ver rotaInicial e RedirecionarPara acima. */}
      <Routes>
        <Route index element={<RedirecionarPara to={rotaInicial} />} />
        <Route path='consultar' element={<ConsultarPagamentos />} />
        {podeGerenciar && <Route path='emitir' element={<EmissaoBoleto />} />}
        <Route path='*' element={<RedirecionarPara to={rotaInicial} />} />
      </Routes>
    </div>
  )
}
