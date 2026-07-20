'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Wheat, PackageCheck, Loader2, User, Users,
  ListChecks, Check, Pencil, X, StickyNote, FileSpreadsheet,
  Copy, Send,
} from 'lucide-react'
import type { LiberacaoAtiva, LiberacaoEvento, Filial } from '@/types/carga'
import { semaforoLiberacao, pctSaldo, SEMAFORO_CLASSES, SEMAFORO_DOT, type CorSemaforo } from '@/lib/liberacao'

// M42 — Tela de consolidação visual do Módulo Liberações & Aderência (FASE 11).
// Hoje só o Ongo alimenta liberacoes_ativas (M41) — filial/regional/responsável
// comercial ficam vazios até M45 (WhatsApp por cliente) entrar.
// M44 (redefinido 2026-07-20): scraper do Portal SMC BTG ficou em stand-by —
// em vez disso, a filial/comercial preenche aderência (No Local/Em Trânsito/
// Cadência/Frete Motorista) direto aqui, mesmos campos que hoje preenchem na
// planilha "Cadência Diária" (ver Rag de Liberações/), só que gravando no
// Supabase em vez de solto numa aba.

const TODAS = '__todas__'
const CARTEIRA_KEY = 'torre_liberacoes_minha_carteira_nome'

function fmtKg(v: number | null): string {
  if (v == null) return '—'
  return `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`
}

