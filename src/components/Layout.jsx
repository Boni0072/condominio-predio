import React, { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { temAcesso } from '../utils/permissoes.js'
import { load, save } from '../utils/storage.js'
import BotaoInstalar from './shared/BotaoInstalar.jsx'

const ROLE_LABEL = {
  portaria: 'Portaria',
  sindico: 'Síndico / Administração',
  morador: 'Morador',
  zelador: 'Zelador'
}

export default function Layout() {
  const { userProfile, condominio, logout } = useAuth()
  const role = userProfile?.role
  const nomeUsuario = userProfile?.nome?.trim() || userProfile?.email?.split('@')[0] || 'Usuário'
  const [recolhido, setRecolhido] = useState(() => load('sidebar_recolhido', false))

  function alternarSidebar() {
    setRecolhido((atual) => {
      const novo = !atual
      save('sidebar_recolhido', novo)
      return novo
    })
  }

  return (
    <div className="app-shell">
      <div className="app-body">
        <nav className={'sidebar' + (recolhido ? ' recolhido' : '')}>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={alternarSidebar}
            title={recolhido ? 'Expandir menu' : 'Recolher menu'}
            aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
            aria-expanded={!recolhido}
          >
            {recolhido ? '»' : '«'}
          </button>

          <div className="sidebar-brand">
            {condominio?.logo ? (
              <img src={condominio.logo} alt="Logo do condomínio" className="logo-img" />
            ) : (
              <div className="mark mark-grande">CP</div>
            )}
            <div className="name">
              {condominio?.nome || 'Condomínio'}
              <span>Controle &amp; Gestão</span>
            </div>
          </div>

          {temAcesso(userProfile, 'master') && (
            <NavLink to="/master/condominios" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Condomínios
            </NavLink>
          )}

          {temAcesso(userProfile, 'painel') && (
            <NavLink to="/painel" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Painel de controle
            </NavLink>
          )}
          {temAcesso(userProfile, 'portaria') && (
            <NavLink to="/portaria" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Portaria
            </NavLink>
          )}
          {temAcesso(userProfile, 'despesas') && (
            <NavLink to="/despesas" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Despesas
            </NavLink>
          )}
          {temAcesso(userProfile, 'orcamento') && (
            <NavLink to="/orcamento" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Orçamento anual
            </NavLink>
          )}
          {temAcesso(userProfile, 'assembleias') && (
            <NavLink to="/assembleias" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Assembleias e reuniões
            </NavLink>
          )}
          {temAcesso(userProfile, 'usuarios') && (
            <NavLink to="/usuarios" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Usuários
            </NavLink>
          )}
          {temAcesso(userProfile, 'configuracoes') && (
            <NavLink to="/configuracoes" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Configurações
            </NavLink>
          )}
          {temAcesso(userProfile, 'mural') && (
            <NavLink to="/mural" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
              Mural de avisos
            </NavLink>
          )}

          <div className="sidebar-footer">
            <BotaoInstalar userProfile={userProfile} />
            <div className="user-info">
              <div className="user-info-header">
                <div className="user-avatar">
                  {userProfile?.nome?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div>
                  <strong>{nomeUsuario}</strong>
                  <span className={`badge ${role === 'sindico' ? 'badge-brick' : role === 'portaria' ? 'badge-blue' : 'badge-green'}`}>{ROLE_LABEL[role]}</span>
                  {userProfile?.codigo && (
                    <div className="user-codigo">
                      <span className="codigo-label">Código do condomínio:</span>
                      <code>{userProfile.codigo}</code>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button onClick={logout}>Sair</button>
          </div>
        </nav>

        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}