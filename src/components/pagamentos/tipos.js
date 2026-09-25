// Sistema de Pagamentos para Condomínio
// Permite: configuração de contas bancárias/PIX, emissão de boletos, consulta de pagamentos

export const TIPOS_PAGAMENTO = [
  { id: 'mensalidade', label: 'Mensalidade', descricao: 'Taxa mensal do condomínio' },
  { id: 'multa', label: 'Multa', descricao: 'Tarifa por atraso no pagamento' },
  { id: 'servico_extra', label: 'Serviço Extra', descricao: 'Serviços adicionais (elevador, piscina, segurança, etc)' },
  { id: 'evento', label: 'Evento', descricao: 'Taxas de eventos ou assembleias' },
  { id: 'outros', label: 'Outros', descricao: 'Outros tipos de cobrança' }
]

export const STATUS_BOLETO = [
  { id: 'gerado', label: 'Gerado', descricao: 'Boleto emitido, aguardando pagamento' },
  { id: 'vencido', label: 'Vencido', descricao: 'Data de vencimento passou sem pagamento' },
  { id: 'pago', label: 'Pago', descricao: 'Pagamento confirmado' },
  { id: 'cancelado', label: 'Cancelado', descricao: 'Boleto cancelado pelo síndico' }
]

export const STATUS_PIX = [
  { id: 'ativo', label: 'Ativo', descricao: 'Chave PIX ativa para pagamentos' },
  { id: 'inativo', label: 'Inativo', descricao: 'Chave PIX desativada' }
]

// Perfis que ADMINISTRAM pagamentos: emitir/editar boletos, dar baixa e
// configurar contas bancárias/PIX.
export const PERFIS_GESTORES_PAGAMENTO = ['sindico', 'zelador', 'portaria']

// Perfis que podem CONSULTAR os pagamentos de todo o condomínio. Regra de
// privacidade: somente os gestores (síndico, zelador e portaria). Os demais
// perfis — morador E conselheiro — consultam apenas os próprios boletos.
export const PERFIS_VISAO_GERAL = [...PERFIS_GESTORES_PAGAMENTO]

export const BANCO_OPCOES = [
  { codigo: '001', nome: 'Banco do Brasil' },
  { codigo: '041', nome: 'Itaú' },
  { codigo: '033', nome: 'Santander' },
  { codigo: '104', nome: 'Bradesco' },
  { codigo: '237', nome: 'Caixa Econômica' },
  { codigo: '341', nome: 'Banco Inter' },
  { codigo: '745', nome: 'Banco Daycoval' },
  { codigo: '085', nome: 'Nubank' },
  { codigo: '003', nome: 'BS2' },
  { codigo: '292', nome: 'BTG Pactual' }
]