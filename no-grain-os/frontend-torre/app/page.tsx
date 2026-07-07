'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package, MessageSquare, Mail, BarChart3, RefreshCw, AlertTriangle,
  Activity, MapPin, Wheat, ExternalLink, Filter, X,
  CheckCircle2, Clock, Inbox, RotateCcw, Copy, Check,
  Eye, ArrowUpRight, Loader2, Trophy, XCircle, Calculator,
  Radio, Bell, Truck, Send,
} from 'lucide-react'
import type { CargaLogistica, ApiResponse, FonteIngestao, StatusCotacao, CargaOngoGeral } from '@/types/carga'

// ─── Constants ─────────────────────────────────────────────────────────────────

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1a7_30T15iTKIfoI8ny0YVLPDrSieEpPi-UtrOUsVGzY/edit?gid=0#gid=0'

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  RECEBIDA:        { label: 'Recebida',    cls: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' },
  CALCULADA:       { label: 'Calculada',   cls: 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/30' },
  PENDENTE:        { label: 'Pendente',    cls: 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30' },
  COTACAO_FILIAL:  { label: 'Filial',      cls: 'bg-blue-500/15 text-blue-400 border border-blue-500/30' },
  APROV_DIRETORIA: { label: 'Diretoria',   cls: 'bg-violet-500/15 text-violet-400 border border-violet-500/30' },
  RESPONDIDA:        { label: 'Respondida',        cls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' },
  COTADO_AGUARDANDO: { label: 'Aguardando Resp.',  cls: 'bg-amber-500/15 text-amber-400 border border-amber-500/30' },
  GANHA:             { label: '✓ Ganha',           cls: 'bg-emerald-600/25 text-emerald-300 border border-emerald-400/40' },
  PERDIDA:           { label: 'Perdida',           cls: 'bg-red-500/15 text-red-400 border border-red-500/30' },
  Novo:              { label: 'Nova',              cls: 'bg-sky-500/15 text-sky-400 border border-sky-500/30' },
}

const STATUS_OPCOES: StatusCotacao[] = [
  'RECEBIDA', 'CALCULADA', 'PENDENTE', 'COTACAO_FILIAL',
  'APROV_DIRETORIA', 'RESPONDIDA', 'GANHA', 'PERDIDA',
]

// M13 — "já cotado, aguardando resposta do cliente". Convive com o roteamento
// por margem do M6/M7 (COTACAO_FILIAL/APROV_DIRETORIA continuam calculados
// normalmente pelo backend); esses status só saem do radar ativo por padrão.
const STATUS_AGUARDANDO = new Set<StatusCotacao>([
  'COTACAO_FILIAL', 'APROV_DIRETORIA', 'RESPONDIDA', 'COTADO_AGUARDANDO',
])

type FonteConfig = {
  label: string; cardLabel: string; badgeCls: string; iconCls: string
  dotCls: string; glowCls: string; Icon: React.ElementType
}

type TimelineMensagem = {
  id: string; texto: string; classificacao: 'aviso' | 'cotacao'
  criado_em: string; remetente?: string; grupo_nome?: string
}

const FONTE_CONFIG: Record<FonteIngestao, FonteConfig> = {
  ongo_cotacao:   { label: 'Trizy BID',      cardLabel: 'Cotações Trizy',         badgeCls: 'bg-orange-500/15 text-orange-400 border border-orange-500/30',    iconCls: 'text-orange-400', dotCls: 'bg-orange-400', glowCls: 'from-orange-500/20 to-transparent',  Icon: Truck },
  whatsapp_grupo: { label: 'WhatsApp',       cardLabel: 'Radar WhatsApp',         badgeCls: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30', iconCls: 'text-emerald-400', dotCls: 'bg-emerald-400', glowCls: 'from-emerald-500/20 to-transparent', Icon: Radio },
  gmail_cotacao:  { label: 'Gmail',          cardLabel: 'Cotações Email (Gmail)', badgeCls: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',       iconCls: 'text-amber-400',  dotCls: 'bg-amber-400',  glowCls: 'from-amber-500/20 to-transparent',   Icon: Mail },
  ongo_geral:     { label: 'Ongo Geral',     cardLabel: 'Frete Geral Ongo',       badgeCls: 'bg-violet-500/15 text-violet-400 border border-violet-500/30',    iconCls: 'text-violet-400', dotCls: 'bg-violet-400', glowCls: 'from-violet-500/20 to-transparent',  Icon: BarChart3 },
}

const FONTE_ORDER: FonteIngestao[] = ['ongo_cotacao', 'whatsapp_grupo', 'gmail_cotacao', 'ongo_geral']
const PRODUTO_CLS: Record<string, string> = { Soja: 'text-yellow-400', Milho: 'text-amber-300', Farelo: 'text-orange-400' }

const VALORES_LIXO = new Set([
  'não identificado', 'nao identificado',
  'não especificado', 'nao especificado',
  '',
])
function isLixoCotacao(c: CargaLogistica): boolean {
  if (c.fonte_ingestao === 'ongo_cotacao') return false  // Trizy BID: fonte estruturada, nunca é lixo
  const emb  = (c.embarcador ?? '').toLowerCase().trim()
  const prod = (c.produto    ?? '').toLowerCase().trim()
  return VALORES_LIXO.has(emb) && (VALORES_LIXO.has(prod) || !prod)
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatBRL(v: number | null | undefined): string {
  if (v == null || v === 0) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtKg(v: number | null | undefined): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v ?? 0)
}

function trunc(str: string | null | undefined, max: number): string {
  if (!str) return '—'
  return str.length > max ? str.slice(0, max - 1) + '…' : str
}

function produtoKey(produto: string): string {
  const l = produto.toLowerCase()
  if (l.includes('soja'))   return 'Soja'
  if (l.includes('milho'))  return 'Milho'
  if (l.includes('farelo')) return 'Farelo'
  return ''
}

function slaPrazo(criadoEm?: string): { label: string; cls: string } {
  if (!criadoEm) return { label: '—', cls: 'text-zinc-600' }
  const horasPassadas = (Date.now() - new Date(criadoEm).getTime()) / 3_600_000
  const restam = 24 - horasPassadas
  if (restam <= 0) return { label: 'Expirado', cls: 'text-red-400 font-semibold' }
  if (restam < 1)  return { label: `${Math.round(restam * 60)}min`, cls: 'text-red-400 font-semibold' }
  if (restam < 4)  return { label: `${restam.toFixed(0)}h restam`, cls: 'text-amber-400' }
  return { label: `${restam.toFixed(0)}h restam`, cls: 'text-emerald-400' }
}

function clipCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;left:-9999px;top:-9999px'
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

// ─── CountdownSLA ──────────────────────────────────────────────────────────────

function parseDeadline(str: string): Date | null {
  let d = new Date(str)
  if (!isNaN(d.getTime())) return d
  // "DD/MM/YYYY HH:MM:SS" ou "DD/MM/YYYY"
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[\sT](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) {
    d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`)
    return isNaN(d.getTime()) ? null : d
  }
  return null
}

function CountdownSLA({ deadline, criado_em }: { deadline?: string; criado_em?: string }) {
  const [ms, setMs] = useState<number | null>(null)

  useEffect(() => {
    const target = deadline ? parseDeadline(deadline) : null
    if (!target) { setMs(null); return }
    const tick = () => setMs(target.getTime() - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [deadline])

  // Sem prazo_limite_resposta → fallback para slaPrazo(criado_em)
  if (ms === null) {
    const sla = slaPrazo(criado_em)
    return <span className={`text-[11px] font-semibold ${sla.cls}`}>{sla.label}</span>
  }

  if (ms <= 0) {
    return <span className="text-red-400 font-bold text-[11px] animate-pulse tabular-nums font-mono">Expirado</span>
  }

  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  const label = `${pad(h)}:${pad(m)}:${pad(s)}`

  if (ms < 15 * 60 * 1000) {
    return <span className="text-red-400 font-bold text-[11px] animate-pulse tabular-nums font-mono">{label}</span>
  }
  if (ms < 2 * 60 * 60 * 1000) {
    return <span className="text-amber-400 font-semibold text-[11px] tabular-nums font-mono">{label}</span>
  }
  return <span className="text-emerald-400 text-[11px] tabular-nums font-mono">{label}</span>
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ visible, msg }: { visible: boolean; msg: string }) {
  return (
    <div className={`fixed bottom-6 right-6 z-[9999] flex items-center gap-2 bg-emerald-700 text-white text-sm font-semibold px-4 py-3 rounded-xl shadow-2xl transition-all duration-300 ${
      visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
    }`}>
      <Check size={15} />{msg}
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function FreteBadge({ fonte }: { fonte: FonteIngestao }) {
  const cfg = FONTE_CONFIG[fonte] ?? FONTE_CONFIG['ongo_geral']
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.badgeCls}`}>
      <cfg.Icon size={9} />{cfg.label}
    </span>
  )
}

function StatusBadge({ status }: { status?: StatusCotacao }) {
  if (!status) return <span className="text-zinc-600 text-[11px]">—</span>
  const cfg = STATUS_CONFIG[status]
  if (!cfg) return <span className="text-zinc-500 text-[11px]">{status}</span>
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

function StatusDropdown({
  id, status, onUpdate, loading,
}: {
  id: string; status?: StatusCotacao; onUpdate: (id: string, s: StatusCotacao) => void; loading: boolean
}) {
  const cfg = STATUS_CONFIG[status ?? ''] ?? STATUS_CONFIG['RECEBIDA']
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={status ?? 'RECEBIDA'}
        disabled={loading}
        onChange={e => onUpdate(id, e.target.value as StatusCotacao)}
        className={`text-[11px] font-medium rounded-full px-2 py-0.5 border cursor-pointer appearance-none bg-transparent focus:outline-none disabled:opacity-50 ${cfg.cls}`}
      >
        {STATUS_OPCOES.map(s => (
          <option key={s} value={s} className="bg-zinc-900 text-zinc-200">
            {STATUS_CONFIG[s]?.label ?? s}
          </option>
        ))}
      </select>
      {loading && <Loader2 size={10} className="text-zinc-500 animate-spin shrink-0" />}
    </div>
  )
}

function FonteCard({ fonte, count, lastUpdate, onClick, active, legenda }: {
  fonte: FonteIngestao; count: number; lastUpdate: string | null; onClick?: () => void; active?: boolean; legenda?: string
}) {
  const cfg          = FONTE_CONFIG[fonte]
  const isOngo       = fonte === 'ongo_geral'
  const isWhatsApp   = fonte === 'whatsapp_grupo'
  const isTrizy      = fonte === 'ongo_cotacao'
  const isClickable  = isOngo || isWhatsApp || isTrizy || !!onClick
  const inner = (
    <div className={`relative overflow-hidden bg-zinc-900 border rounded-xl p-4 flex flex-col gap-3 transition-colors ${
      isOngo      ? 'border-violet-500/30 hover:border-violet-500/55 cursor-pointer' :
      isWhatsApp  ? 'border-emerald-500/30 hover:border-emerald-500/55 cursor-pointer' :
      isTrizy     ? (active ? 'border-orange-500/70 ring-1 ring-orange-500/40 cursor-pointer' : 'border-orange-500/30 hover:border-orange-500/55 cursor-pointer') :
      isClickable ? 'border-zinc-800 hover:border-zinc-700 cursor-pointer' :
                    'border-zinc-800'
    }`}>
      <div className={`absolute inset-0 bg-gradient-to-br ${cfg.glowCls} pointer-events-none`} />
      <div className="relative flex items-center justify-between">
        <div className={`p-2 rounded-lg bg-zinc-800 ${cfg.iconCls} flex items-center justify-center`}>
          {isTrizy ? <img src="/trizy-logo.png" alt="Trizy" className="h-4 w-auto" /> : <cfg.Icon size={16} />}
        </div>
        <div className="flex items-center gap-2">
          {isOngo     && <Eye size={11} className="text-violet-400/60" />}
          {isWhatsApp && <Bell size={11} className="text-emerald-400/60" />}
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotCls} animate-pulse`} />
            <span className="text-[11px] text-zinc-500 font-medium">Ativo</span>
          </div>
        </div>
      </div>
      <div className="relative">
        <p className="text-[11px] text-zinc-500 mb-0.5 font-medium uppercase tracking-wide">{cfg.cardLabel}</p>
        <p className="text-3xl font-bold text-white tabular-nums">{count}</p>
        <p className="text-[11px] text-zinc-600 mt-0.5">
          {legenda ?? (isWhatsApp ? 'clique para ver avisos de mercado' : 'registros capturados')}
        </p>
      </div>
      <div className="relative border-t border-zinc-800 pt-2.5">
        <p className="text-[10px] text-zinc-600">{lastUpdate ? `Atualizado às ${formatTime(lastUpdate)}` : 'Aguardando polling...'}</p>
      </div>
    </div>
  )
  if (isClickable) return <button type="button" onClick={onClick} className="block text-left w-full">{inner}</button>
  return inner
}

// ─── Drawer de Auditoria ────────────────────────────────────────────────────────

function CotacaoDrawer({
  item,
  onClose,
  onFechar,
  updatingId,
  showToast,
  onUpdateStatus,
}: {
  item: CargaLogistica | null
  onClose: () => void
  onFechar: (id: string, status: 'GANHA' | 'PERDIDA') => Promise<void>
  updatingId: string | null
  showToast: (msg: string) => void
  onUpdateStatus: (id: string, s: StatusCotacao) => void
}) {
  const router = useRouter()
  const [precoFinal,  setPrecoFinal]  = useState('')
  const [copied,      setCopied]      = useState(false)
  const [modoEdicao,  setModoEdicao]  = useState(false)
  const [salvandoDados, setSalvandoDados] = useState(false)
  const [salvandoPrecoFinal, setSalvandoPrecoFinal] = useState(false)
  const [editCampos,  setEditCampos]  = useState({
    origem: '', destino: '', produto: '', embarcador: '', observacoes: '',
  })

  useEffect(() => {
    if (item) {
      setPrecoFinal(item.valor_tonelada > 0 ? String(item.valor_tonelada) : '')
      setModoEdicao(false)
      setEditCampos({
        origem:      item.origem      ?? '',
        destino:     item.destino     ?? '',
        produto:     item.produto     ?? '',
        embarcador:  item.embarcador  ?? '',
        observacoes: item.observacoes ?? '',
      })
    }
  }, [item?.id])

  async function salvarEdicao() {
    if (!item) return
    setSalvandoDados(true)
    try {
      const res = await fetch(`/api/cotacoes/${item.id}/dados`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editCampos),
      })
      if (res.ok) { showToast('Dados atualizados!'); setModoEdicao(false) }
      else showToast('Erro ao salvar.')
    } catch { showToast('Erro de rede.') }
    finally { setSalvandoDados(false) }
  }

  async function salvarPrecoFinal(): Promise<boolean> {
    if (!item) return false
    const preco = parseFloat(precoFinal)
    if (!preco || preco <= 0) { showToast('Informe um preço válido.'); return false }
    setSalvandoPrecoFinal(true)
    try {
      const res = await fetch(`/api/cotacoes/${item.id}/preco`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preco_proposto:    preco,
          antt_piso_por_ton: item.antt_piso_por_ton ?? 0,
        }),
      })
      if (!res.ok) { showToast('Erro ao salvar preço.'); return false }
      const data = await res.json()
      showToast('Preço comercial final salvo!')
      if (data.status) onUpdateStatus(item.id, data.status)
      return true
    } catch {
      showToast('Erro de rede ao salvar preço.')
      return false
    } finally {
      setSalvandoPrecoFinal(false)
    }
  }

  function buildDadosBrutos(c: CargaLogistica): string {
    const linhas = [
      c.id,
      `CLIENTE: ${c.cliente && c.cliente !== 'Não Identificado' ? c.cliente : (c.embarcador ?? '—')}`,
      `EMBARCADOR: ${c.embarcador ?? '—'}`,
      `CONTATO: ${c.contato ?? '—'}`,
      `ORIGEM: ${c.origem}`,
      `PONTO COLETA: ${c.origem_localidade || '—'}`,
      `MAPS ORIGEM: ${c.origem_maps_link || '—'}`,
      `DESTINO: ${c.destino}`,
      `PONTO ENTREGA: ${c.destino_localidade || '—'}`,
      `MAPS DESTINO: ${c.destino_maps_link || '—'}`,
      `PRODUTO: ${c.produto}`,
      `VEICULO: ${c.tipo_veiculo}`,
      `VALOR COTADO: R$ ${c.valor_tonelada.toFixed(2)}/t`,
      `VOLUME TOTAL: ${c.volume_total || '—'}`,
      `CADENCIA: ${c.cadencia_diaria && c.cadencia_diaria !== 'Não Especificado' ? c.cadencia_diaria : '—'}`,
      `PRAZO: ${c.sem_prazo === false ? (c.prazo_limite_resposta ?? '—') : 'Responder com Rapidez'}`,
      `--- CALCULO ---`,
      `KM REAL: ${c.distancia_km ? `${Number(c.distancia_km).toLocaleString('pt-BR')} km` : '—'}`,
      `PEDAGIO TOTAL: ${c.pedagio_total_calc ? `R$ ${Number(c.pedagio_total_calc).toFixed(2)}` : '—'}`,
      `PISO ANTT/TON: ${c.antt_piso_por_ton ? `R$ ${Number(c.antt_piso_por_ton).toFixed(2)}/t` : '—'}`,
      `PRECO PROPOSTO: ${c.preco_proposto ? `R$ ${Number(c.preco_proposto).toFixed(2)}/t` : '—'}`,
      `FISCAL: ${c.fiscal?.tag ?? '—'} — ${c.fiscal?.descricao ?? ''}`,
      `--- AUDITORIA ---`,
      `FONTE: ${c.fonte_ingestao}`,
      `ID ONGO: ${c.id_ongo || '—'}`,
      `STATUS: ${c.status ?? 'PENDENTE'}`,
      `RECEBIDA EM: ${c.criado_em ? new Date(c.criado_em).toLocaleString('pt-BR') : '—'}`,
    ]
    if (precoFinal) linhas.push(`PRECO COMERCIAL FINAL: R$ ${precoFinal}/t`)
    return linhas.join('\n')
  }

  function copiarDadosBrutos() {
    if (!item) return
    const ok = clipCopy(buildDadosBrutos(item))
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      showToast('Dados brutos copiados!')
    }
  }

  async function handleFechar(status: 'GANHA' | 'PERDIDA') {
    if (!item) return
    if (precoFinal.trim()) {
      const ok = await salvarPrecoFinal()
      if (!ok) return
    }
    await onFechar(item.id, status)
    onClose()
  }

  const isUpdating = updatingId === item?.id

  // campos removido — substituído por layout dois painéis (M6)

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-zinc-950/70 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          item ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Gaveta */}
      <aside className={`fixed right-0 top-0 h-full w-[720px] bg-zinc-900 border-l border-zinc-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${
        item ? 'translate-x-0' : 'translate-x-full'
      }`}>
        {item && (
          <>
            {/* Cabeçalho */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <FreteBadge fonte={item.fonte_ingestao} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{item.embarcador ?? '—'}</p>
                  <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                    <MapPin size={9} className="shrink-0" />
                    {trunc(item.origem, 18)} → {trunc(item.destino, 18)}
                  </p>
                </div>
              </div>
              <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1.5 rounded-lg hover:bg-zinc-800 shrink-0 ml-3">
                <X size={16} />
              </button>
            </div>

            {/* Ações rápidas */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-zinc-800 shrink-0 flex-wrap">
              <button
                onClick={() => router.push(`/torre/calcular/${item.id}`)}
                className="flex items-center gap-1.5 text-[11px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition-colors"
              >
                <ArrowUpRight size={12} /> Workspace
              </button>
              <button
                onClick={copiarDadosBrutos}
                className="flex items-center gap-1.5 text-[11px] font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700"
              >
                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copied ? 'Copiado!' : 'Copiar Dados Brutos'}
              </button>
              <button
                onClick={() => setModoEdicao(m => !m)}
                className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors border ${
                  modoEdicao
                    ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <RotateCcw size={11} /> {modoEdicao ? 'Cancelar' : 'Alterar Dados'}
              </button>
              <span className="ml-auto">
                <StatusDropdown
                  id={item.id}
                  status={item.status}
                  onUpdate={onUpdateStatus}
                  loading={updatingId === item.id}
                />
              </span>
            </div>

            {/* Payload / Modo edição */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {modoEdicao ? (
                <>
                  <p className="text-[10px] text-amber-400/80 uppercase tracking-wide font-semibold mb-3 flex items-center gap-1.5">
                    <RotateCcw size={10} /> Alterar Dados Raspados
                  </p>
                  <div className="flex flex-col gap-2">
                    {([
                      { key: 'origem',      label: 'Origem' },
                      { key: 'destino',     label: 'Destino' },
                      { key: 'produto',     label: 'Produto' },
                      { key: 'embarcador',  label: 'Embarcador' },
                      { key: 'observacoes', label: 'Observações', multiline: true },
                    ] as { key: keyof typeof editCampos; label: string; multiline?: boolean }[]).map(({ key, label, multiline }) => (
                      <div key={key}>
                        <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">{label}</label>
                        {multiline ? (
                          <textarea
                            rows={3}
                            value={editCampos[key]}
                            onChange={e => setEditCampos(p => ({ ...p, [key]: e.target.value }))}
                            className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500/60 resize-none"
                          />
                        ) : (
                          <input
                            type="text"
                            value={editCampos[key]}
                            onChange={e => setEditCampos(p => ({ ...p, [key]: e.target.value }))}
                            className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-amber-500/60"
                          />
                        )}
                      </div>
                    ))}
                    <button
                      onClick={salvarEdicao}
                      disabled={salvandoDados}
                      className="mt-2 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                    >
                      {salvandoDados ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      {salvandoDados ? 'Salvando...' : 'Confirmar Alterações'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-4">

                  {/* ── Dois painéis lado a lado ─────────────────────────────── */}
                  <div className="flex gap-3 items-start">

                    {/* PAINEL ESQUERDO — Dados Fiéis do Scraper */}
                    <div className="flex-1 flex flex-col">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-wide font-semibold mb-2 flex items-center gap-1">
                        <Package size={9} /> Dados Fiéis do Scraper
                      </p>
                      {([
                        { label: 'Cliente',          value: item.cliente && item.cliente !== 'Não Identificado' ? item.cliente : '—' },
                        { label: 'Embarcador',       value: item.embarcador ?? '—' },
                        { label: 'Portal Origem',    value: item.portal_origem ?? item.fonte_ingestao },
                        { label: 'Contato',          value: item.contato ?? '—' },
                        { label: 'Origem',           value: item.origem },
                        { label: 'Ponto Coleta',     value: item.origem_localidade || '—' },
                        { label: 'Destino',          value: item.destino },
                        { label: 'Ponto Entrega',    value: item.destino_localidade || '—' },
                        { label: 'Produto',          value: item.produto },
                        { label: 'Veículo',          value: item.tipo_veiculo },
                        { label: 'Volume',           value: item.volume_total || '—' },
                        { label: 'Cadência',         value: item.cadencia_diaria && item.cadencia_diaria !== 'Não Especificado' ? item.cadencia_diaria : '—' },
                        { label: 'Prazo',            value: item.sem_prazo === false ? (item.prazo_limite_resposta ?? '—') : 'Responder com Rapidez' },
                      ] as { label: string; value: string }[]).map(({ label, value }) => (
                        <div key={label} className="flex items-start gap-2 py-1.5 border-b border-zinc-800/50 last:border-0">
                          <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5 leading-tight">{label}</span>
                          <span className="text-[11px] text-zinc-300 break-words leading-snug">{value}</span>
                        </div>
                      ))}
                      {/* SLA */}
                      <div className="flex items-start gap-2 py-1.5 border-b border-zinc-800/50">
                        <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5 leading-tight">SLA</span>
                        <span className={`text-[11px] font-semibold ${slaPrazo(item.criado_em).cls}`}>{slaPrazo(item.criado_em).label}</span>
                      </div>
                      {item.id_ongo && (
                        <p className="text-[9px] text-zinc-700 font-mono mt-1.5">ID Ongo: {item.id_ongo}</p>
                      )}

                      {/* Localização — Gmail/WhatsApp (Trizy tem sua própria seção completa abaixo) */}
                      {item.fonte_ingestao !== 'ongo_cotacao' && (() => {
                        const origemLink = item.origem_maps_link
                          || (item.coords_coleta_lat != null && item.coords_coleta_lng != null
                                ? `https://www.google.com/maps?q=${item.coords_coleta_lat},${item.coords_coleta_lng}` : null)
                        const destinoLink = item.destino_maps_link
                          || (item.coords_entrega_lat != null && item.coords_entrega_lng != null
                                ? `https://www.google.com/maps?q=${item.coords_entrega_lat},${item.coords_entrega_lng}` : null)
                        return (
                          <div className="mt-3 border-t border-zinc-800 pt-2.5">
                            <p className="text-[9px] text-zinc-700 uppercase tracking-wide font-semibold mb-1.5 flex items-center gap-1">
                              <MapPin size={9} /> Localização
                            </p>
                            <div className="flex flex-col gap-1.5">
                              {origemLink ? (
                                <a href={origemLink} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/25 px-2 py-1 rounded-md transition-colors w-fit">
                                  <MapPin size={9} /> Maps Origem
                                </a>
                              ) : (
                                <p className="text-[10px] text-zinc-600 flex items-center gap-1">
                                  <AlertTriangle size={9} className="text-amber-500/70 shrink-0" /> Localização de origem não confirmada
                                </p>
                              )}
                              {destinoLink ? (
                                <a href={destinoLink} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/25 px-2 py-1 rounded-md transition-colors w-fit">
                                  <MapPin size={9} /> Maps Destino
                                </a>
                              ) : (
                                <p className="text-[10px] text-zinc-600 flex items-center gap-1">
                                  <AlertTriangle size={9} className="text-amber-500/70 shrink-0" /> Localização de destino não confirmada
                                </p>
                              )}
                            </div>
                          </div>
                        )
                      })()}

                      {item.fonte_ingestao === 'ongo_cotacao' && (
                        <div className="mt-3 border-t border-zinc-800 pt-2.5">
                          <p className="text-[9px] text-orange-400/70 uppercase tracking-wide font-semibold mb-1.5 flex items-center gap-1">
                            <Truck size={9} /> Dados Trizy BID — Completo
                          </p>

                          {/* Identificação */}
                          {([
                            { label: 'BID Nº',           value: item.id_externo ? `#${item.id_externo}` : '—' },
                            { label: 'Status Trizy',     value: item.status_trizy || '—' },
                            { label: 'Preço Ref.',       value: item.preco_referencia_trizy && item.preco_referencia_trizy > 0 ? `R$ ${Number(item.preco_referencia_trizy).toFixed(2)}/t` : 'Sem oferta' },
                            { label: 'Cond. Pagamento',  value: item.condicao_pagamento || '—' },
                            { label: 'ICMS',             value: item.icms ? `${item.icms}%` : '—' },
                          ] as { label: string; value: string }[]).map(({ label, value }) => (
                            <div key={label} className="flex items-start gap-2 py-1 border-b border-zinc-800/40 last:border-0">
                              <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5">{label}</span>
                              <span className="text-[11px] text-zinc-300">{value}</span>
                            </div>
                          ))}

                          {/* Pedágio */}
                          <div className="mt-1.5 mb-1 text-[9px] text-zinc-700 uppercase tracking-wide font-semibold">Pedágio</div>
                          {([
                            { label: 'Tem Pedágio',     value: item.possui_pedagio || '—' },
                            { label: 'Incluso no Frete',value: item.pedagio_incluso || '—' },
                            { label: 'R$/Eixo',         value: item.pedagio_valor_eixo != null ? `R$ ${Number(item.pedagio_valor_eixo).toFixed(2)}` : '—' },
                          ] as { label: string; value: string }[]).map(({ label, value }) => (
                            <div key={label} className="flex items-start gap-2 py-1 border-b border-zinc-800/40 last:border-0">
                              <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5">{label}</span>
                              <span className="text-[11px] text-zinc-300">{value}</span>
                            </div>
                          ))}

                          {/* Localização completa */}
                          <div className="mt-1.5 mb-1 text-[9px] text-zinc-700 uppercase tracking-wide font-semibold">Localização (Trizy)</div>
                          {([
                            { label: 'Local Coleta',    value: item.local_coleta_full || item.origem_localidade || '—' },
                            { label: 'Entidade Orig.',  value: item.entidade_origem_trizy || '—' },
                            { label: 'Local Descarga',  value: item.local_entrega_full || item.destino_localidade || '—' },
                            { label: 'Entidade Dest.',  value: item.entidade_destino_trizy || '—' },
                          ] as { label: string; value: string }[]).map(({ label, value }) => (
                            <div key={label} className="flex items-start gap-2 py-1 border-b border-zinc-800/40 last:border-0">
                              <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5">{label}</span>
                              <span className="text-[11px] text-zinc-400 break-words leading-snug">{value}</span>
                            </div>
                          ))}

                          {/* Links Google Maps — mesma lógica das outras fontes: link se existir, aviso se não */}
                          <div className="mt-2 flex flex-col gap-1.5">
                            {item.origem_maps_link ? (
                              <a href={item.origem_maps_link} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/25 px-2 py-1 rounded-md transition-colors w-fit">
                                <MapPin size={9} /> Maps Coleta
                              </a>
                            ) : (
                              <p className="text-[10px] text-zinc-600 flex items-center gap-1">
                                <AlertTriangle size={9} className="text-amber-500/70 shrink-0" /> Localização de coleta não confirmada
                              </p>
                            )}
                            {item.destino_maps_link ? (
                              <a href={item.destino_maps_link} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 bg-blue-500/10 border border-blue-500/25 px-2 py-1 rounded-md transition-colors w-fit">
                                <MapPin size={9} /> Maps Descarga
                              </a>
                            ) : (
                              <p className="text-[10px] text-zinc-600 flex items-center gap-1">
                                <AlertTriangle size={9} className="text-amber-500/70 shrink-0" /> Localização de descarga não confirmada
                              </p>
                            )}
                          </div>

                          {/* Observações */}
                          {(item.observacao_origem || item.observacao_destino || item.observacao_geral_trizy) && (
                            <div className="mt-1.5 flex flex-col gap-1">
                              {item.observacao_geral_trizy && (
                                <div className="flex items-start gap-2 py-1 border-b border-zinc-800/40">
                                  <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5">Obs. Geral</span>
                                  <span className="text-[11px] text-zinc-400 break-words whitespace-pre-line leading-snug">{item.observacao_geral_trizy}</span>
                                </div>
                              )}
                              {item.observacao_origem && (
                                <div className="flex items-start gap-2 py-1 border-b border-zinc-800/40">
                                  <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5">Obs. Coleta</span>
                                  <span className="text-[11px] text-zinc-400 break-words whitespace-pre-line leading-snug">{item.observacao_origem}</span>
                                </div>
                              )}
                              {item.observacao_destino && (
                                <div className="flex items-start gap-2 py-1">
                                  <span className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium w-24 shrink-0 mt-0.5">Obs. Descarga</span>
                                  <span className="text-[11px] text-zinc-400 break-words whitespace-pre-line leading-snug">{item.observacao_destino}</span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* PAINEL DIREITO — Dados de Cálculo */}
                    <div className="w-56 shrink-0 flex flex-col gap-2">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-wide font-semibold mb-0.5 flex items-center gap-1">
                        <Calculator size={9} /> Dados de Cálculo
                      </p>

                      {/* KPIs de cálculo */}
                      {([
                        { label: 'KM Real',     value: item.distancia_km     ? `${Number(item.distancia_km).toLocaleString('pt-BR')} km` : '—', cls: 'text-blue-300' },
                        { label: 'Pedágio',     value: item.pedagio_total_calc ? formatBRL(Number(item.pedagio_total_calc)) : '—',              cls: 'text-amber-400' },
                        { label: 'Piso ANTT/t', value: item.antt_piso_por_ton  ? `R$ ${Number(item.antt_piso_por_ton).toFixed(2).replace('.', ',')}/t` : '—', cls: 'text-blue-400' },
                        { label: 'Preço Prop.', value: item.preco_proposto     ? `R$ ${Number(item.preco_proposto).toFixed(2).replace('.', ',')}/t` : '—', cls: 'text-violet-400' },
                      ] as { label: string; value: string; cls: string }[]).map(({ label, value, cls }) => (
                        <div key={label} className="bg-zinc-800/60 rounded-lg px-3 py-2">
                          <p className="text-[9px] text-zinc-600 uppercase font-semibold mb-0.5">{label}</p>
                          <p className={`text-sm font-bold tabular-nums font-mono ${cls}`}>{value}</p>
                        </div>
                      ))}

                      {/* Margem s/ ANTT */}
                      {item.preco_proposto != null && item.antt_piso_por_ton != null && Number(item.preco_proposto) > 0 && (
                        (() => {
                          const m = ((Number(item.preco_proposto) - Number(item.antt_piso_por_ton)) / Number(item.preco_proposto)) * 100
                          const ok = m >= 10
                          return (
                            <div className={`rounded-lg px-3 py-2 border ${ok ? 'bg-emerald-950/60 border-emerald-500/30' : 'bg-red-950/60 border-red-500/30'}`}>
                              <p className="text-[9px] text-zinc-600 uppercase font-semibold mb-0.5">Margem s/ANTT</p>
                              <p className={`text-sm font-bold tabular-nums font-mono ${ok ? 'text-emerald-400' : 'text-red-400'}`}>{m.toFixed(1)}%</p>
                              <p className={`text-[9px] mt-0.5 ${ok ? 'text-emerald-700' : 'text-red-700'}`}>{ok ? 'Aprovação Filial' : 'Enviar Diretoria'}</p>
                            </div>
                          )
                        })()
                      )}

                      {/* Tag Fiscal */}
                      {item.fiscal && (
                        <div className={`rounded-lg px-3 py-2.5 border ${item.fiscal.tipo === 'ISSQN' ? 'bg-amber-950/50 border-amber-500/30' : 'bg-blue-950/50 border-blue-500/30'}`}>
                          <p className="text-[9px] text-zinc-600 uppercase font-semibold mb-1">Incidência Fiscal</p>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full inline-block ${item.fiscal.tipo === 'ISSQN' ? 'bg-amber-500/20 text-amber-300' : 'bg-blue-500/20 text-blue-300'}`}>
                            {item.fiscal.tag}
                          </span>
                          <p className="text-[9px] text-zinc-600 mt-1.5 leading-snug">{item.fiscal.descricao}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Observações — largura total */}
                  {item.observacoes && (
                    <div className="bg-zinc-800/30 rounded-lg px-3 py-2.5 border border-zinc-800">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-wide font-semibold mb-1.5 flex items-center gap-1">
                        <Eye size={9} /> Observações
                      </p>
                      <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">{item.observacoes}</p>
                    </div>
                  )}

                  <p className="text-[9px] text-zinc-800 font-mono">ID: {item.id}</p>
                </div>
              )}
            </div>

            {/* Rodapé — Fechamento Comercial */}
            <div className="px-5 py-4 border-t border-zinc-800 bg-zinc-950/60 shrink-0">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wide font-semibold mb-3 flex items-center gap-1.5">
                <Trophy size={10} /> Fechar Cotação
              </p>
              <div className="mb-3">
                <label className="text-[10px] text-zinc-600 uppercase tracking-wide font-medium block mb-1.5">
                  Preço Comercial Final (R$/t)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number" value={precoFinal} onChange={e => setPrecoFinal(e.target.value)}
                    placeholder="0,00" min="0" step="0.01"
                    className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500/60 placeholder-zinc-700 tabular-nums font-mono"
                  />
                  <button
                    onClick={salvarPrecoFinal}
                    disabled={salvandoPrecoFinal || !precoFinal.trim()}
                    className="shrink-0 flex items-center gap-1.5 px-3.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-xs font-semibold border border-zinc-700 transition-colors"
                  >
                    {salvandoPrecoFinal ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                    Salvar
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleFechar('GANHA')}
                  disabled={isUpdating}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                >
                  {isUpdating ? <Loader2 size={13} className="animate-spin" /> : <Trophy size={13} />}
                  GANHA
                </button>
                <button
                  onClick={() => handleFechar('PERDIDA')}
                  disabled={isUpdating}
                  className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600/80 hover:bg-red-500 active:bg-red-700 disabled:opacity-50 text-white text-xs font-bold transition-colors"
                >
                  {isUpdating ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
                  PERDIDA
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </>
  )
}

// ─── Radar WhatsApp Timeline ────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function RadarWhatsAppTimeline({
  open, onClose, mensagens, loading, onTratado,
}: {
  open: boolean; onClose: () => void
  mensagens: TimelineMensagem[]; loading: boolean
  onTratado: (id: string) => void
}) {
  return (
    <>
      <div
        className={`fixed inset-0 bg-zinc-950/70 backdrop-blur-sm z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <aside className={`fixed right-0 top-0 h-full w-[480px] bg-zinc-900 border-l border-zinc-800 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-in-out ${open ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10"><Radio size={14} className="text-emerald-400" /></div>
            <div>
              <p className="text-sm font-semibold text-white">Radar WhatsApp</p>
              <p className="text-[11px] text-zinc-500">Avisos de mercado · grupo Cofco</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1.5 rounded-lg hover:bg-zinc-800">
            <X size={16} />
          </button>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="text-zinc-600 animate-spin" />
            </div>
          ) : mensagens.length === 0 ? (
            <div className="py-16 text-center">
              <Radio size={32} className="text-zinc-700 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">Nenhum aviso de mercado registrado ainda.</p>
              <p className="text-[11px] text-zinc-700 mt-1">Mensagens do grupo que não são cotações aparecerão aqui.</p>
            </div>
          ) : (
            mensagens.map((m, i) => (
              <div key={m.id} className="relative flex gap-3">
                {/* linha do tempo */}
                {i < mensagens.length - 1 && (
                  <span className="absolute left-[14px] top-7 w-px h-full bg-zinc-800" />
                )}
                {/* dot */}
                <div className="shrink-0 w-7 h-7 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mt-0.5">
                  <Bell size={11} className="text-emerald-400" />
                </div>
                {/* conteúdo */}
                <div className="flex-1 bg-zinc-800/40 rounded-xl px-3 py-2.5 border border-zinc-800">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <p className="text-[10px] text-zinc-600 font-mono">{formatDateTime(m.criado_em)}</p>
                    {m.grupo_nome && (
                      <span className="text-[9px] bg-zinc-700/60 text-zinc-400 px-1.5 py-0.5 rounded-full font-medium shrink-0">
                        {m.grupo_nome}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{m.texto}</p>
                  <button
                    onClick={() => onTratado(m.id)}
                    className="mt-1.5 flex items-center gap-1 text-[9px] text-zinc-500 hover:text-emerald-400 font-medium transition-colors"
                  >
                    <Check size={9} /> Tratado
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 shrink-0">
          <p className="text-[10px] text-zinc-700">Mensagens classificadas automaticamente como avisos de mercado pelo motor de IA.</p>
        </div>
      </aside>
    </>
  )
}

// ─── Modal Frete Geral Ongo (M15) ───────────────────────────────────────────────

function OngoGeralModal({
  open, onClose, rows, loading,
}: {
  open: boolean; onClose: () => void
  rows: CargaOngoGeral[]; loading: boolean
}) {
  const [filtroMunicipio, setFiltroMunicipio] = useState('')
  const [filtroTerminal,  setFiltroTerminal]  = useState('')
  const [filtroEmpresa,   setFiltroEmpresa]   = useState('')

  const [aba, setAba] = useState<'aovivo' | 'historico'>('aovivo')
  const hoje = new Date().toISOString().slice(0, 10)
  const [dataHistorico,    setDataHistorico]    = useState(hoje)
  const [historicoRows,    setHistoricoRows]    = useState<Record<string, string>[]>([])
  const [historicoLoading, setHistoricoLoading] = useState(false)

  useEffect(() => {
    if (aba !== 'historico' || !open) return
    const [ano, mes, dia] = dataHistorico.split('-')
    const dataBr = `${dia}/${mes}/${ano}`
    setHistoricoLoading(true)
    fetch(`/api/ongo-geral/historico?data=${dataBr}`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => setHistoricoRows(Array.isArray(data.rows) ? data.rows : []))
      .catch(() => setHistoricoRows([]))
      .finally(() => setHistoricoLoading(false))
  }, [aba, dataHistorico, open])

  const municipios = useMemo(() => Array.from(new Set(rows.map(r => r.municipio_origem).filter(Boolean))).sort(), [rows])
  const terminais  = useMemo(() => Array.from(new Set(rows.map(r => r.terminal_origem).filter(Boolean))).sort(), [rows])
  const empresas   = useMemo(() => Array.from(new Set(rows.map(r => r.empresa).filter(Boolean))).sort(), [rows])

  // Bloco de resumo recalcula em tempo real a partir das linhas filtradas
  const filtradas = useMemo(() => rows.filter(r =>
    (!filtroMunicipio || r.municipio_origem === filtroMunicipio) &&
    (!filtroTerminal  || r.terminal_origem  === filtroTerminal) &&
    (!filtroEmpresa   || r.empresa          === filtroEmpresa)
  ), [rows, filtroMunicipio, filtroTerminal, filtroEmpresa])

  const totalLotes          = filtradas.length
  const volumeLiberadoTotal = useMemo(() => filtradas.reduce((s, r) => s + (r.quantidade_kg || 0), 0), [filtradas])
  const saldoRestanteTotal  = useMemo(() => filtradas.reduce((s, r) => s + (r.saldo_restante_kg || 0), 0), [filtradas])

  const filtroAtivo   = !!(filtroMunicipio || filtroTerminal || filtroEmpresa)
  const limparFiltros = () => { setFiltroMunicipio(''); setFiltroTerminal(''); setFiltroEmpresa('') }

  return (
    <>
      <div
        className={`fixed inset-0 bg-zinc-950/70 backdrop-blur-sm z-40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={onClose}
      />
      <div className={`fixed inset-4 md:inset-10 z-50 bg-zinc-900 border border-violet-500/30 rounded-xl shadow-2xl flex flex-col transition-all duration-300 ${open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'}`}>

        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-violet-500/10"><BarChart3 size={14} className="text-violet-400" /></div>
            <div>
              <p className="text-sm font-semibold text-white">Frete Geral Ongo</p>
              <p className="text-[11px] text-zinc-500">Planilha integrada · fretes gerais</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {loading && <Loader2 size={14} className="text-zinc-500 animate-spin" />}
            <a
              href={SHEET_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
            >
              <ExternalLink size={11} /> Abrir planilha
            </a>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors p-1.5 rounded-lg hover:bg-zinc-800">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Abas */}
        <div className="flex items-center gap-1 px-5 pt-3 border-b border-zinc-800 shrink-0">
          {([
            { key: 'aovivo' as const,    label: 'Ao Vivo' },
            { key: 'historico' as const, label: 'Histórico' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setAba(key)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                aba === key
                  ? 'border-violet-500 text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Corpo scrollável */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">

          {aba === 'historico' ? (
            <>
              <div className="shrink-0">
                <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Data</label>
                <input
                  type="date"
                  value={dataHistorico}
                  onChange={e => setDataHistorico(e.target.value)}
                  className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500/60"
                />
              </div>
              <div className="border border-zinc-800 rounded-xl overflow-auto flex-1">
                <table className="w-full text-[11px]">
                  <thead className="bg-zinc-900 sticky top-0 z-10">
                    <tr>
                      {['Data Captura', 'Empresa', 'Produto', 'Rota', 'KG Total', 'KG Restante', 'KG Comprometido', 'KG Carregado', '% Completado', 'Qtd A Caminho', 'Status', 'Data Entrada Ongo'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historicoRows.length === 0 ? (
                      <tr>
                        <td colSpan={12} className="px-3 py-10 text-center text-zinc-600 text-xs">
                          {historicoLoading ? 'Carregando histórico...' : 'Nenhum registro para esta data.'}
                        </td>
                      </tr>
                    ) : historicoRows.map((r, i) => (
                      <tr key={i} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                        {['Data Captura', 'Empresa', 'Produto', 'Rota', 'KG Total', 'KG Restante', 'KG Comprometido', 'KG Carregado', '% Completado', 'Qtd A Caminho', 'Status', 'Data Entrada Ongo'].map(col => (
                          <td key={col} className="px-3 py-2 whitespace-nowrap text-zinc-400">{r[col] || '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
          <>
          {/* Bloco de resumo — real-time, recalcula com os filtros */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
            <div className="bg-zinc-800/60 border border-zinc-800 rounded-xl px-4 py-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium mb-1">Total de Lotes</p>
              <p className="text-2xl font-bold text-white tabular-nums">{totalLotes}</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-3">
              <p className="text-[10px] text-emerald-400/80 uppercase tracking-wide font-medium mb-1">Volume Liberado Total</p>
              <p className="text-2xl font-bold text-emerald-300 tabular-nums">{fmtKg(volumeLiberadoTotal)} kg</p>
            </div>
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
              <p className="text-[10px] text-orange-400/80 uppercase tracking-wide font-medium mb-1">Saldo Restante do Dia</p>
              <p className="text-2xl font-bold text-orange-300 tabular-nums">{fmtKg(saldoRestanteTotal)} kg</p>
            </div>
          </div>

          {/* Filtros dinâmicos */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 shrink-0">
            <div>
              <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Município Origem</label>
              <select
                value={filtroMunicipio}
                onChange={e => setFiltroMunicipio(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500/60 appearance-none cursor-pointer"
              >
                <option value="">Todos os municípios</option>
                {municipios.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Terminal Origem</label>
              <select
                value={filtroTerminal}
                onChange={e => setFiltroTerminal(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500/60 appearance-none cursor-pointer"
              >
                <option value="">Todos os terminais</option>
                {terminais.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Empresa / Embarcador</label>
              <select
                value={filtroEmpresa}
                onChange={e => setFiltroEmpresa(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-violet-500/60 appearance-none cursor-pointer"
              >
                <option value="">Todas as empresas</option>
                {empresas.map(emp => <option key={emp} value={emp}>{emp}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              {filtroAtivo && (
                <button
                  onClick={limparFiltros}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors px-3 py-2.5 rounded-lg border border-zinc-800 hover:border-zinc-700"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* Grid */}
          <div className="border border-zinc-800 rounded-xl overflow-auto flex-1">
            <table className="w-full text-[11px]">
              <thead className="bg-zinc-900 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Empresa</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Município Origem</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Terminal Origem</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Origem → Destino</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Produto</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Volume Liberado (kg)</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Saldo Restante (kg)</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Valor R$/T</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-zinc-600 text-xs">
                      {loading ? 'Carregando lotes...' : 'Nenhum lote encontrado para os filtros aplicados.'}
                    </td>
                  </tr>
                ) : filtradas.map(r => (
                  <tr key={r.link_id_carga || r.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-300">{r.empresa || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{r.municipio_origem || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{r.terminal_origem || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{r.origem} → {r.destino}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{r.produto || '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-300 tabular-nums font-mono">{fmtKg(r.quantidade_kg)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-300 tabular-nums font-mono">{fmtKg(r.saldo_restante_kg)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-300 tabular-nums font-mono">
                      {r.valor_proposto_ton != null ? r.valor_proposto_ton.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400">{r.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function TorreDeControle() {
  const router = useRouter()
  const [fretes,       setFretes]       = useState<CargaLogistica[]>([])
  const [drawerItem,   setDrawerItem]   = useState<CargaLogistica | null>(null)
  const [lastUpdate,   setLastUpdate]   = useState<string | null>(null)
  const [isLoading,    setIsLoading]    = useState(true)
  const [isPulsing,    setIsPulsing]    = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [updatingId,   setUpdatingId]   = useState<string | null>(null)

  const [filtroCliente,    setFiltroCliente]    = useState('')
  const [filtroFonte,      setFiltroFonte]      = useState<FonteIngestao | ''>('')
  const [filtroStatus,     setFiltroStatus]     = useState<StatusCotacao | ''>('')
  const [filtroAguardando, setFiltroAguardando] = useState(false)

  const [trizyCount,      setTrizyCount]      = useState(0)
  const [trizyCotacoes,   setTrizyCotacoes]   = useState<CargaLogistica[]>([])

  const [radarOpen,       setRadarOpen]       = useState(false)
  const [timelineData,    setTimelineData]    = useState<TimelineMensagem[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [whatsappCounts,  setWhatsappCounts]  = useState({ cotacoes: 0, avisos: 0 })

  const [ongoGeralOpen,    setOngoGeralOpen]    = useState(false)
  const [ongoGeralRows,    setOngoGeralRows]    = useState<CargaOngoGeral[]>([])
  const [ongoGeralLoading, setOngoGeralLoading] = useState(false)

  const [toastVisible, setToastVisible] = useState(false)
  const [toastMsg,     setToastMsg]     = useState('')
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMsg(msg); setToastVisible(true)
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 3000)
  }

  async function fetchTimeline() {
    setTimelineLoading(true)
    try {
      const res  = await fetch('/api/whatsapp/timeline?tipo=aviso&limit=50', { cache: 'no-store' })
      const data = await res.json()
      setTimelineData(data.mensagens ?? [])
    } catch { /* silencia — timeline é secundária */ }
    finally { setTimelineLoading(false) }
  }

  useEffect(() => {
    if (radarOpen) fetchTimeline()
  }, [radarOpen])

  async function marcarTratado(id: string) {
    setTimelineData(prev => prev.filter(m => m.id !== id))
    try {
      await fetch(`/api/whatsapp/timeline/${id}/tratado`, { method: 'PATCH' })
    } catch { /* item já saiu da tela; próximo fetch resolve se falhar */ }
  }

  const abortFretesRef = useRef<AbortController | null>(null)

  const fetchFretes = useCallback(async () => {
    abortFretesRef.current?.abort()
    const ctrl = new AbortController()
    abortFretesRef.current = ctrl
    try {
      const res  = await fetch('/api/fretes', { cache: 'no-store', signal: ctrl.signal })
      const data: ApiResponse & { error?: string; hint?: string } = await res.json()
      if (!res.ok || data.error) { setBackendError(data.hint ?? data.error ?? `HTTP ${res.status}`); setIsLoading(false); return }
      setBackendError(null); setFretes(data.fretes); setLastUpdate(data.timestamp)
      setIsPulsing(true); setTimeout(() => setIsPulsing(false), 700)
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setBackendError('Erro de rede — verifique se o Next.js está rodando.')
    } finally { setIsLoading(false) }
  }, [])

  useEffect(() => {
    fetchFretes()
    const id = setInterval(fetchFretes, 5000)
    return () => { clearInterval(id); abortFretesRef.current?.abort() }
  }, [fetchFretes])

  useEffect(() => {
    const fetchTrizy = async () => {
      try {
        const [resCount, resCot, resOngo, resWpp] = await Promise.all([
          fetch('/api/trizy/count',    { cache: 'no-store' }),
          fetch('/api/trizy/cotacoes', { cache: 'no-store' }),
          fetch('/api/ongo-geral',     { cache: 'no-store' }),
          fetch('/api/whatsapp/timeline?tipo=todos&limit=1', { cache: 'no-store' }),
        ])
        const dataCount = await resCount.json()
        const dataCot   = await resCot.json()
        const dataOngo  = await resOngo.json()
        const dataWpp   = await resWpp.json()
        if (typeof dataCount.count === 'number') setTrizyCount(dataCount.count)
        if (Array.isArray(dataCot.cotacoes))      setTrizyCotacoes(dataCot.cotacoes)
        if (Array.isArray(dataOngo.cargas))       setOngoGeralRows(dataOngo.cargas)
        if (typeof dataWpp.total_cotacao === 'number') {
          setWhatsappCounts({ cotacoes: dataWpp.total_cotacao, avisos: dataWpp.total_aviso ?? 0 })
        }
      } catch { /* silencia */ }
      finally { setOngoGeralLoading(false) }
    }
    fetchTrizy()
    const id = setInterval(fetchTrizy, 10000)
    return () => clearInterval(id)
  }, [])

  const updateStatus = useCallback(async (id: string, newStatus: StatusCotacao) => {
    setUpdatingId(id)
    try {
      const res = await fetch(`/api/cotacoes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: newStatus }) })
      if (res.ok) {
        setFretes(prev => prev.map(f => f.id === id ? { ...f, status: newStatus } : f))
        setTrizyCotacoes(prev => prev.map(f => f.id === id ? { ...f, status: newStatus } : f))
        setDrawerItem(prev => prev?.id === id ? { ...prev, status: newStatus } : prev)
      } else {
        showToast('Falha ao salvar status — tente novamente.')
      }
    } catch {
      showToast('Erro de rede ao atualizar status.')
    } finally { setUpdatingId(null) }
  }, [])

  async function fecharCotacao(id: string, status: 'GANHA' | 'PERDIDA') {
    await updateStatus(id, status)
    showToast(`Cotação marcada como ${status}`)
  }

  const countByFonte = useMemo(() => {
    const map: Partial<Record<FonteIngestao, number>> = {}
    for (const f of fretes) map[f.fonte_ingestao] = (map[f.fonte_ingestao] ?? 0) + 1
    return (fonte: FonteIngestao) => map[fonte] ?? 0
  }, [fretes])

  const cotacoes = useMemo(
    () => [
      ...fretes.filter(f => f.fonte_ingestao === 'whatsapp_grupo' || f.fonte_ingestao === 'gmail_cotacao'),
      ...trizyCotacoes,
    ],
    [fretes, trizyCotacoes],
  )

  const totalRecebidas   = cotacoes.length
  const totalPendentes   = cotacoes.filter(c => c.status === 'PENDENTE' || !c.status).length
  const totalGanhas      = cotacoes.filter(c => c.status === 'GANHA').length
  const totalAguardando  = cotacoes.filter(c => !isLixoCotacao(c) && c.status && STATUS_AGUARDANDO.has(c.status)).length

  const clientesUnicos = useMemo(() => {
    const set = new Set<string>()
    cotacoes.forEach(c => { if (c.embarcador && c.embarcador !== 'Não Identificado') set.add(c.embarcador) })
    return [...set].sort()
  }, [cotacoes])

  const cotacoesVisiveis = useMemo(() => cotacoes.filter(c => {
    if (isLixoCotacao(c)) return false
    const isAguardando = !!(c.status && STATUS_AGUARDANDO.has(c.status))
    // Aba "Aguardando Resposta" ativa → mostra só o cluster. Caso contrário, oculta
    // o cluster do radar ativo por padrão, exceto se o operador filtrar explicitamente
    // por um desses status via dropdown (escape hatch para revisão manual).
    if (filtroAguardando) {
      if (!isAguardando) return false
    } else if (isAguardando && !(filtroStatus && STATUS_AGUARDANDO.has(filtroStatus))) {
      return false
    }
    const clienteOk = !filtroCliente || c.embarcador === filtroCliente
    const fonteOk   = !filtroFonte   || c.fonte_ingestao === filtroFonte
    const statusOk  = !filtroStatus  || c.status === filtroStatus || (!c.status && filtroStatus === 'PENDENTE')
    return clienteOk && fonteOk && statusOk
  }), [cotacoes, filtroCliente, filtroFonte, filtroStatus, filtroAguardando])

  const filtroAtivo = !!(filtroCliente || filtroFonte || filtroStatus || filtroAguardando)
  const limparFiltros = () => { setFiltroCliente(''); setFiltroFonte(''); setFiltroStatus(''); setFiltroAguardando(false) }

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">

      <Toast visible={toastVisible} msg={toastMsg} />

      <RadarWhatsAppTimeline
        open={radarOpen}
        onClose={() => setRadarOpen(false)}
        mensagens={timelineData}
        loading={timelineLoading}
        onTratado={marcarTratado}
      />

      <OngoGeralModal
        open={ongoGeralOpen}
        onClose={() => setOngoGeralOpen(false)}
        rows={ongoGeralRows}
        loading={ongoGeralLoading}
      />

      <CotacaoDrawer
        item={drawerItem}
        onClose={() => setDrawerItem(null)}
        onFechar={fecharCotacao}
        updatingId={updatingId}
        showToast={showToast}
        onUpdateStatus={updateStatus}
      />

      {/* HEADER */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-sm px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-900/30">
              <Wheat size={15} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight leading-none">NO GRAIN OS</h1>
              <p className="text-[11px] text-zinc-500 mt-0.5">Torre de Controle · Motor de Ingestão</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Polling 5s</span>
            </div>
            <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5">
              <RefreshCw size={11} className={`transition-all ${isPulsing ? 'text-emerald-400 animate-spin' : 'text-zinc-600'}`} />
              <span className="text-[11px] text-zinc-500 font-mono">{lastUpdate ? formatTime(lastUpdate) : '--:--:--'}</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto w-full px-6 py-6 flex flex-col gap-6 flex-1">

        {/* 1) SOURCE CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {FONTE_ORDER.map(fonte => (
            <FonteCard
              key={fonte}
              fonte={fonte}
              count={
                fonte === 'ongo_cotacao' ? trizyCount :
                fonte === 'ongo_geral'   ? ongoGeralRows.length :
                countByFonte(fonte)
              }
              lastUpdate={lastUpdate}
              active={
                (fonte === 'ongo_cotacao' || fonte === 'gmail_cotacao') && filtroFonte === fonte
              }
              onClick={
                fonte === 'whatsapp_grupo' ? () => setRadarOpen(true) :
                fonte === 'ongo_cotacao'   ? () => setFiltroFonte(f => f === 'ongo_cotacao' ? '' : 'ongo_cotacao') :
                fonte === 'gmail_cotacao'  ? () => setFiltroFonte(f => f === 'gmail_cotacao' ? '' : 'gmail_cotacao') :
                fonte === 'ongo_geral'     ? () => setOngoGeralOpen(true) :
                undefined
              }
              legenda={
                fonte === 'whatsapp_grupo'
                  ? `${whatsappCounts.cotacoes} cotações · ${whatsappCounts.avisos} avisos`
                  : undefined
              }
            />
          ))}
        </div>

        {/* 2) STATUS DASHBOARD + FILTROS */}
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

            {/* Total — limpa filtros ao clicar */}
            <button
              type="button"
              className={`text-left bg-zinc-900 border rounded-xl p-5 cursor-pointer transition-all ${
                !filtroStatus && !filtroAguardando ? 'border-zinc-600 ring-1 ring-zinc-600/50' : 'border-zinc-800 hover:border-zinc-700'
              }`}
              onClick={limparFiltros}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-zinc-800"><Inbox size={13} className="text-zinc-400" /></div>
                <p className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wide">Cotações Recebidas</p>
                {!filtroStatus && !filtroAguardando && <span className="ml-auto text-[9px] bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded-full font-semibold">TODOS</span>}
              </div>
              <p className="text-4xl font-bold text-white tabular-nums">{totalRecebidas}</p>
              <p className="text-[11px] text-zinc-600 mt-1.5">Trizy + WhatsApp + Gmail</p>
            </button>

            {/* Pendentes */}
            <button
              type="button"
              className={`text-left bg-zinc-900 border rounded-xl p-5 cursor-pointer transition-all ${
                filtroStatus === 'PENDENTE'
                  ? 'border-amber-500/70 ring-1 ring-amber-500/40'
                  : 'border-amber-500/30 hover:border-amber-500/50'
              }`}
              onClick={() => { setFiltroAguardando(false); setFiltroStatus(prev => prev === 'PENDENTE' ? '' : 'PENDENTE') }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-amber-500/10"><Clock size={13} className="text-amber-400" /></div>
                <p className="text-[11px] text-amber-500/80 font-semibold uppercase tracking-wide">Pendentes</p>
                {filtroStatus === 'PENDENTE' && <span className="ml-auto text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-semibold">ATIVO</span>}
              </div>
              <p className="text-4xl font-bold text-amber-400 tabular-nums">{totalPendentes}</p>
              <p className="text-[11px] text-zinc-600 mt-1.5">aguardando retorno comercial</p>
            </button>

            {/* Cotado Aguardando Resposta — M13 */}
            <button
              type="button"
              className={`text-left bg-zinc-900 border rounded-xl p-5 cursor-pointer transition-all ${
                filtroAguardando
                  ? 'border-cyan-500/70 ring-1 ring-cyan-500/40'
                  : 'border-cyan-500/25 hover:border-cyan-500/50'
              }`}
              onClick={() => { setFiltroStatus(''); setFiltroAguardando(v => !v) }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-cyan-500/10"><Send size={13} className="text-cyan-400" /></div>
                <p className="text-[11px] text-cyan-500/80 font-semibold uppercase tracking-wide">Aguardando Resposta</p>
                {filtroAguardando && <span className="ml-auto text-[9px] bg-cyan-500/20 text-cyan-400 px-1.5 py-0.5 rounded-full font-semibold">ATIVO</span>}
              </div>
              <p className="text-4xl font-bold text-cyan-400 tabular-nums">{totalAguardando}</p>
              <p className="text-[11px] text-zinc-600 mt-1.5">já cotado, aguardando cliente</p>
            </button>

            {/* Ganhas */}
            <button
              type="button"
              className={`text-left bg-zinc-900 border rounded-xl p-5 cursor-pointer transition-all ${
                filtroStatus === 'GANHA'
                  ? 'border-emerald-500/70 ring-1 ring-emerald-500/40'
                  : 'border-emerald-500/20 hover:border-emerald-500/40'
              }`}
              onClick={() => { setFiltroAguardando(false); setFiltroStatus(prev => prev === 'GANHA' ? '' : 'GANHA') }}
            >
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-lg bg-emerald-500/10"><CheckCircle2 size={13} className="text-emerald-400" /></div>
                <p className="text-[11px] text-emerald-500/80 font-semibold uppercase tracking-wide">Ganhas</p>
                {filtroStatus === 'GANHA' && <span className="ml-auto text-[9px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-semibold">ATIVO</span>}
              </div>
              <p className="text-4xl font-bold text-emerald-400 tabular-nums">{totalGanhas}</p>
              <p className="text-[11px] text-zinc-600 mt-1.5">negócios fechados com sucesso</p>
            </button>
          </div>

          {/* Filtros */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3.5">
              <Filter size={13} className="text-zinc-500" />
              <p className="text-[11px] text-zinc-500 font-semibold uppercase tracking-wide">Filtros Dinâmicos</p>
              {filtroAtivo && (
                <button onClick={limparFiltros} className="ml-auto flex items-center gap-1 text-[11px] text-zinc-600 hover:text-zinc-300 transition-colors">
                  <X size={11} /> Limpar filtros
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-zinc-600 block mb-1.5 uppercase tracking-wide font-medium">Cliente</label>
                <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500/60 appearance-none cursor-pointer">
                  <option value="">Todos os clientes</option>
                  {clientesUnicos.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-zinc-600 block mb-1.5 uppercase tracking-wide font-medium">Origem do Dado</label>
                <select value={filtroFonte} onChange={e => setFiltroFonte(e.target.value as FonteIngestao | '')}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500/60 appearance-none cursor-pointer">
                  <option value="">Todas as origens</option>
                  <option value="ongo_cotacao">Trizy BID</option>
                  <option value="whatsapp_grupo">WhatsApp</option>
                  <option value="gmail_cotacao">Gmail</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-zinc-600 block mb-1.5 uppercase tracking-wide font-medium">Status</label>
                <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as StatusCotacao | '')}
                  className="w-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500/60 appearance-none cursor-pointer">
                  <option value="">Todos</option>
                  {[...STATUS_OPCOES, 'COTADO_AGUARDANDO' as StatusCotacao].map(s => (
                    <option key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 3) RADAR FULL-WIDTH */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">

          {/* Cabeçalho do Radar */}
          <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center gap-3">
            <Activity size={14} className="text-emerald-400 shrink-0" />
            <h2 className="text-sm font-semibold text-white">Radar de Cotações</h2>
            <span className="text-[11px] bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded-full tabular-nums">{cotacoesVisiveis.length}</span>
            {filtroStatus && STATUS_CONFIG[filtroStatus] && (
              <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_CONFIG[filtroStatus].cls}`}>
                {STATUS_CONFIG[filtroStatus].label}
              </span>
            )}
            <span className="ml-auto text-[10px] text-zinc-600">Clique em [Visualizar] para abrir auditoria</span>
          </div>

          {/* Corpo */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3">
                <RefreshCw size={20} className="text-zinc-600 animate-spin" />
                <p className="text-sm text-zinc-600">Conectando ao backend...</p>
              </div>
            </div>
          ) : backendError ? (
            <div className="p-6">
              <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-lg p-4">
                <AlertTriangle size={16} className="text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-amber-300 mb-1">Backend indisponível</p>
                  <p className="text-xs text-amber-600 font-mono">{backendError}</p>
                </div>
              </div>
            </div>
          ) : cotacoesVisiveis.length === 0 ? (
            <div className="p-12 text-center">
              <CheckCircle2 size={36} className="text-emerald-500/25 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">
                {filtroStatus === 'PENDENTE' ? 'Nenhuma cotação pendente. Tudo em dia!' : 'Nenhuma cotação encontrada para este filtro.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900 sticky top-0 z-10">
                  <tr className="border-b border-zinc-800">
                    {['Cliente', 'Rota', 'Produto / R$/t', 'Volume', 'Recebida / SLA', 'Status', 'Ações'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cotacoesVisiveis.map(cot => {
                    const pKey       = produtoKey(cot.produto)
                    const isUpdating = updatingId === cot.id
                    const isDrawer   = drawerItem?.id === cot.id
                    return (
                      <tr key={cot.id}
                        className={`border-b border-zinc-800/40 transition-colors ${isDrawer ? 'bg-emerald-500/5' : 'hover:bg-zinc-800/30'}`}>

                        {/* Cliente */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-xs text-zinc-200 font-medium mb-0.5">{trunc(cot.embarcador, 22)}</p>
                          {cot.fonte_ingestao === 'ongo_cotacao' && cot.id_externo && (
                            <p className="text-sm font-bold text-orange-500 tracking-wide mb-0.5">#{cot.id_externo}</p>
                          )}
                          <FreteBadge fonte={cot.fonte_ingestao} />
                        </td>

                        {/* Rota */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-xs text-zinc-300 flex items-center gap-1">
                            <MapPin size={9} className="text-zinc-600 shrink-0" />{trunc(cot.origem, 18)}
                          </p>
                          <p className="text-[11px] text-zinc-600 ml-3.5">{trunc(cot.destino, 18)}</p>
                        </td>

                        {/* Produto / R$/t */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className={`text-xs font-semibold mb-0.5 ${PRODUTO_CLS[pKey] ?? 'text-white'}`}>{trunc(cot.produto, 18)}</p>
                          <p className={`text-[11px] font-mono font-semibold ${cot.valor_tonelada > 0 ? 'text-emerald-400' : 'text-zinc-600'}`}>
                            {formatBRL(cot.valor_tonelada)}{cot.valor_tonelada > 0 ? '/t' : ''}
                          </p>
                        </td>

                        {/* Volume */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs text-zinc-400">{trunc(cot.volume_total, 16) || '—'}</span>
                        </td>

                        {/* Recebida / SLA */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-[10px] text-zinc-500 font-mono mb-0.5">
                            {cot.criado_em ? new Date(cot.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </p>
                          <CountdownSLA deadline={cot.prazo_limite_resposta} criado_em={cot.criado_em} />
                        </td>

                        {/* Status — Dropdown de override */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StatusDropdown
                            id={cot.id}
                            status={cot.status}
                            onUpdate={updateStatus}
                            loading={isUpdating}
                          />
                        </td>

                        {/* Ações */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => router.push(`/torre/calcular/${cot.id}`)}
                              className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-colors bg-emerald-600/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-600/35 hover:border-emerald-400"
                            >
                              <Calculator size={11} /> Calcular
                            </button>
                            <button
                              onClick={() => setDrawerItem(isDrawer ? null : cot)}
                              className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                                isDrawer
                                  ? 'bg-zinc-700 border-zinc-500 text-zinc-200'
                                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600'
                              }`}
                            >
                              <Eye size={11} /> Auditoria
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      <footer className="border-t border-zinc-800 px-6 py-3 shrink-0">
        <div className="max-w-screen-2xl mx-auto flex items-center justify-between text-[11px] text-zinc-600">
          <span>NO GRAIN OS v2.0 · Radar de Cotações · Gaveta de Auditoria</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            FastAPI · OpenAI · Supabase · QualP V4
          </span>
        </div>
      </footer>
    </div>
  )
}
