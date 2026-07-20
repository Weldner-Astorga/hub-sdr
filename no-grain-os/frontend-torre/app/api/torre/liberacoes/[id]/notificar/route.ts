import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'
const INTERNAL_NOTIFY_TOKEN = process.env.INTERNAL_NOTIFY_TOKEN ?? ''

// M49 — proxy pro disparo WhatsApp de aderência (M48). O token vai só aqui,
// server-side (nunca chega ao bundle do cliente) — ver PRD.md §9.11.

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await req.json()
    const res = await fetch(`${BACKEND_URL}/api/liberacoes/${id}/notificar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': INTERNAL_NOTIFY_TOKEN,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro de rede'
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
