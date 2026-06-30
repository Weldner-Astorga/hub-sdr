'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  ArrowLeft, Truck, Zap, Loader2, AlertCircle, Copy, Check,
  Route, Scale, MapPin, Navigation, Send, Link2,
  ChevronUp, ChevronDown, Wheat, Map, Calculator,
  Brain, TrendingUp, Clock,
} from 'lucide-react'

const MapaRota = dynamic(() => import('@/components/MapaRota'), { ssr: false })

// ─── Constantes ANTT ──────────────────────────────────────────────────────────

const CAPACIDADE_FIXA = { 7: 37, 9: 50 } as const
const ANTT_COEF = {
  7: { ccd: 8.0855, ccf: 808.20, label: 'Bitrem 7 Eixos',   cap: 37 },
  9: { ccd: 9.2662, ccf: 877.83, label: 'Rodotrem 9 Eixos', cap: 50 },
} as const
const TIPO_CARGA_OPTIONS = [
  { value: 'granel_solido',  label: 'Granel Sólido' },
  { value: 'granel_liquido', label: 'Granel Líquido' },
  { value: 'carga_geral',    label: 'Carga Geral' },
  { value: 'frigorificada',  label: 'Frigorificada' },
  { value: 'conteinerizada', label: 'Conteinerizada' },
]

// ─── Tipos ────────────────────────────────────────────────────────────────────

type ApiResult = {
  rota: {
    origem: string
    destino: string
    distancia_km: number
    fonte: string
    polyline: [number, number][]
    pedagio_pontos: { lat: number; lng: number; nome: string; valor: number }[]
    freight_table: unknown[]
  }
  pedagio: {
    valor_total: number
    por_tonelada: number
    capacidade_fixa: number
  }
  antt: {
    frete_minimo_total: number
    frete_minimo_por_tonelada: number
    ccd: number
    ccf: number
    resolucao: string
    tipo_carga_label: string
    tipo_veiculo: string
  }
  contrato: {
    piso_antt_por_ton: number
    piso_antt_total: number
    cotacao_por_ton: number
    cotacao_total: number | null
    diferenca_por_ton: number | null
    diferenca_total: number | null
    status: 'acima_piso' | 'abaixo_piso' | 'sem_cotacao'
    num_viagens: number
    capacidade_veiculo: number
  }
}

type RagResultado = {
  id: string; origem: string; destino: string; produto: string
  tipo_veiculo: string | null; valor_tonelada: number
  embarcador: string | null; data_fechamento: string; similaridade: number
}
type RagData = { resultados: RagResultado[]; query: string; total: number; erro?: string }

// ─── Formatadores ─────────────────────────────────────────────────────────────

function brl(v: number | null | undefined) {
  if (v == null || v === 0) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v)
}

