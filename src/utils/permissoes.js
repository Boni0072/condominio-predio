export const PAGINAS_ACESSO = [
  { id: 'master', label: 'Administração da plataforma' },
  { id: 'painel', label: 'Painel de controle' },
  { id: 'portaria', label: 'Portaria' },
  { id: 'despesas', label: 'Despesas' },
  { id: 'orcamento', label: 'Orçamento anual' },
  { id: 'assembleias', label: 'Assembleias e reuniões' },
  { id: 'usuarios', label: 'Gestão de usuários' },
  { id: 'configuracoes', label: 'Configurações do condomínio' },
  { id: 'mural', label: 'Mural de avisos' }
]

export const ACESSOS_POR_PERFIL = {
  master: ['master'],
  sindico: ['painel', 'portaria', 'despesas', 'orcamento', 'assembleias', 'usuarios', 'configuracoes', 'mural'],
  portaria: ['painel', 'portaria', 'assembleias', 'mural'],
  morador: ['painel', 'despesas', 'assembleias', 'mural'],
  zelador: ['painel', 'despesas', 'orcamento', 'assembleias']
}

export function acessosDoUsuario(usuario) {
  if (Array.isArray(usuario?.acessos)) {
    const acessosAtualizados = new Set(usuario.acessos)
    if (ACESSOS_POR_PERFIL[usuario?.role]?.includes('assembleias')) acessosAtualizados.add('assembleias')
    return Array.from(acessosAtualizados)
  }
  return ACESSOS_POR_PERFIL[usuario?.role] || []
}

export function temAcesso(usuario, pagina) {
  return acessosDoUsuario(usuario).includes(pagina)
}
