import { NextResponse } from 'next/server'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://htktdilkbdkqtvhthont.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? ''

type TrizyRow = Record<string, unknown>

function str(v: unknown, fallback = ''): string {
  return v != null && v !== '' ? String(v) : fallback
}

function parsePreco(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

// status_crm parte como 'Novo' (default do extrator) — fora do enum StatusCotacao,
// normaliza para RECEBIDA. Valores já canônicos (uppercase) passam direto.
function normalizeStatus(v: unknown): string {
  const s = str(v)
  return s && s !== 'Novo' ? s : 'RECEBIDA'
}

function mapRow(r: TrizyRow) {
  // Prioridade: cidade/UF (legível e geocodificável) → string completa → nome do ponto
  const origem = [r.origem_cidade, r.origem_estado].filter(Boolean).join('/')
    || str(r.localizacao_origem)
    || str(r.ponto_coleta_nome)
    || ''

  const destino = [r.destino_cidade, r.destino_estado].filter(Boolean).join('/')
    || str(r.localizacao_destino)
    || str(r.ponto_entrega_nome)
    || ''

  const origem_localidade = str(r.entidade_origem) || str(r.ponto_coleta_nome)
  const destino_localidade = str(r.entidade_destino) || str(r.ponto_entrega_nome)

  const prazo = r.prazo_limite_resposta != null ? String(r.prazo_limite_resposta) : undefined

  return {
    id:                    str(r.id_frete_externo) || str(r.id),
    fonte_ingestao:        'ongo_cotacao' as const,
    embarcador:            str(r.empresa_embarcadora, 'Não Identificado'),
    cliente:               str(r.empresa_embarcadora, 'Não Identificado'),
    contato:               str(r.cnpj_embarcadora),
    portal_origem:         'Trizy BID',
    origem,
    destino,
    origem_localidade,
    destino_localidade,
    produto:               str(r.produto),
    tipo_veiculo:          'Não Especificado',
    valor_tonelada:        parsePreco(r.preco_por_tonelada) || parsePreco(r.preco_oferta),
    volume_total:          r.peso_toneladas != null ? `${r.peso_toneladas} t` : '',
    cadencia_diaria:       r.cadencia_toneladas != null
                             ? `${r.cadencia_toneladas} t/dia`
                             : 'Não Especificado',
    prazo_limite_resposta: prazo,
    sem_prazo:             prazo == null,
    distancia_km:          r.distancia_km != null ? Number(r.distancia_km) : null,
    observacoes:           str(r.observacao_geral),
    status:                normalizeStatus(r.status_crm),
    criado_em:             str(r.criado_em),
    id_ongo:               '',
    preco_proposto:        r.valor_proposto_ton != null ? Number(r.valor_proposto_ton) : null,
    pedagio_total_calc:    null,
    antt_piso_por_ton:     null,
    // campos específicos Trizy BID
    id_externo:            str(r.id_frete_externo),
    possui_pedagio:        str(r.possui_pedagio),
    pedagio_incluso:       str(r.pedagio_incluso),
    pedagio_valor_eixo:    r.pedagio_valor_por_eixo != null ? Number(r.pedagio_valor_por_eixo) : null,
    condicao_pagamento:    str(r.condicao_pagamento),
    status_trizy:          str(r.status_interno),
    icms:                  r.icms != null ? String(r.icms) : null,
    origem_maps_link:        str(r.localizacao_origem_link) || null,
    destino_maps_link:       str(r.localizacao_destino_link) || null,
    observacao_origem:       str(r.observacao_origem) || null,
    observacao_destino:      str(r.observacao_destino) || null,
    // auditoria completa
    local_coleta_full:       str(r.localizacao_origem) || null,
    local_entrega_full:      str(r.localizacao_destino) || null,
    entidade_origem_trizy:   str(r.entidade_origem) || null,
    entidade_destino_trizy:  str(r.entidade_destino) || null,
    observacao_geral_trizy:  str(r.observacao_geral) || null,
    preco_referencia_trizy:  parsePreco(r.preco_por_tonelada) || null,
  }
}

export async function GET() {
  if (!SUPABASE_KEY) {
    return NextResponse.json({ cotacoes: [], error: 'SUPABASE_SERVICE_KEY não configurada' })
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/octamove_extracao_trizy?select=*&order=criado_em.desc&limit=200`,
      {
        headers: {
          apikey:        SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept:        'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) {
      return NextResponse.json({ cotacoes: [], error: `Supabase HTTP ${res.status}` })
    }
    const rows: TrizyRow[] = await res.json()
    return NextResponse.json({ cotacoes: rows.map(mapRow) })
  } catch (err) {
    return NextResponse.json({ cotacoes: [], error: err instanceof Error ? err.message : 'Erro' })
  }
}
