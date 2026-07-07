import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:8000'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const data = searchParams.get('data') ?? ''
  try {
    const res = await fetch(
      `${BACKEND_URL}/api/ongo-geral/historico?data=${encodeURIComponent(data)}`,
      { cache: 'no-store', signal: AbortSignal.timeout(15000) },
    )
    const body = await res.json()
    return NextResponse.json(body, { status: res.status })
  } catch {
    return NextResponse.json({ rows: [], total: 0, data }, { status: 503 })
  }
}