function num(v: number | null | undefined, dec = 2) {
  if (v == null || isNaN(v) || v === 0) return '—'
  return v.toFixed(dec).replace('.', ',')
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function clipCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;top:-9999px'
    document.body.appendChild(ta); ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WorkspaceCalcular() {
  const params = useParams()
  const router = useRouter()
  const cotacaoId = params?.id as string

  const [origemInput,  setOrigemInput]  = useState('')
  const [destinoInput, setDestinoInput] = useState('')
  const [produto,      setProduto]      = useState('')
  const [eixos,        setEixos]        = useState<7 | 9>(9)
  const [tipoCarga,    setTipoCarga]    = useState('granel_solido')
  const [precoTon,     setPrecoTon]     = useState('')
  const [volumeInfo,   setVolumeInfo]   = useState<string | null>(null)
  const [embarcador,   setEmbarcador]   = useState<string | null>(null)

  const [origemLocalidade,  setOrigemLocalidade]  = useState<string | null>(null)
  const [destinoLocalidade, setDestinoLocalidade] = useState<string | null>(null)
  const [origemMapsLink,    setOrigemMapsLink]    = useState<string | null>(null)
  const [destinoMapsLink,   setDestinoMapsLink]   = useState<string | null>(null)

  const [calcando,      setCalcando]      = useState(false)
  const [salvandoPreco, setSalvandoPreco] = useState(false)
  const [resultado,     setResultado]     = useState<ApiResult | null>(null)
  const [erro,          setErro]          = useState<string | null>(null)
  const [ragData,       setRagData]       = useState<RagData | null>(null)
  const [ragLoading,    setRagLoading]    = useState(false)

  const [toastMsg,  setToastMsg]  = useState('')
  const [toastShow, setToastShow] = useState(false)
  const toastRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function toast(msg: string) {
    if (toastRef.current) clearTimeout(toastRef.current)
    setToastMsg(msg); setToastShow(true)
    toastRef.current = setTimeout(() => setToastShow(false), 3000)
  }

  // ── Carrega cotação pelo ID ────────────────────────────────────────────────
  useEffect(() => {
    if (!cotacaoId || cotacaoId === 'novo') return

    function aplicarItem(item: Record<string, unknown>) {
      setOrigemInput((item.origem as string) || '')
      setDestinoInput((item.destino as string) || '')
      setProduto((item.produto as string) || '')
      if ((item.valor_tonelada as number) > 0) setPrecoTon(String(item.valor_tonelada))
      if (item.volume_total) setVolumeInfo(item.volume_total as string)
      const nomeCliente = (item.cliente as string | undefined)
      const nomeEmb     = (item.embarcador as string | undefined)
      const displayNome = nomeCliente && nomeCliente !== 'Não Identificado' ? nomeCliente : nomeEmb
      if (displayNome && displayNome !== 'Não Identificado') setEmbarcador(displayNome)
      if (item.origem_localidade) setOrigemLocalidade(item.origem_localidade as string)
      if (item.destino_localidade) setDestinoLocalidade(item.destino_localidade as string)
      if (item.origem_maps_link) setOrigemMapsLink(item.origem_maps_link as string)
      if (item.destino_maps_link) setDestinoMapsLink(item.destino_maps_link as string)
    }

    fetch('/api/fretes', { cache: 'no-store' })
      .then(r => r.json())
      .then(async data => {
        const item = (data.fretes as Record<string, unknown>[] | undefined)?.find(f => f.id === cotacaoId)
        if (item) { aplicarItem(item); return }
        // Não achou em painel_fretes — tenta Trizy BID
        const resTz = await fetch('/api/trizy/cotacoes', { cache: 'no-store' })
        const dataTz = await resTz.json()
        const trizyItem = (dataTz.cotacoes as Record<string, unknown>[] | undefined)
          ?.find(c => c.id === cotacaoId || c.id_externo === cotacaoId)
        if (trizyItem) aplicarItem(trizyItem)
      })
      .catch(() => { /* silencia — modo manual disponível */ })
  }, [cotacaoId])

  async function fetchRag(origem: string, destino: string, prod: string) {
    setRagLoading(true)
    try {
      const res = await fetch('/api/precificar/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origem, destino, produto: prod || 'Granel', tipo_veiculo: '' }),
      })
      const data = await res.json()
      setRagData(data as RagData)
    } catch { /* silencia — RAG é secundário */ }
    finally { setRagLoading(false) }
  }

  // ── Calcular rota via QualP (backend) ────────────────────────────────────
  async function calcular() {
    if (!origemInput.trim() || !destinoInput.trim()) {
      setErro('Preencha Origem e Destino.'); return
    }
    setCalcando(true); setErro(null); setResultado(null)
    try {
      const res = await fetch('/api/precificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origem:                    origemInput.trim(),
          destino:                   destinoInput.trim(),
          produto:                   produto.trim() || 'Granel',
          tipo_carga:                tipoCarga,
          eixos,
          volume_toneladas:          CAPACIDADE_FIXA[eixos],
          valor_cotado_por_tonelada: parseFloat(precoTon) || 0,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail ?? data.error ?? `HTTP ${res.status}`)
      setResultado(data as ApiResult)
      fetchRag(origemInput.trim(), destinoInput.trim(), produto.trim() || 'Granel')

      // ── Auto-transição → CALCULADA ──────────────────────────────────────
      if (cotacaoId && cotacaoId !== 'novo') {
        fetch(`/api/cotacoes/${cotacaoId}/calcular`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            distancia_km:      data.rota.distancia_km,
            pedagio_total:     data.pedagio.valor_total,
            antt_piso_por_ton: data.antt.frete_minimo_por_tonelada,
          }),
        }).catch(() => { /* silencia — não bloqueia o resultado */ })
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao calcular.')
    } finally { setCalcando(false) }
  }

  // ── Salvar preço → COTACAO_FILIAL ou APROV_DIRETORIA ─────────────────────
  async function salvarPreco() {
    if (!cotacaoId || cotacaoId === 'novo') { toast('Cotação sem ID — operação manual.'); return }
    const preco = parseFloat(precoTon)
    if (!preco || preco <= 0) { toast('Informe o preço antes de salvar.'); return }
    setSalvandoPreco(true)
    try {
      const res = await fetch(`/api/cotacoes/${cotacaoId}/preco`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preco_proposto:    preco,
          antt_piso_por_ton: r?.antt.frete_minimo_por_tonelada ?? 0,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        const msg = data.status === 'APROV_DIRETORIA'
          ? `Margem ${data.margem_pct}% < 10% — enviado para Diretoria`
          : `Preço salvo — Cotação Filial (margem ${data.margem_pct}%)`
        toast(msg)
      }
    } catch { toast('Erro ao salvar preço.') }
    finally { setSalvandoPreco(false) }
  }

  // ── Derivar coords do mapa da polyline QualP ──────────────────────────────
  const polyline  = resultado?.rota.polyline ?? []
  const originCoords: [number, number] | null = polyline.length > 0 ? polyline[0] : null
  const destCoords:   [number, number] | null = polyline.length > 1 ? polyline[polyline.length - 1] : null

  // ── Cálculos derivados ────────────────────────────────────────────────────
  const r       = resultado
  const pisoTon = r?.antt.frete_minimo_por_tonelada ?? null
  const pedTon  = r?.pedagio.por_tonelada ?? null
  const preco   = parseFloat(precoTon) || 0
  const margemPct = preco > 0 && pisoTon != null && pisoTon > 0
    ? ((preco - pisoTon) / preco) * 100
    : null

  // ── Ações rápidas ─────────────────────────────────────────────────────────
  function copiarWhatsApp() {
    if (!r) return
    const coef = ANTT_COEF[eixos]
    const lines = [
      `📍 ROTA: ${r.rota.origem} → ${r.rota.destino}`,
      `🚛 ${coef.label} | ${coef.cap}t`,
      `🛣️ Distância: ${r.rota.distancia_km.toLocaleString('pt-BR')} km`,
      `⛽ Pedágio Total: ${brl(r.pedagio.valor_total)} (${num(pedTon)}/t)`,
      `⚖️ Piso ANTT: R$ ${num(pisoTon)}/t`,
      ...(preco > 0 ? [`💰 Preço Proposto: R$ ${preco.toFixed(2).replace('.', ',')}/t`] : []),
      ...(margemPct != null ? [`📊 Margem estimada: ${margemPct.toFixed(1)}%`] : []),
      `📋 ${r.antt.resolucao}`,
    ]
    clipCopy(lines.join('\n'))
    toast('Texto copiado para WhatsApp!')

    // ── Auto-transição → RESPONDIDA ────────────────────────────────────────
    if (cotacaoId && cotacaoId !== 'novo') {
      fetch(`/api/cotacoes/${cotacaoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESPONDIDA' }),
      }).catch(() => {})
    }
  }

  async function enviarAprovacao() {
    if (!cotacaoId || cotacaoId === 'novo') { toast('Cotação sem ID — operação manual.'); return }
    try {
      const res = await fetch(`/api/cotacoes/${cotacaoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'APROV_DIRETORIA' }),
      })
      toast(res.ok ? 'Enviado para Aprovação da Diretoria!' : 'Erro ao atualizar status.')
    } catch { toast('Erro de rede.') }
  }

  function copiarLink() {
    clipCopy(`${window.location.origin}/torre/calcular/${cotacaoId}`)
    toast('Link copiado!')
  }

  const podeCalcular = origemInput.trim() !== '' && destinoInput.trim() !== ''

  // Detecta se origem/destino tem formato geocodificável ("Texto/UF" ou "Texto - UF")
  const UF_RE = /\/[A-Z]{2}$|\s[-–]\s*[A-Z]{2}$/
  const origemGeoOk  = UF_RE.test(origemInput.trim())
  const destinoGeoOk = UF_RE.test(destinoInput.trim())

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-white overflow-hidden">

      {/* Toast */}
      <div className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-2 bg-emerald-700 text-white text-sm font-semibold px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 ${toastShow ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`}>
        <Check size={15} />{toastMsg}
      </div>

      {/* Header fino */}
      <header className="h-11 shrink-0 border-b border-zinc-800 flex items-center px-4 gap-3 bg-zinc-950/90 backdrop-blur-sm">
        <button onClick={() => router.back()}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors text-xs">
          <ArrowLeft size={13} /> Radar
        </button>
        <span className="text-zinc-800">|</span>
        <div className="flex items-center gap-1.5">
          <Wheat size={12} className="text-emerald-400" />
          <span className="text-xs font-semibold text-white">NO GRAIN OS</span>
          <span className="text-zinc-600 text-xs">· Workspace</span>
        </div>
        {embarcador && (
          <>
            <span className="text-zinc-800">·</span>
            <span className="text-xs text-emerald-400 font-medium truncate max-w-[140px]">{embarcador}</span>
          </>
        )}
        {(origemInput || destinoInput) && (
          <>
            <span className="text-zinc-800">·</span>
            <span className="text-xs text-zinc-400 truncate max-w-xs">
              {origemInput || '?'} → {destinoInput || '?'}
            </span>
          </>
        )}
      </header>

      {/* Split principal */}
      <div className="flex flex-1 min-h-0">

        {/* ═══ ESQUERDA 25% — Calculadora ════════════════════════════════════ */}
        <aside className="w-[25%] shrink-0 border-r border-zinc-800 overflow-y-auto flex flex-col bg-zinc-900">
          <div className="p-4 flex flex-col gap-4">

            {/* Rota */}
            <section>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold flex items-center gap-1 mb-2">
                <Navigation size={9} /> Rota
              </p>
              <div className="flex flex-col gap-2">
                <div>
                  <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Origem</label>
                  <input type="text" value={origemInput} onChange={e => setOrigemInput(e.target.value)}
                    placeholder="Ex: Rondonópolis/MT"
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500/60 placeholder-zinc-700"
                  />
                  {origemLocalidade && (
                    <p className="mt-1 text-[9px] text-zinc-600 flex items-center gap-1">
                      <MapPin size={8} className="shrink-0" /> {origemLocalidade}
                    </p>
                  )}
                  {origemMapsLink && (
                    <a href={origemMapsLink} target="_blank" rel="noopener noreferrer"
                      className="mt-1 flex items-center gap-1 text-[9px] text-blue-400 hover:text-blue-300 transition-colors">
                      <MapPin size={8} className="shrink-0" /> Ver ponto exato no Maps
                    </a>
                  )}
                  {origemInput.trim() && !origemGeoOk && (
                    <p className="mt-1 text-[9px] text-amber-500 flex items-center gap-1">
                      <AlertCircle size={8} className="shrink-0" /> Ajuste para "Cidade/UF" antes de calcular
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Destino</label>
                  <input type="text" value={destinoInput} onChange={e => setDestinoInput(e.target.value)}
                    placeholder="Ex: Santos/SP"
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500/60 placeholder-zinc-700"
                  />
                  {destinoLocalidade && (
                    <p className="mt-1 text-[9px] text-zinc-600 flex items-center gap-1">
                      <MapPin size={8} className="shrink-0" /> {destinoLocalidade}
                    </p>
                  )}
                  {destinoMapsLink && (
                    <a href={destinoMapsLink} target="_blank" rel="noopener noreferrer"
                      className="mt-1 flex items-center gap-1 text-[9px] text-blue-400 hover:text-blue-300 transition-colors">
                      <MapPin size={8} className="shrink-0" /> Ver ponto exato no Maps
                    </a>
                  )}
                  {destinoInput.trim() && !destinoGeoOk && (
                    <p className="mt-1 text-[9px] text-amber-500 flex items-center gap-1">
                      <AlertCircle size={8} className="shrink-0" /> Ajuste para "Cidade/UF" antes de calcular
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Produto</label>
                  <input type="text" value={produto} onChange={e => setProduto(e.target.value)}
                    placeholder="Ex: Soja em Grãos"
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500/60 placeholder-zinc-700"
                  />
                </div>
              </div>
            </section>

            {/* ── SELETORES BINÁRIOS DE FROTA — Regra de Ouro ANTT ──────────── */}
            <section>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold flex items-center gap-1 mb-3">
                <Truck size={9} /> Configuração do Veículo
              </p>
              <div className="grid grid-cols-2 gap-3">
                {([9, 7] as const).map(e => {
                  const ativo = eixos === e
                  return (
                    <button key={e} onClick={() => setEixos(e)}
                      className={`flex flex-col items-center justify-center gap-1.5 py-5 rounded-xl border-2 transition-all ${
                        ativo
                          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-lg shadow-emerald-950/40'
                          : 'bg-zinc-800/40 border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400'
                      }`}
                    >
                      <Truck size={22} className={ativo ? 'text-emerald-400' : 'text-zinc-600'} />
                      <span className="text-sm font-bold leading-none">{e} Eixos</span>
                      <span className={`text-xs font-semibold ${ativo ? 'text-emerald-500' : 'text-zinc-600'}`}>
                        {CAPACIDADE_FIXA[e]}t
                      </span>
                      {ativo && (
                        <span className="text-[9px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold tracking-wide mt-0.5">
                          ATIVO
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {volumeInfo && (
                <p className="mt-2.5 text-[10px] text-zinc-600 flex items-center gap-1.5 bg-zinc-800/40 rounded-lg px-2.5 py-1.5">
                  <MapPin size={9} className="text-zinc-700 shrink-0" />
                  Vol. cotação: <span className="text-zinc-500 font-medium">{volumeInfo}</span>
                  <span className="text-zinc-700 ml-auto">apenas informativo</span>
                </p>
              )}
            </section>

            {/* Categoria + Preço */}
            <section className="flex flex-col gap-2">
              <div>
                <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Categoria ANTT</label>
                <select value={tipoCarga} onChange={e => setTipoCarga(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-blue-500/60 appearance-none cursor-pointer"
                >
                  {TIPO_CARGA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Preço Proposto (R$/t)</label>
                <input type="number" value={precoTon} onChange={e => setPrecoTon(e.target.value)}
                  placeholder="0,00" min="0" step="0.01"
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-violet-500/60 placeholder-zinc-700 tabular-nums"
                />
              </div>
            </section>

            {/* Botão Calcular */}
            <button onClick={calcular} disabled={calcando || !podeCalcular}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              {calcando
                ? <><Loader2 size={14} className="animate-spin" /> Consultando QualP V4...</>
                : <><Zap size={14} /> Calcular Rota</>
              }
            </button>

            {erro && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/25 rounded-lg p-3">
                <AlertCircle size={12} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-[11px] text-red-400 leading-relaxed">{erro}</p>
              </div>
            )}

            {/* ── SAÍDAS DO CÁLCULO ────────────────────────────────────────── */}
            {r && !calcando && (
              <>
                {/* KPI trio */}
                <section className="flex flex-col gap-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold flex items-center gap-1">
                    <Route size={9} /> Saídas
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-zinc-950 border border-zinc-700/60 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-zinc-600 uppercase font-semibold mb-1">KM Real</p>
                      <p className="text-base font-bold text-blue-300 tabular-nums font-mono leading-none">
                        {r.rota.distancia_km?.toLocaleString('pt-BR') ?? '—'}
                      </p>
                      <p className="text-[9px] text-zinc-700 mt-0.5">km</p>
                    </div>
                    <div className="bg-zinc-950 border border-amber-500/20 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-zinc-600 uppercase font-semibold mb-1">Ped./ton</p>
                      <p className="text-base font-bold text-amber-400 tabular-nums font-mono leading-none">
                        {pedTon != null ? `R$ ${num(pedTon)}` : '—'}
                      </p>
                      <p className="text-[9px] text-zinc-700 mt-0.5">÷ {CAPACIDADE_FIXA[eixos]}t</p>
                    </div>
                    <div className="bg-blue-950/60 border border-blue-500/25 rounded-lg p-2.5 text-center">
                      <p className="text-[9px] text-blue-400/70 uppercase font-semibold mb-1">ANTT/ton</p>
                      <p className="text-base font-bold text-blue-400 tabular-nums font-mono leading-none">
                        {pisoTon != null ? `R$ ${num(pisoTon)}` : '—'}
                      </p>
                      <p className="text-[9px] text-zinc-700 mt-0.5">piso</p>
                    </div>
                  </div>

                  {/* CCD + CCF */}
                  <div className="bg-blue-950/40 border border-blue-500/15 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[10px] text-blue-400/70 uppercase font-semibold flex items-center gap-1">
                        <Scale size={9} /> Piso ANTT — 1 Viagem
                      </p>
                      <span className="text-[9px] text-zinc-600">{r.antt.resolucao}</span>
                    </div>
                    <p className="text-xl font-bold text-blue-300 tabular-nums font-mono">{brl(r.antt.frete_minimo_total)}</p>
                    <div className="flex gap-3 mt-1.5">
                      <p className="text-[10px] text-zinc-700">CCD: <span className="text-zinc-500">{r.antt.ccd}</span></p>
                      <p className="text-[10px] text-zinc-700">CCF: <span className="text-zinc-500">{brl(r.antt.ccf)}</span></p>
                    </div>
                    <p className="text-[9px] text-zinc-700 mt-0.5">{ANTT_COEF[eixos].label} · {r.antt.tipo_carga_label}</p>
                  </div>

                  {/* Pedágio total */}
                  <div className="bg-zinc-950 border border-amber-500/15 rounded-lg p-3">
                    <p className="text-[10px] text-amber-400/70 uppercase font-semibold mb-1">Pedágio Total da Viagem</p>
                    <p className="text-xl font-bold text-amber-400 tabular-nums font-mono">{brl(r.pedagio.valor_total)}</p>
                    <p className="text-[9px] text-zinc-700 mt-0.5">
                      {r.rota.pedagio_pontos?.length ?? 0} praças · fonte: {r.rota.fonte}
                    </p>
                  </div>

                  {/* Comparativo de margem */}
                  {preco > 0 && pisoTon != null && (
                    <div className={`rounded-lg p-3 border ${(margemPct ?? 0) >= 5 ? 'bg-emerald-950/60 border-emerald-500/30' : 'bg-red-950/60 border-red-500/30'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-[10px] uppercase font-semibold flex items-center gap-1">
                          {(margemPct ?? 0) >= 5
                            ? <><ChevronUp size={11} className="text-emerald-400" /><span className="text-emerald-400/70">Margem Operacional</span></>
                            : <><ChevronDown size={11} className="text-red-400" /><span className="text-red-400/70">Abaixo do Piso</span></>
                          }
                        </p>
                        <span className={`text-sm font-bold tabular-nums font-mono ${(margemPct ?? 0) >= 15 ? 'text-emerald-400' : (margemPct ?? 0) >= 5 ? 'text-amber-400' : 'text-red-400'}`}>
                          {margemPct != null ? `${margemPct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                      <div className="flex items-end justify-between text-[10px]">
                        <div>
                          <p className="text-zinc-600">Proposto</p>
                          <p className="text-white font-mono font-bold">R$ {num(preco)}/t</p>
                        </div>
                        {r.contrato.diferenca_por_ton != null && (
                          <div className="text-right">
                            <p className="text-zinc-600">vs ANTT</p>
                            <p className={`font-mono font-bold ${r.contrato.diferenca_por_ton >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {r.contrato.diferenca_por_ton >= 0 ? '+' : ''}R$ {num(r.contrato.diferenca_por_ton)}/t
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </section>

                {/* ── AÇÕES RÁPIDAS ─────────────────────────────────────────── */}
                <section className="flex flex-col gap-2 pb-4">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold">Ações Rápidas</p>

                  {/* Salvar Preço → COTACAO_FILIAL / APROV_DIRETORIA */}
                  {precoTon && parseFloat(precoTon) > 0 && (
                    <button onClick={salvarPreco} disabled={salvandoPreco}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-xs font-bold transition-colors">
                      {salvandoPreco
                        ? <><Loader2 size={12} className="animate-spin" /> Salvando...</>
                        : <><Scale size={12} /> Salvar Preço Proposto</>
                      }
                    </button>
                  )}

                  {/* Copiar WhatsApp → RESPONDIDA */}
                  <button onClick={copiarWhatsApp}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors">
                    <Copy size={12} /> Copiar Texto WhatsApp
                  </button>
                  <button onClick={enviarAprovacao}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-colors">
                    <Send size={12} /> Enviar para Aprovação da Diretoria
                  </button>
                  <button onClick={copiarLink}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-xs font-semibold transition-colors">
                    <Link2 size={12} /> Copiar Link da Filial
                  </button>
                </section>

                {/* ── RAG INTELIGÊNCIA DE MERCADO ───────────────────────── */}
                {(ragLoading || (ragData && ragData.total > 0)) && (
                  <section className="flex flex-col gap-2 pb-4">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-semibold flex items-center gap-1.5">
                      <Brain size={10} className="text-violet-400" /> Inteligência de Mercado
                    </p>

                    {ragLoading && (
                      <div className="flex items-center gap-2 py-3 px-3 rounded-xl bg-zinc-800/50">
                        <Loader2 size={12} className="animate-spin text-violet-400 shrink-0" />
                        <span className="text-[11px] text-zinc-500">Buscando histórico similar...</span>
                      </div>
                    )}

                    {!ragLoading && ragData && ragData.total > 0 && (() => {
                      const top = ragData.resultados[0]
                      const media = ragData.resultados.reduce((s, r) => s + r.valor_tonelada, 0) / ragData.total
                      const diasAtras = Math.round((Date.now() - new Date(top.data_fechamento).getTime()) / 86400000)
                      const muitoSimilar = top.similaridade >= 0.85

                      return (
                        <>
                          {/* Média de mercado */}
                          <div className="rounded-xl bg-zinc-800/60 border border-zinc-700/40 p-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <TrendingUp size={12} className="text-emerald-400 shrink-0" />
                              <span className="text-[11px] text-zinc-400">Média 30 dias</span>
                            </div>
                            <span className="text-sm font-mono font-bold text-emerald-400">
                              R$ {num(media)}/t
                            </span>
                          </div>

                          {/* Alerta de rota cotada recentemente */}
                          {muitoSimilar && (
                            <div className="rounded-xl bg-violet-950/50 border border-violet-700/40 p-3 flex items-start gap-2">
                              <Clock size={12} className="text-violet-400 mt-0.5 shrink-0" />
                              <p className="text-[11px] text-violet-300 leading-relaxed">
                                Você cotou esta rota há <span className="font-bold text-white">{diasAtras} dia{diasAtras !== 1 ? 's' : ''}</span> por{' '}
                                <span className="font-bold text-white">R$ {num(top.valor_tonelada)}/t</span>
                                {top.embarcador ? ` · ${top.embarcador}` : ''}
                              </p>
                            </div>
                          )}

                          {/* Top 3 fechamentos similares */}
                          <div className="flex flex-col gap-1">
                            {ragData.resultados.slice(0, 3).map((r, i) => {
                              const dias = Math.round((Date.now() - new Date(r.data_fechamento).getTime()) / 86400000)
                              return (
                                <div key={r.id} className="rounded-lg bg-zinc-800/40 px-3 py-2 flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="text-[10px] text-zinc-500 truncate">
                                      {i + 1}. {r.origem} → {r.destino}
                                    </p>
                                    <p className="text-[10px] text-zinc-600 truncate">
                                      {r.produto}{r.tipo_veiculo ? ` · ${r.tipo_veiculo}` : ''} · {dias}d atrás
                                    </p>
                                  </div>
                                  <span className="text-[11px] font-mono font-bold text-zinc-300 shrink-0">
                                    R$ {num(r.valor_tonelada)}/t
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )
                    })()}
                  </section>
                )}
              </>
            )}

            {/* Empty state */}
            {!r && !calcando && !erro && (
              <div className="flex-1 flex flex-col items-center justify-center py-10 text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-zinc-800/60 flex items-center justify-center">
                  <Calculator size={24} className="text-zinc-700" />
                </div>
                <div>
                  <p className="text-xs text-zinc-600 font-medium">Workspace Isolado</p>
                  <p className="text-[11px] text-zinc-700 mt-1 leading-relaxed">
                    {podeCalcular
                      ? 'Selecione o veículo e clique\nem Calcular Rota.'
                      : 'Preencha Origem e Destino\npara calcular.'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* ═══ DIREITA 75% — Mapa Leaflet h-screen ═══════════════════════════ */}
        <main className="flex-1 min-w-0 relative bg-zinc-950">
          {originCoords && destCoords ? (
            <MapaRota
              originCoords={originCoords}
              destCoords={destCoords}
              routeCoords={polyline}
              tollMarkers={resultado?.rota.pedagio_pontos}
              containerClass="w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-4">
              <div className="w-20 h-20 rounded-3xl bg-zinc-800/40 flex items-center justify-center">
                <Map size={36} className="text-zinc-700" />
              </div>
              <div className="text-center">
                <p className="text-sm text-zinc-600 font-medium">Mapa de Rota · QualP V4</p>
                <p className="text-xs text-zinc-700 mt-1.5 leading-relaxed">
                  {calcando
                    ? 'Calculando rota e gerando geometria...'
                    : 'Calcule a rota para renderizar\na linha geométrica do trecho.'
                  }
                </p>
              </div>
              {calcando && <Loader2 size={20} className="text-emerald-500 animate-spin" />}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
