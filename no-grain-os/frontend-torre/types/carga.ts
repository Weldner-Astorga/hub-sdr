export type FonteIngestao =
  | 'whatsapp_grupo'
  | 'gmail_cotacao'
  | 'ongo_cotacao'
  | 'ongo_geral'

export type StatusCotacao =
  | 'RECEBIDA'
  | 'CALCULADA'
  | 'PENDENTE'
  | 'COTACAO_FILIAL'
  | 'APROV_DIRETORIA'
  | 'RESPONDIDA'
  | 'GANHA'
  | 'PERDIDA'
  | 'sem_resposta'
  | 'respondida'

export interface CargaLogistica {
  id: string
  origem: string
  destino: string
  produto: string
  tipo_veiculo: string
  valor_tonelada: number
  volume_total: string
  fonte_ingestao: FonteIngestao
  id_ongo: string
  status?: StatusCotacao
  embarcador?: string
  contato?: string
  observacoes?: string
  criado_em?: string
  // M4 — dados fiéis
  cliente?: string
  portal_origem?: string
  origem_localidade?: string
  destino_localidade?: string
  cadencia_diaria?: string
  prazo_limite_resposta?: string
  sem_prazo?: boolean
  coords_coleta_lat?: number | null
  coords_coleta_lng?: number | null
  coords_entrega_lat?: number | null
  coords_entrega_lng?: number | null
  preco_proposto?: number | null
  // M7 — dados de cálculo gravados
  distancia_km?: number | null
  pedagio_total_calc?: number | null
  antt_piso_por_ton?: number | null
  status_atualizado_em?: string
  // Trizy BID — campos específicos
  id_externo?: string | null
  possui_pedagio?: string | null
  pedagio_incluso?: string | null
  pedagio_valor_eixo?: number | null
  condicao_pagamento?: string | null
  status_trizy?: string | null
  icms?: string | null
  origem_maps_link?: string | null
  destino_maps_link?: string | null
  observacao_origem?: string | null
  observacao_destino?: string | null
  // Trizy BID — campos extras auditoria completa
  local_coleta_full?: string | null       // "Nome Ponto - Cidade/UF" raw do API
  local_entrega_full?: string | null
  entidade_origem_trizy?: string | null   // empresa/entidade no ponto de coleta
  entidade_destino_trizy?: string | null
  observacao_geral_trizy?: string | null
  preco_referencia_trizy?: number | null  // valorReferenciaFrete do embarcador
  // M6 — incidência fiscal
  fiscal?: {
    tipo: 'ICMS' | 'ISSQN'
    aliquota: number | null
    descricao: string
    tag: string
  }
}

export interface ApiResponse {
  fretes: CargaLogistica[]
  timestamp: string
  fontes?: {
    ongo_geral: number
    whatsapp_grupo: number
    gmail_cotacao: number
  }
}
