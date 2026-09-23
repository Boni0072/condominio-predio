// Utilitários do sistema de COBRANÇA dos moradores (coleção própria
// "cobrancas", independente dos boletos do módulo Pagamentos).

// Chave do fallback local (localStorage) das cobranças do condomínio.
export const chaveCobrancas = (condominioId) => `${condominioId}_cobrancas`

// Chave do fallback local (localStorage) da mensalidade fixa do condomínio
// ({ ativo, valor }) usada na tabela de rateio.
export const chaveMensalidadeFixa = (condominioId) => `${condominioId}_mensalidade_fixa`

// Chave do fallback local (localStorage) dos tipos de apartamento ADICIONADOS
// manualmente na tabela de rateio (lista de { quartos, vagas }), para definir o
// coeficiente de um tipo que ainda não tem unidades cadastradas.
export const chaveTiposExtras = (condominioId) => `${condominioId}_tipos_apto_extras`

// Uma cobrança é do usuário quando foi emitida para o uid dele, para o id do
// cadastro de morador vinculado ou para o e-mail dele (morador sem conta no
// app — a geração guarda moradorEmail justamente para este caso).
export function cobrancaPertenceAoUsuario(cobranca, usuario) {
  if (!cobranca || !usuario) return false
  const ids = [usuario.uid, usuario.id].filter(Boolean)
  if (cobranca.moradorUserId && ids.includes(cobranca.moradorUserId)) return true
  if (cobranca.moradorId && ids.includes(cobranca.moradorId)) return true
  const email = String(usuario.email || '').trim().toLowerCase()
  const emailCobranca = String(cobranca.moradorEmail || '').trim().toLowerCase()
  return Boolean(email) && email === emailCobranca
}

// Status de exibição: cobrança "pendente" cujo vencimento já passou aparece
// como "vencida" — sem depender de rotina no servidor para atualizar o status.
export function statusEfetivoCobranca(cobranca) {
  if (cobranca?.status === 'paga' || cobranca?.status === 'cancelada') return cobranca.status
  if (cobranca?.dataVencimento) {
    const vencimento = new Date(`${cobranca.dataVencimento}T23:59:59`)
    if (!isNaN(vencimento.getTime()) && vencimento < new Date()) return 'vencida'
  }
  return 'pendente'
}

// Rótulos e cores dos badges (classes já existentes no index.css).
export const ROTULO_STATUS_COBRANCA = {
  pendente: 'Pendente',
  vencida: 'Vencida',
  paga: 'Paga',
  cancelada: 'Cancelada'
}

export const CLASSE_BADGE_COBRANCA = {
  pendente: 'badge-blue',
  vencida: 'badge-orange',
  paga: 'badge-green',
  cancelada: 'badge-gray'
}
