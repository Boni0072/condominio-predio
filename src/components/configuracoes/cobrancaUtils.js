// Utilitários do rateio mensal. A cobrança oficial é compartilhada com a
// coleção de Pagamentos; estas chaves locais são migrações do modelo anterior.
// Compatibilidade para módulos antigos: a fonte oficial agora é "boletos".
export { chaveCobrancas, chaveCobrancasLegadas } from '../pagamentos/cobrancas.js'
export { cobrancaPertenceAoUsuario } from '../pagamentos/cobrancas.js'

// Chave do fallback local (localStorage) da mensalidade fixa do condomínio
// ({ ativo, valor }) usada na tabela de rateio.
export const chaveMensalidadeFixa = (condominioId) => `${condominioId}_mensalidade_fixa`

// Chave do fallback local (localStorage) das metragens (m²) por tipo de
// apartamento definidas na tabela de rateio ({ "1q-0v": "65", ... }).
export const chaveMetragensTipos = (condominioId) => `${condominioId}_metragens_tipos_apto`

// Chave do fallback local (localStorage) dos tipos de apartamento ADICIONADOS
// manualmente na tabela de rateio (lista de { quartos, vagas }), para definir o
// coeficiente de um tipo que ainda não tem unidades cadastradas.
export const chaveTiposExtras = (condominioId) => `${condominioId}_tipos_apto_extras`

// Status de exibição canônico: uma cobrança em aberto cujo vencimento passou
// aparece como "vencida" sem alterar silenciosamente o documento salvo.
export function statusEfetivoCobranca(cobranca) {
  if (cobranca?.status === 'pago' || cobranca?.status === 'cancelado') return cobranca.status
  if (cobranca?.status === 'vencido' || cobranca?.status === 'vencida') return 'vencida'
  if (cobranca?.dataVencimento) {
    const vencimento = new Date(`${cobranca.dataVencimento}T23:59:59`)
    if (!isNaN(vencimento.getTime()) && vencimento < new Date()) return 'vencida'
  }
  return 'pendente'
}

// Rótulos e cores exibidos pela tela de cobrança mensal.
export const ROTULO_STATUS_COBRANCA = {
  pendente: 'Pendente',
  vencida: 'Vencida',
  pago: 'Pago',
  cancelado: 'Cancelado'
}

export const CLASSE_BADGE_COBRANCA = {
  pendente: 'badge-blue',
  vencida: 'badge-orange',
  pago: 'badge-green',
  cancelado: 'badge-gray'
}
