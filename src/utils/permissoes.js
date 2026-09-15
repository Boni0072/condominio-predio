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

// A lista salva no cadastro do usuário ("Acesso às páginas") é a fonte da
// verdade: respeitamos EXATAMENTE o que o síndico marcou. Antes o código
// fazia a UNIÃO da lista salva com os padrões do perfil — uma página
// desmarcada em "Acesso às páginas" volta sozinha na próxima consulta, e a
// seleção do síndico era simplesmente ignorada.
// Contas antigas (sem o campo "acessos" no Firestore) ou com lista vazia
// recebem os padrões atuais do perfil.
export function acessosDoUsuario(usuario) {
  const padrao = ACESSOS_POR_PERFIL[usuario?.role] || []
  if (Array.isArray(usuario?.acessos) && usuario.acessos.length > 0) {
    // Mantém apenas páginas que existem de fato (PAGINAS_ACESSO) — nunca
    // concede acesso a algo que não esteja na lista oficial de páginas.
    const idsValidos = new Set(PAGINAS_ACESSO.map((p) => p.id))
    const selecionados = [
      ...new Set(
        usuario.acessos
          .filter((a) => typeof a === 'string' && idsValidos.has(a.trim()))
          .map((a) => a.trim())
      )
    ]
    // Lista salva só com páginas obsoletas (não existem mais) → usa padrões.
    if (selecionados.length > 0) return selecionados
  }
  // Sem lista salva ou lista vazia → padrões do perfil.
  return [...padrao]
}

export function temAcesso(usuario, pagina) {
  return acessosDoUsuario(usuario).includes(pagina)
}
