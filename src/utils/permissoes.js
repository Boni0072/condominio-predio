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
  // Morador: acesso básico ao painel, assembleias e mural
  morador: ['painel', 'assembleias', 'mural'],
  // Zelador também acompanha o mural de avisos do condomínio.
  zelador: ['painel', 'despesas', 'orcamento', 'assembleias', 'mural'],
  // Conselheiro acompanha e APROVA os orçamentos mensais (não edita valores).
  conselheiro: ['painel', 'orcamento', 'assembleias', 'mural', 'configuracoes']
}

// A lista salva no cadastro do usuário é a fonte da verdade: o que o síndico
// marcou em "Acesso às páginas" (inclusive para o Conselheiro) é respeitado.
// Para contas antigas (sem lista salva ou sem a página incluída), o padrão do
// perfil é completado automaticamente — sem isso o conselheiro nunca veria a
// página "Orçamento anual" nem chegaria ao botão "Firmar e guardar aprovação".
export function acessosDoUsuario(usuario) {
  const padrao = ACESSOS_POR_PERFIL[usuario?.role] || []
  let acessos
  if (Array.isArray(usuario?.acessos)) {
    // Lista salva vazia = cadastro quebrado/antigo: usa os padrões do perfil.
    if (usuario.acessos.length === 0) {
      acessos = [...padrao]
    } else {
      const completos = new Set(usuario.acessos)
      padrao.forEach((acesso) => completos.add(acesso))
      acessos = Array.from(completos)
    }
  } else {
    acessos = [...padrao]
  }
  return acessos
}

export function temAcesso(usuario, pagina) {
  return acessosDoUsuario(usuario).includes(pagina)
}
