import { NextResponse } from 'next/server'
import type { CargaOngoGeral } from '@/types/carga'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://htktdilkbdkqtvhthont.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? ''

type CargaOngoRow = Record<string, unknown>

function str(v: unknown, fallback = ''): string {
  return v != null && v !== '' ? String(v) : fallback
}

function num(v: unknown): number {
  if (v == null) return 0
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function mapRow(r: CargaOngoRow): CargaOngoGeral {
  return {
    id:                  str(r.id),
    link_id_carga:       str(r.link_id_carga),
    data_captura:        str(r.data_captura),
    empresa:             str(r.empresa, 'Não Identificado'),
    municipio_origem:    str(r.municipio_origem),
    terminal_origem:     str(r.terminal_origem),
    origem:              str(r.origem),
    destino:             str(r.destino),
    produto:             str(r.produto),
    quantidade_kg:       num(r.quantidade_kg),
    saldo_restante_kg:   num(r.saldo_restante_kg),
    valor_proposto_ton:  r.valor_proposto_ton != null ? num(r.valor_proposto_ton) : null,
    status:              str(r.status),
  }
}

export async function GET() {
  if (!SUPABASE_KEY) {
    return NextResponse.json({ cargas: [], error: 'SUPABASE_SERVICE_KEY não configurada' })
  }
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/cargas_ongo?select=*&order=data_captura.desc&limit=500`,
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
      return NextResponse.json({ cargas: [], error: `Supabase HTTP ${res.status}` })
    }
    const rows: CargaOngoRow[] = await res.json()
    return NextResponse.json({ cargas: rows.map(mapRow) })
  } catch (err) {
    return NextResponse.json({ cargas: [], error: err instanceof Error ? err.message : 'Erro' })
  }
}
