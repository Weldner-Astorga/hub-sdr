import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const res = await fetch(`${BACKEND_URL}/api/whatsapp/timeline/${id}/tratado`, {
      method: 'PATCH',
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro de rede'
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
