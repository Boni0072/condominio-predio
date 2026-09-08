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
  // Morador vê as configurações do condomínio em modo SOMENTE LEITURA
  // (nome, logo, endereço) e mantém as configurações do próprio dispositivo
  // (notificações push e tema de cores).
  morador: ['painel', 'despesas', 'assembleias', 'mural', 'configuracoes'],
  // Zelador também acompanha o mural de avisos do condomínio.
  zelador: ['painel', 'despesas', 'orcamento', 'assembleias', 'mural']
}

// Acessos que o sistema garante conforme o perfil, mesmo para usuários cuja
// lista foi salva no Firestore antes de a página existir nos padrões — sem
// esse backfill, o menu da novidade não aparece para quem já tinha cadastro.
const ACESSOS_ESSENCIAIS = ['assembleias', 'configuracoes', 'mural']

export function acessosDoUsuario(usuario) {
  const padrao = ACESSOS_POR_PERFIL[usuario?.role] || []
  if (Array.isArray(usuario?.acessos)) {
    // Lista salva vazia = cadastro quebrado/antigo: usa os padrões do perfil.
    if (usuario.acessos.length === 0) return [...padrao]
    const acessosAtualizados = new Set(usuario.acessos)
    ACESSOS_ESSENCIAIS.forEach((acesso) => {
      if (padrao.includes(acesso)) acessosAtualizados.add(acesso)
    })
    return Array.from(acessosAtualizados)
  }
  return padrao
}

export function temAcesso(usuario, pagina) {
  return acessosDoUsuario(usuario).includes(pagina)
}
