export const PAGINAS_ACESSO = [
  { id: 'master', label: 'Administração da plataforma' },
  { id: 'painel', label: 'Painel de controle' },
  { id: 'portaria', label: 'Portaria' },
  { id: 'despesas', label: 'Despesas' },
  { id: 'orcamento', label: 'Orçamento anual' },
  { id: 'assembleias', label: 'Assembleias e reuniões' },
  { id: 'usuarios', label: 'Gestão de usuários' },
  { id: 'configuracoes', label: 'Configurações do condomínio' },
  { id: 'mural', label: 'Mural de avisos' },
  { id: 'pagamentos', label: 'Pagamentos (boletos, PIX, consultas)' }
]

export const ACESSOS_POR_PERFIL = {
  master: ['master'],
  sindico: ['painel', 'portaria', 'despesas', 'orcamento', 'assembleias', 'usuarios', 'configuracoes', 'mural', 'pagamentos'],
  portaria: ['painel', 'portaria', 'configuracoes', 'assembleias', 'mural', 'pagamentos'],
  // Morador: acesso básico ao painel, assembleias, mural e à consulta dos
  // próprios boletos/pagamentos (a emissão e a configuração de contas ficam
  // restritas ao síndico/zelador/portaria no próprio componente).
  morador: ['painel', 'pagamentos', 'assembleias', 'mural'],
  // Zelador também acompanha o mural de avisos do condomínio.
  zelador: ['painel', 'despesas', 'orcamento', 'configuracoes', 'assembleias', 'mural', 'pagamentos'],
  // Conselheiro acompanha e APROVA os orçamentos mensais (não edita valores).
  conselheiro: ['painel', 'orcamento', 'assembleias', 'mural', 'configuracoes', 'pagamentos']
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

// ---------------------------------------------------------------------------
// VISIBILIDADE DOS DADOS (privacidade entre usuários)
// ---------------------------------------------------------------------------
// Regra do condomínio: PAGAMENTOS (boletos/cobranças), VISITANTES e ENCOMENDAS
// são dados individuais. Cada usuário enxerga APENAS os próprios registros —
// os da sua unidade (ou endereçados ao próprio nome).
// Quem enxerga TODOS os registros do condomínio são somente os GESTORES:
// síndico, zelador e portaria. O master (administração da plataforma) também
// vê tudo, pois é ele quem cria/gerencia os condomínios.
export const PERFIS_VISAO_TOTAL = ['sindico', 'zelador', 'portaria', 'master']

// Compara textos ignorando acentos, pontuação, caixa e espaços extras, de modo
// que "Bloco A, apto 12" e "bloco a apto 12" sejam tratados como iguais.
export function normalizarParaComparacao(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// O usuário logado tem visão total dos registros do condomínio?
export function veTodosOsRegistros(usuario) {
  return PERFIS_VISAO_TOTAL.includes(usuario?.role)
}

// O registro (visitante, encomenda, boleto...) pertence ao usuário logado?
// Casa pela unidade do cadastro e pelo nome/e-mail (destinatário, morador).
export function registroPertenceAoUsuario(registro, usuario) {
  if (!registro || !usuario) return false

  const minhaUnidade = normalizarParaComparacao(usuario.unidade)
  const unidadeDoRegistro = normalizarParaComparacao(registro.unidade || registro.moradorUnidade)
  if (minhaUnidade && unidadeDoRegistro && minhaUnidade === unidadeDoRegistro) return true

  const meusNomes = [usuario.nome, usuario.email]
    .map(normalizarParaComparacao)
    .filter(Boolean)
  if (meusNomes.length === 0) return false

  const nomesDoRegistro = [registro.destinatario, registro.moradorNome, registro.moradorEmail]
    .map(normalizarParaComparacao)
    .filter(Boolean)
  return meusNomes.some((nome) => nomesDoRegistro.includes(nome))
}

// Aplica a regra acima em uma lista: gestores recebem a lista inteira, os
// demais perfis recebem apenas os próprios registros.
export function filtrarDoUsuario(registros, usuario) {
  const lista = Array.isArray(registros) ? registros : []
  if (veTodosOsRegistros(usuario)) return lista
  return lista.filter((registro) => registroPertenceAoUsuario(registro, usuario))
}