function fmtBRL(v: number | null): string {
  if (v == null) return '—'
  return `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
}

function fmtRelativo(iso: string): string {
  const t = new Date(iso).getTime()
  if (isNaN(t)) return '—'
  const horas = (Date.now() - t) / (1000 * 60 * 60)
  if (horas < 1) return 'há minutos'
  if (horas < 24) return `há ${Math.floor(horas)}h`
  return `há ${Math.floor(horas / 24)}d`
}

const TIPO_EVENTO_LABEL: Record<string, string> = {
  liberacao_nova: 'Liberação nova',
  reajuste: 'Reajuste',
  agendamento_longo: 'Agendamento longo',
  urgencia_caminhao: 'Urgência de caminhão',
  suspensao: 'Suspensão',
}

function parseCadenciaNum(s: string | null): number | null {
  if (!s) return null
  const m = s.match(/\d+/)
  return m ? parseInt(m[0], 10) : null
}

function pctAderencia(l: LiberacaoAtiva): number | null {
  const cad = parseCadenciaNum(l.cadencia_diaria)
  if (!cad) return null
  return ((l.caminhoes_no_local ?? 0) + (l.caminhoes_em_transito ?? 0)) / cad * 100
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

// M48 — mesmo texto que o backend monta pro WhatsApp (routers/liberacoes.py
// _montar_texto_aderencia), duplicado aqui só pro botão Copiar (client-only,
// sem round-trip) — mesmo padrão de buildDadosBrutos em app/page.tsx.
function buildTextoAderencia(l: LiberacaoAtiva): string {
  const pct = pctAderencia(l)
  const margem = l.valor_tonelada != null && l.frete_motorista_ton != null
    ? l.valor_tonelada - l.frete_motorista_ton : null
  const linhas = [
    `*NO GRAIN OS — Aderência: ${l.cliente ?? '—'}*`,
    '',
    `Rota: ${l.origem ?? '—'} → ${l.destino ?? '—'}`,
    `Produto: ${l.produto ?? '—'}`,
    `Cadência: ${l.cadencia_diaria ?? '—'}`,
    `No Local: ${l.caminhoes_no_local ?? 0} | Em Trânsito: ${l.caminhoes_em_transito ?? 0}`,
    `Aderência: ${pct != null ? `${pct.toFixed(0)}%` : '—'}`,
    `Saldo restante: ${fmtKg(l.saldo_kg)}`,
  ]
  if (l.frete_motorista_ton != null) linhas.push(`Frete Motorista: ${fmtBRL(l.frete_motorista_ton)}/t`)
  if (l.valor_tonelada != null) linhas.push(`Preço Cliente: ${fmtBRL(l.valor_tonelada)}/t`)
  if (margem != null) linhas.push(`Margem: ${fmtBRL(margem)}/t`)
  return linhas.join('\n')
}

type CampoAderencia = 'cadencia_diaria' | 'caminhoes_no_local' | 'caminhoes_em_transito' | 'frete_motorista_ton'

function distinctValues(rows: LiberacaoAtiva[], campo: keyof LiberacaoAtiva): string[] {
  const set = new Set<string>()
  for (const r of rows) {
    const v = r[campo]
    if (typeof v === 'string' && v.trim()) set.add(v.trim())
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export default function LiberacoesAderencia() {
  const router = useRouter()

  const [liberacoes, setLiberacoes] = useState<LiberacaoAtiva[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const [filtroCliente, setFiltroCliente]   = useState(TODAS)
  const [filtroFilial, setFiltroFilial]     = useState(TODAS)
  const [filtroRegional, setFiltroRegional] = useState(TODAS)
  const [filtroDestino, setFiltroDestino]   = useState(TODAS)
  const [filtroCor, setFiltroCor]           = useState<CorSemaforo | typeof TODAS>(TODAS)

  const [minhaCarteira, setMinhaCarteira] = useState(false)
  const [meuNome, setMeuNome] = useState('')

  // M43 — fila de revisão humana (eventos que o matcher não conseguiu
  // aplicar sozinho: confiança baixa, zero ou vários candidatos).
  const [fila, setFila] = useState<LiberacaoEvento[]>([])
  const [filaAcao, setFilaAcao] = useState<string | null>(null)

  // M52 — Projeção Google Sheets filtrável
  const [syncingSheets, setSyncingSheets] = useState(false)
  const [sheetsMsg, setSheetsMsg] = useState<string | null>(null)

  // M44 (redefinido) — input manual de aderência + toast de erro (a tela não
  // tinha nenhum feedback de falha antes, era otimismo silencioso puro).
  const [toast, setToast] = useState<string | null>(null)
  const [salvandoCampo, setSalvandoCampo] = useState<string | null>(null)

  // M48/M49 — texto de aderência (copiar) + disparo WhatsApp pra filial,
  // reaproveitando o cadastro de filiais do M54 (dropdown do handoff).
  const [filiaisCadastro, setFiliaisCadastro] = useState<Filial[]>([])
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [notificandoId, setNotificandoId] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    fetch('/api/handoff/filiais', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => setFiliaisCadastro(Array.isArray(data.filiais) ? data.filiais : []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const salvo = typeof window !== 'undefined' ? window.localStorage.getItem(CARTEIRA_KEY) : null
    if (salvo) setMeuNome(salvo)
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/torre/liberacoes', { cache: 'no-store' })
      const data = await res.json()
      setLiberacoes(Array.isArray(data.liberacoes) ? data.liberacoes : [])
      setErro(data.error ?? null)
    } catch {
      setErro('Erro de rede — verifique se o Next.js está rodando.')
    } finally {
      setLoading(false)
    }
  }, [])

  const carregarFila = useCallback(async () => {
    try {
      const res = await fetch('/api/torre/liberacoes/fila', { cache: 'no-store' })
      const data = await res.json()
      setFila(Array.isArray(data.eventos) ? data.eventos : [])
    } catch {
      // silencioso — fila é complementar, não deve travar a tela principal
    }
  }, [])

  useEffect(() => { carregar(); carregarFila() }, [carregar, carregarFila])
  useEffect(() => {
    const id = setInterval(() => { carregar(); carregarFila() }, 30_000)
    return () => clearInterval(id)
  }, [carregar, carregarFila])

  async function confirmarEvento(id: string) {
    setFilaAcao(id)
    try {
      await fetch(`/api/torre/liberacoes/eventos/${id}/confirmar`, { method: 'PATCH' })
      await Promise.all([carregar(), carregarFila()])
    } finally {
      setFilaAcao(null)
    }
  }

  async function descartarEvento(id: string) {
    setFilaAcao(id)
    try {
      await fetch(`/api/torre/liberacoes/eventos/${id}/descartar`, { method: 'PATCH' })
      await carregarFila()
    } finally {
      setFilaAcao(null)
    }
  }

  async function corrigirEvento(id: string) {
    const loteId = window.prompt('ID (UUID) do lote correto em liberacoes_ativas para aplicar este evento:')
    if (!loteId || !loteId.trim()) return
    setFilaAcao(id)
    try {
      const res = await fetch(`/api/torre/liberacoes/eventos/${id}/corrigir`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liberacao_ativa_id: loteId.trim() }),
      })
      const data = await res.json()
      if (data.status === 'erro' || data.error) {
        window.alert(data.motivo ?? data.error ?? 'Não foi possível aplicar a correção.')
      }
      await Promise.all([carregar(), carregarFila()])
    } finally {
      setFilaAcao(null)
    }
  }

  async function syncSheets() {
    setSyncingSheets(true)
    setSheetsMsg(null)
    try {
      const res = await fetch('/api/torre/liberacoes/sync-sheets', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { setSheetsMsg(data.detail ?? data.error ?? 'Erro ao sincronizar.'); return }
      setSheetsMsg(`${data.linhas} lote(s) sincronizado(s)!`)
      window.open(data.sheet_url, '_blank')
    } catch {
      setSheetsMsg('Erro de rede ao sincronizar.')
    } finally {
      setSyncingSheets(false)
      setTimeout(() => setSheetsMsg(null), 4000)
    }
  }

  async function atualizarAderencia(id: string, campo: CampoAderencia, valorBruto: string) {
    let valor: string | number | null
    if (campo === 'cadencia_diaria') {
      valor = valorBruto.trim() || null
    } else if (campo === 'caminhoes_no_local' || campo === 'caminhoes_em_transito') {
      valor = valorBruto.trim() === '' ? 0 : parseInt(valorBruto, 10)
      if (Number.isNaN(valor) || valor < 0) { setToast('Valor inválido — use um número inteiro ≥ 0.'); return }
    } else {
      valor = valorBruto.trim() === '' ? null : parseFloat(valorBruto.replace(',', '.'))
      if (valor !== null && (Number.isNaN(valor) || valor < 0)) { setToast('Valor inválido — use um número ≥ 0.'); return }
    }

    const anterior = liberacoes.find(l => l.id === id)
    if (!anterior) return
    setLiberacoes(prev => prev.map(l => l.id === id ? { ...l, [campo]: valor } : l))
    setSalvandoCampo(`${id}:${campo}`)
    try {
      const res = await fetch(`/api/torre/liberacoes/${id}/aderencia`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [campo]: valor }),
      })
      const data = await res.json()
      if (!res.ok || data?.status === 'erro') throw new Error(data?.detail ?? data?.motivo ?? 'Falha ao salvar')
      if (data?.lote) setLiberacoes(prev => prev.map(l => l.id === id ? { ...l, ...data.lote } : l))
    } catch {
      setLiberacoes(prev => prev.map(l => l.id === id ? anterior : l))
      setToast('Não foi possível salvar — verifique a conexão e tente de novo.')
    } finally {
      setSalvandoCampo(null)
    }
  }

  function copiarAderencia(l: LiberacaoAtiva) {
    const ok = clipCopy(buildTextoAderencia(l))
    if (ok) {
      setCopiedId(l.id)
      setTimeout(() => setCopiedId(null), 2000)
      setToast('Texto de aderência copiado!')
    }
  }

  async function notificarFilial(l: LiberacaoAtiva) {
    if (filiaisCadastro.length === 0) {
      setToast('Nenhuma filial cadastrada — cadastre em `filiais` no Supabase (mesmo cadastro do Handoff, M54).')
      return
    }
    const filial = filiaisCadastro.find(f => f.nome.trim().toLowerCase() === (l.filial ?? '').trim().toLowerCase())
    if (!filial) {
      setToast(`Nenhuma filial cadastrada com o nome "${l.filial ?? '—'}" — confira a tabela \`filiais\`.`)
      return
    }
    const destinos = [filial.responsavel_1_nome, filial.responsavel_2_nome].filter(Boolean).join(', ') || filial.nome
    if (!window.confirm(`Notificar ${filial.nome} (${destinos}) sobre o lote ${l.fonte}#${l.id_externo} via WhatsApp?`)) return

    setNotificandoId(l.id)
    try {
      const res = await fetch(`/api/torre/liberacoes/${l.id}/notificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filial_id: filial.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.detail ?? data?.error ?? 'Falha ao notificar')
      const okCount = (data.enviados ?? []).filter((e: { enviado: boolean }) => e.enviado).length
      setToast(okCount > 0 ? `Notificação enviada pra ${filial.nome} (${okCount}).` : 'Envio falhou — verifique o WhatsApp da filial.')
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Não foi possível notificar — verifique a conexão.')
    } finally {
      setNotificandoId(null)
    }
  }

  function ativarMinhaCarteira(nome: string) {
    setMeuNome(nome)
    window.localStorage.setItem(CARTEIRA_KEY, nome)
    setMinhaCarteira(true)
  }

  const clientes  = useMemo(() => distinctValues(liberacoes, 'cliente'), [liberacoes])
  const filiais   = useMemo(() => distinctValues(liberacoes, 'filial'), [liberacoes])
  const regionais = useMemo(() => distinctValues(liberacoes, 'regional'), [liberacoes])
  const destinos  = useMemo(() => distinctValues(liberacoes, 'destino'), [liberacoes])

  const filtradas = useMemo(() => {
    return liberacoes.filter(l => {
      if (filtroCliente !== TODAS && l.cliente !== filtroCliente) return false
      if (filtroFilial !== TODAS && l.filial !== filtroFilial) return false
      if (filtroRegional !== TODAS && l.regional !== filtroRegional) return false
      if (filtroDestino !== TODAS && l.destino !== filtroDestino) return false
      if (filtroCor !== TODAS && semaforoLiberacao(l).cor !== filtroCor) return false
      if (minhaCarteira && meuNome.trim()) {
        const responsavel = (l.responsavel_comercial ?? '').toLowerCase().trim()
        if (responsavel !== meuNome.toLowerCase().trim()) return false
      }
      return true
    })
  }, [liberacoes, filtroCliente, filtroFilial, filtroRegional, filtroDestino, filtroCor, minhaCarteira, meuNome])

  const contagemCor = useMemo(() => {
    const c: Record<CorSemaforo, number> = { verde: 0, amarelo: 0, vermelho: 0, cinza: 0 }
    for (const l of liberacoes) c[semaforoLiberacao(l).cor] += 1
    return c
  }, [liberacoes])

  const volumeAtivoKg = useMemo(
    () => liberacoes
      .filter(l => l.status !== 'zerado' && l.status !== 'cancelado')
      .reduce((s, l) => s + (l.saldo_kg ?? 0), 0),
    [liberacoes],
  )

  // Achado 2026-07-20: "Total de Lotes" mostrava liberacoes.length (todas as
  // linhas, inclusive zerado/cancelado — mapeadas pro semáforo "cinza", que
  // nunca teve card próprio) enquanto os 3 cards coloridos somam só verde+
  // amarelo+vermelho. Resultado visível: 219 no card Total vs. 99 na soma dos
  // 3 cards, parecendo o mesmo bug fantasma do M39.1 — não é: os 120 "sumidos"
  // são zerado/cancelado de verdade (reconciliados certo pelo M41 desde
  // 15/07), só não apareciam em lugar nenhum da tela. "Total de Lotes" agora
  // conta só ativos (mesmo filtro que volumeAtivoKg já usava), e o card ganha
  // uma nota com o total de finalizados — não escondido, só não somado junto.
  const totalAtivos = liberacoes.length - contagemCor.cinza

  const semResponsavel = liberacoes.length > 0 && liberacoes.every(l => !l.responsavel_comercial)

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">

      <header className="h-11 shrink-0 border-b border-zinc-800 flex items-center px-4 gap-3 bg-zinc-950/90 backdrop-blur-sm">
        <button onClick={() => router.push('/')}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 transition-colors text-xs">
          <ArrowLeft size={13} /> Radar
        </button>
        <span className="text-zinc-800">|</span>
        <div className="flex items-center gap-1.5">
          <Wheat size={12} className="text-emerald-400" />
          <span className="text-xs font-semibold text-white">NO GRAIN OS</span>
          <span className="text-zinc-600 text-xs">· Liberações & Aderência</span>
        </div>
        {loading && <Loader2 size={12} className="text-zinc-600 animate-spin ml-2" />}
      </header>

      <main className="max-w-screen-2xl mx-auto w-full px-6 py-6 flex flex-col gap-5 flex-1">

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-emerald-500/10"><PackageCheck size={16} className="text-emerald-400" /></div>
            <div>
              <p className="text-sm font-semibold text-white">Liberações & Aderência</p>
              <p className="text-[11px] text-zinc-500">
                Estado atual consolidado por lote · fonte: Ongo (M41)
                {liberacoes.length > 0 ? ` · ${totalAtivos} ativo(s)` : ''}
                {contagemCor.cinza > 0 ? ` · ${contagemCor.cinza} finalizado(s)` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
            <button
              onClick={() => setMinhaCarteira(false)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                !minhaCarteira ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Users size={12} /> Visão Geral
            </button>
            <button
              onClick={() => {
                if (!meuNome.trim()) {
                  const nome = window.prompt('Seu nome (como aparece em responsável comercial):')
                  if (nome && nome.trim()) ativarMinhaCarteira(nome.trim())
                  return
                }
                setMinhaCarteira(true)
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                minhaCarteira ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <User size={12} /> Minha Carteira{meuNome ? ` · ${meuNome}` : ''}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {sheetsMsg && <span className="text-[11px] text-zinc-500">{sheetsMsg}</span>}
            <button
              onClick={syncSheets}
              disabled={syncingSheets}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 disabled:opacity-40 transition-colors"
            >
              {syncingSheets ? <Loader2 size={12} className="animate-spin" /> : <FileSpreadsheet size={12} />}
              Sincronizar Planilha
            </button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-950/40 border border-red-500/20 rounded-xl px-4 py-3 text-xs text-red-400">{erro}</div>
        )}

        {/* M43 — Fila de Revisão: eventos que o matcher não conseguiu aplicar sozinho */}
        {fila.length > 0 && (
          <div className="bg-violet-950/20 border border-violet-500/25 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-violet-500/20 flex items-center gap-2">
              <ListChecks size={14} className="text-violet-400" />
              <p className="text-xs font-semibold text-violet-300">Fila de Revisão · {fila.length} evento(s)</p>
            </div>
            <div className="divide-y divide-violet-500/10">
              {fila.map(ev => (
                <div key={ev.id} className="px-4 py-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-white">{TIPO_EVENTO_LABEL[ev.tipo_evento] ?? ev.tipo_evento}</span>
                      <span className="text-[10px] text-zinc-500 font-mono">{ev.fonte}{ev.id_externo ? `#${ev.id_externo}` : ''}</span>
                      <span className="text-[10px] text-zinc-600">confiança: {ev.nivel_confianca}</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-0.5">{ev.motivo_pendencia ?? 'Aguardando revisão.'}</p>
                    {ev.liberacao_candidata && (
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        Candidato: <span className="text-zinc-300">{ev.liberacao_candidata.cliente ?? '—'}</span>
                        {' · '}{ev.liberacao_candidata.fonte}#{ev.liberacao_candidata.id_externo}
                        {' · '}{ev.liberacao_candidata.origem ?? '—'} → {ev.liberacao_candidata.destino ?? '—'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      disabled={filaAcao === ev.id || !ev.liberacao_candidata}
                      onClick={() => confirmarEvento(ev.id)}
                      title={ev.liberacao_candidata ? 'Aplicar no lote candidato' : 'Sem candidato — use Corrigir'}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Check size={11} /> Confirmar
                    </button>
                    <button
                      disabled={filaAcao === ev.id}
                      onClick={() => corrigirEvento(ev.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 hover:border-zinc-600 disabled:opacity-30 transition-colors"
                    >
                      <Pencil size={11} /> Corrigir
                    </button>
                    <button
                      disabled={filaAcao === ev.id}
                      onClick={() => descartarEvento(ev.id)}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/25 hover:bg-red-500/20 disabled:opacity-30 transition-colors"
                    >
                      <X size={11} /> Descartar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {semResponsavel && (
          <div className="bg-amber-950/30 border border-amber-500/20 rounded-xl px-4 py-3 text-xs text-amber-400">
            Nenhum lote tem responsável comercial definido ainda — campo é preenchido pela próxima fonte (WhatsApp por cliente, M45). &quot;Minha Carteira&quot; fica vazia até lá.
          </div>
        )}

        {toast && (
          <div className="fixed bottom-6 right-6 z-50 bg-red-950 border border-red-500/40 text-red-300 text-xs px-4 py-2.5 rounded-lg shadow-lg">
            {toast}
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <button onClick={() => setFiltroCor(TODAS)}
            className={`text-left bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${filtroCor === TODAS ? 'border-zinc-600' : 'border-zinc-800 hover:border-zinc-700'}`}>
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium mb-1">Total de Lotes Ativos</p>
            <p className="text-2xl font-bold text-white tabular-nums">{totalAtivos}</p>
            {contagemCor.cinza > 0 && (
              <p className="text-[10px] text-zinc-600 mt-0.5">+{contagemCor.cinza} finalizado(s)</p>
            )}
          </button>
          <button onClick={() => setFiltroCor('verde')}
            className={`text-left bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${filtroCor === 'verde' ? 'border-emerald-500/50' : 'border-zinc-800 hover:border-zinc-700'}`}>
            <p className="text-[10px] text-emerald-400/80 uppercase tracking-wide font-medium mb-1">Verde</p>
            <p className="text-2xl font-bold text-emerald-300 tabular-nums">{contagemCor.verde}</p>
          </button>
          <button onClick={() => setFiltroCor('amarelo')}
            className={`text-left bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${filtroCor === 'amarelo' ? 'border-amber-500/50' : 'border-zinc-800 hover:border-zinc-700'}`}>
            <p className="text-[10px] text-amber-400/80 uppercase tracking-wide font-medium mb-1">Amarelo</p>
            <p className="text-2xl font-bold text-amber-300 tabular-nums">{contagemCor.amarelo}</p>
          </button>
          <button onClick={() => setFiltroCor('vermelho')}
            className={`text-left bg-zinc-900 border rounded-xl px-4 py-3 transition-colors ${filtroCor === 'vermelho' ? 'border-red-500/50' : 'border-zinc-800 hover:border-zinc-700'}`}>
            <p className="text-[10px] text-red-400/80 uppercase tracking-wide font-medium mb-1">Vermelho</p>
            <p className="text-2xl font-bold text-red-300 tabular-nums">{contagemCor.vermelho}</p>
          </button>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-medium mb-1">Saldo Ativo Total</p>
            <p className="text-2xl font-bold text-white tabular-nums">{fmtKg(volumeAtivoKg)}</p>
          </div>
        </div>

        {/* Filtros */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Cliente</label>
            <select value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500/60 min-w-[140px]">
              <option value={TODAS}>Todos</option>
              {clientes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Filial</label>
            <select value={filtroFilial} onChange={e => setFiltroFilial(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500/60 min-w-[120px]">
              <option value={TODAS}>Todas</option>
              {filiais.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Regional</label>
            <select value={filtroRegional} onChange={e => setFiltroRegional(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500/60 min-w-[120px]">
              <option value={TODAS}>Todas</option>
              {regionais.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[9px] text-zinc-600 uppercase tracking-wide font-medium block mb-1">Destino</label>
            <select value={filtroDestino} onChange={e => setFiltroDestino(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500/60 min-w-[160px]">
              <option value={TODAS}>Todos</option>
              {destinos.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {(filtroCliente !== TODAS || filtroFilial !== TODAS || filtroRegional !== TODAS || filtroDestino !== TODAS || filtroCor !== TODAS) && (
            <button
              onClick={() => { setFiltroCliente(TODAS); setFiltroFilial(TODAS); setFiltroRegional(TODAS); setFiltroDestino(TODAS); setFiltroCor(TODAS) }}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
            >
              Limpar filtros
            </button>
          )}
        </div>

        {/* Tabela */}
        <div className="border border-zinc-800 rounded-xl overflow-auto flex-1">
          <table className="w-full text-[11px]">
            <thead className="bg-zinc-900 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">ID</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Cliente</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Origem</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Destino</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Produto</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Volume</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Saldo</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">R$/ton</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider" title="Caminhões/dia planejados — editável">Cadência</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider" title="Caminhões no local hoje — editável">No Local</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider" title="Caminhões em trânsito hoje — editável">Trânsito</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider" title="(No Local + Trânsito) / Cadência">% AD.</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider" title="Repasse ao transportador — editável">Frete Mot.</th>
                <th className="px-3 py-2 text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Responsável</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Atualizado</th>
                <th className="px-3 py-2 text-right text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan={17} className="px-3 py-10 text-center text-zinc-600 text-xs">
                    {loading ? 'Carregando...' : 'Nenhuma liberação encontrada com esses filtros.'}
                  </td>
                </tr>
              ) : filtradas.map(l => {
                const sem = semaforoLiberacao(l)
                const pct = pctSaldo(l)
                const pctAd = pctAderencia(l)
                const margem = l.valor_tonelada != null && l.frete_motorista_ton != null
                  ? l.valor_tonelada - l.frete_motorista_ton : null
                const inputBase = "bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-emerald-500/60 focus:outline-none text-zinc-300 text-[11px] disabled:opacity-40"
                return (
                  <tr key={l.id} className="border-b border-zinc-800/40 hover:bg-zinc-800/30">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-medium ${SEMAFORO_CLASSES[sem.cor]}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${SEMAFORO_DOT[sem.cor]}`} />
                        {sem.label}
                      </span>
                      {l.observacao && (
                        <span title={l.observacao} className="inline-block ml-1.5 align-middle">
                          <StickyNote size={11} className="text-amber-400/70" />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-400 font-mono">{l.fonte}#{l.id_externo}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-200 font-medium max-w-[160px] truncate">{l.cliente ?? '—'}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-zinc-400">{l.origem ?? '—'}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate text-zinc-400">{l.destino ?? '—'}</td>
                    <td className="px-3 py-2 max-w-[140px] truncate text-zinc-400">{l.produto ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-300 tabular-nums font-mono">{fmtKg(l.volume_total_kg)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums font-mono">
                      <span className={pct != null && pct <= 20 ? 'text-amber-400' : 'text-zinc-300'}>{fmtKg(l.saldo_kg)}</span>
                      {pct != null && <span className="text-zinc-600 ml-1">({pct.toFixed(0)}%)</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-300 tabular-nums font-mono">{fmtBRL(l.valor_tonelada)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <input
                        key={`${l.id}-cad-${l.atualizado_em}`}
                        defaultValue={l.cadencia_diaria ?? ''}
                        placeholder="—"
                        disabled={salvandoCampo === `${l.id}:cadencia_diaria`}
                        onBlur={e => { if (e.target.value !== (l.cadencia_diaria ?? '')) atualizarAderencia(l.id, 'cadencia_diaria', e.target.value) }}
                        className={`${inputBase} w-20 px-0.5`}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <input
                        key={`${l.id}-local-${l.atualizado_em}`}
                        type="number" min={0} inputMode="numeric"
                        defaultValue={l.caminhoes_no_local ?? 0}
                        disabled={salvandoCampo === `${l.id}:caminhoes_no_local`}
                        onBlur={e => { if (e.target.value !== String(l.caminhoes_no_local ?? 0)) atualizarAderencia(l.id, 'caminhoes_no_local', e.target.value) }}
                        className={`${inputBase} w-12 text-right tabular-nums`}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <input
                        key={`${l.id}-transito-${l.atualizado_em}`}
                        type="number" min={0} inputMode="numeric"
                        defaultValue={l.caminhoes_em_transito ?? 0}
                        disabled={salvandoCampo === `${l.id}:caminhoes_em_transito`}
                        onBlur={e => { if (e.target.value !== String(l.caminhoes_em_transito ?? 0)) atualizarAderencia(l.id, 'caminhoes_em_transito', e.target.value) }}
                        className={`${inputBase} w-12 text-right tabular-nums`}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums">
                      {pctAd == null ? <span className="text-zinc-600">—</span> : (
                        <span className={pctAd >= 80 ? 'text-emerald-400' : pctAd >= 40 ? 'text-amber-400' : 'text-red-400'}>
                          {pctAd.toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <input
                        key={`${l.id}-fm-${l.atualizado_em}`}
                        type="number" min={0} step="0.01" inputMode="decimal"
                        defaultValue={l.frete_motorista_ton ?? ''}
                        placeholder="—"
                        disabled={salvandoCampo === `${l.id}:frete_motorista_ton`}
                        onBlur={e => { if (e.target.value !== String(l.frete_motorista_ton ?? '')) atualizarAderencia(l.id, 'frete_motorista_ton', e.target.value) }}
                        className={`${inputBase} w-16 text-right tabular-nums`}
                      />
                      {margem != null && (
                        <div className={`text-[9px] mt-0.5 ${margem >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                          marg. {fmtBRL(margem)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-zinc-500">{l.responsavel_comercial ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right text-zinc-500 tabular-nums">{fmtRelativo(l.atualizado_em)}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => copiarAderencia(l)}
                          title="Copiar texto de aderência (M48)"
                          className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                        >
                          {copiedId === l.id ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                        </button>
                        <button
                          onClick={() => notificarFilial(l)}
                          disabled={notificandoId === l.id}
                          title="Notificar filial via WhatsApp (M49)"
                          className="p-1.5 rounded-md text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
                        >
                          {notificandoId === l.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  )
}
