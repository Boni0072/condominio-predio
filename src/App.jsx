import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import Login from './components/Login.jsx'
import CompletarCadastro from './components/CompletarCadastro.jsx'
import Layout from './components/Layout.jsx'
import Painel from './components/painel/Painel.jsx'
import Portaria, {
  PortariaEncomendas,
  PortariaVisitantes
} from './components/portaria/Portaria.jsx'
import Mural from './components/mural/Mural.jsx'
import Despesas from './components/despesas/Despesas.jsx'
import Orcamento from './components/orcamento/Orcamento.jsx'
import Assembleias from './components/assembleias/Assembleias.jsx'
import Usuarios from './components/usuarios/Usuarios.jsx'
import Configuracoes from './components/configuracoes/Configuracoes.jsx'
import MasterCondominios from './components/master/MasterCondominios.jsx'
import { acessosDoUsuario, temAcesso } from './utils/permissoes.js'

export default function App() {
  const { user, userProfile, loading } = useAuth()

  if (loading) {
    return (
      <div className="login-screen">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <p className="sub">Carregando...</p>
        </div>
      </div>
    )
  }

  if (!user || !userProfile) {
    return <Login />
  }

  // Conta autenticada, mas cadastro no condomínio não concluído.
  if (userProfile.perfilPendente) {
    return <CompletarCadastro />
  }

  const acessos = acessosDoUsuario(userProfile)
  const homePath = acessos.includes('master')
    ? '/master/condominios'
    : acessos.includes('painel')
    ? '/painel'
    : acessos.includes('mural')
      ? '/mural'
      : acessos.includes('portaria')
        ? '/portaria'
        : acessos.includes('despesas')
            ? '/despesas'
            : acessos.includes('usuarios')
              ? '/usuarios'
              : '/configuracoes'

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to={homePath} replace />} />
        {temAcesso(userProfile, 'master') && (
          <Route path="/master/condominios" element={<MasterCondominios />} />
        )}
        {temAcesso(userProfile, 'painel') && (
          <Route path="/painel" element={<Painel />} />
        )}
        {temAcesso(userProfile, 'portaria') && (
          <Route path="/portaria" element={<Portaria />}>
            <Route index element={<Navigate to="visitantes" replace />} />
            <Route path="visitantes" element={<PortariaVisitantes />} />
            <Route path="encomendas" element={<PortariaEncomendas />} />
          </Route>
        )}
        {temAcesso(userProfile, 'despesas') && (
          <Route path="/despesas" element={<Despesas />} />
        )}
        {temAcesso(userProfile, 'orcamento') && (
          <Route path="/orcamento" element={<Orcamento />} />
        )}
        {temAcesso(userProfile, 'assembleias') && (
          <Route path="/assembleias" element={<Assembleias />} />
        )}
        {temAcesso(userProfile, 'usuarios') && (
          <Route path="/usuarios" element={<Usuarios />} />
        )}
        {temAcesso(userProfile, 'configuracoes') && (
          <Route path="/configuracoes" element={<Configuracoes />} />
        )}
        {temAcesso(userProfile, 'mural') && <Route path="/mural" element={<Mural />} />}
        <Route path="*" element={<Navigate to={homePath} replace />} />
      </Route>
    </Routes>
  )
}