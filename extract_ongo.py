"""
extract_ongo.py — Monitor contínuo de carregamentos Ongo Cargas → Google Sheets.
Versão 5: + first_seen_cache (data de entrada no Ongo) + Análise por Oferta
          + Histórico (append-only) + Análise Mensal + campos extras da API.

Fluxo por ciclo:
  1. Login OAuth PKCE — feito uma vez, browser fica vivo entre ciclos.
  2. Navega /carregamentos → intercepta GET Frete/all-with-cotacao.
  3. Para cotações sem cache: busca CotacaoLicita/get/{id} em paralelo.
  4. Navega /agendamentos → intercepta Agendamento/get-listagem.
  5. Navega /lances → intercepta dados de lances disponíveis.
  6. Registra data de primeira aparição de cada oferta (first_seen_cache).
  7. Persiste no Histórico as cotações que ainda não foram registradas hoje.
  8. Calcula: Aderência, Análise por Oferta, Análise Mensal, AUDITORIA.
  9. Upsert Google Sheets em até 7 abas.
  10. Dispara webhook (se WEBHOOK_URL configurado).
  11. Persiste ongo_log.json.
"""

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from memoria_global import indexar_memoria_sync, registrar_execucao_lote_sync
from whatsapp_alert import alertar_falha, alertar_sem_localizacao

# Console do Windows usa cp1252 por padrão (fora de um terminal UTF-8 real ou
# quando a saída é redirecionada/piped, como no run_ongo_diario.bat) — vários
# prints deste módulo usam →/⚠/🔴/🚀 etc. e derrubam o processo com
# UnicodeEncodeError se não forçarmos UTF-8 aqui.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------

ENV_FILE   = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_FILE)

ONGO_USER   = os.getenv("ONGO_USER", "")
ONGO_PASS   = os.getenv("ONGO_PASS", "")
CREDS_PATH  = str(Path(__file__).parent / os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials.json"))
SHEET_ID    = os.getenv("GOOGLE_SHEET_ID", "")
WEBHOOK_URL = os.getenv("WEBHOOK_URL", "")

PAINEL_URL        = "https://painel.ongocargas.com.br/"
CARREGAMENTOS_URL = "https://painel.ongocargas.com.br/carregamentos"
AGENDAMENTOS_URL  = "https://painel.ongocargas.com.br/agendamentos"
LANCES_URL        = "https://painel.ongocargas.com.br/lances"
API_DETALHE_BASE  = "https://api.ongocargas.com.br/v2/api/CotacaoLicita/get/"

OUTPUT_FILE   = Path(__file__).parent / "ongo_log.json"
SCHEMA_FILE   = Path(__file__).parent / "schema.sql"
POLL_INTERVAL = 300  # segundos (5 minutos)

# ── Status ───────────────────────────────────────────────────────────────────

STATUS_CARGA = {0: "Em andamento", 1: "Concluída", 2: "Cancelada", 3: "Expirada"}

# M41 — mapeia statusDaCarga pro enum consolidado de liberacoes_ativas.status
# (ver backend/liberacoes_migration.sql / MILESTONES.md FASE 11). "Expirada"
# entra como "cancelado" por ora — não há distinção de negócio ainda entre as duas.
STATUS_LIBERACAO = {0: "liberado", 1: "zerado", 2: "cancelado", 3: "cancelado"}

STATUS_AGENDAMENTO = {
    0: "Cancelado", 1: "Agendado", 2: "A caminho", 3: "Chegou",
    4: "Em carregamento", 10: "No terminal", 11: "Carregado", 12: "Saiu", 13: "Entregue",
}

_STATUS_ATIVOS     = {1, 2, 3, 4, 10}
_STATUS_CONCLUIDOS = {11, 12}

# ── Aba Carregamentos ────────────────────────────────────────────────────────

OUTPUT_COLUMNS = [
    "Data Captura", "Empresa", "Município Origem", "Terminal Origem/Localização",
    "Origem", "Destino", "Produto", "Quantidade (KG)", "Saldo Restante (KG)",
    "Valor Proposto (R$/Tonelada)", "Link/ID Carga", "Status",
]
COL_WIDTHS = [140, 180, 140, 160, 220, 220, 160, 130, 130, 190, 110, 120]

# ── Aba Agendamentos ─────────────────────────────────────────────────────────

AGEND_COLUMNS = [
    "Data Captura", "ID Cotação", "Empresa", "Terminal Origem", "Produto", "Destino",
    "Placa", "Motorista", "Transportadora", "Tipo Caminhão",
    "Volume Agendado (KG)", "Peso Carregado (KG)", "Status",
    "Data/Hora Agendada", "Check-in", "Reagendado",
]
AGEND_COL_WIDTHS = [130, 90, 180, 180, 130, 200, 90, 180, 180, 160, 140, 140, 130, 140, 70, 80]

# ── Aba Sem Localização (M32) ───────────────────────────────────────────────

SEM_LOCALIZACAO_COLUMNS = ["Data Captura", "ID Frete", "ID Caminhão", "Último Ping", "Status Frete"]
SEM_LOCALIZACAO_COL_WIDTHS = [130, 90, 100, 160, 120]

# ── Aba Descarregamentos / Compliance (M34) ─────────────────────────────────

DESCARGA_COLUMNS = [
    "Cotação", "Transportadora", "Motorista", "Placas", "Origem", "Carregamento",
    "Destino", "Peso Descarregado (KG)", "Data Descarga",
    "Desligou Localização", "Substituiu Foto", "Tem Foto",
]
DESCARGA_COL_WIDTHS = [90, 180, 160, 140, 200, 140, 200, 150, 140, 130, 120, 90]

# ── Aba Aderência ────────────────────────────────────────────────────────────

ADER_COLUMNS = [
    "Empresa", "Produto", "Origem → Destino", "Saldo Real (KG)",
    "Vol. Comprometido (KG)", "Saldo Projetado (KG)",
    "Agendados", "A Caminho", "No Terminal", "Carregados", "Atrasados",
    "Aderência (%)", "ID Cotação",
]
ADER_COL_WIDTHS = [180, 130, 280, 130, 160, 140, 80, 80, 90, 90, 80, 100, 90]

# ── Aba Análise por Oferta ───────────────────────────────────────────────────

OFERTA_COLUMNS = [
    "Data Entrada Ongo",
    "Dias Ativo",
    "ID Cotação",
    "Empresa",
    "Produto",
    "Rota",
    "Observação",
    "KG Total (ton)",
    "KG Comprometido (ton)",
    "KG Carregado (ton)",
    "KG Restante (ton)",
    "% Aderência",
    "Agendamentos",
    "Caminhões a Caminho",
    "Status",
    "Contrato Comercial",
    "Cód. Venda",
]
OFERTA_COL_WIDTHS = [140, 80, 90, 180, 130, 280, 220, 120, 140, 120, 120, 100, 90, 130, 110, 140, 110]

# ── Aba Histórico (append-only) ──────────────────────────────────────────────

HIST_COLUMNS = [
    "Data Captura",
    "ID Cotação",
    "Empresa",
    "Produto",
    "Rota",
    "KG Total",
    "KG Restante",
    "KG Comprometido",
    "KG Carregado",
    "% Completado",
    "Qtd A Caminho",
    "Status",
    "Data Entrada Ongo",
]
HIST_COL_WIDTHS = [130, 90, 180, 130, 280, 120, 120, 130, 120, 100, 110, 110, 140]

# ── Aba Análise Mensal ───────────────────────────────────────────────────────

MENSAL_COLUMNS = [
    "Mês",
    "Ofertas Liberadas",
    "KG Total Liberado (ton)",
    "KG Comprometido (ton)",
    "KG Carregado (ton)",
    "KG Restante (ton)",
    "% Aderência Geral",
    "Concluídas",
    "Em Andamento",
    "Canceladas",
]
MENSAL_COL_WIDTHS = [110, 130, 160, 150, 140, 130, 130, 100, 110, 100]

# ── Aba Lances ───────────────────────────────────────────────────────────────

LANCES_COLUMNS = [
    "Data Captura", "ID Cotação", "Embarcador", "Produto", "Rota",
    "Valor Lance (R$/Ton)", "Status Lance", "Transportadora", "Data Lance",
]
LANCES_COL_WIDTHS = [130, 90, 180, 130, 280, 160, 130, 200, 140]

# ── Aba AUDITORIA ────────────────────────────────────────────────────────────

AUDIT_COLUMNS = [
    "Categoria", "Métrica / Rota", "Valor Atual",
    "Impacto Estimado", "Prioridade", "Ação CRM Recomendada",
]
AUDIT_COL_WIDTHS = [170, 300, 170, 190, 100, 320]

# ---------------------------------------------------------------------------
# Utilitários
# ---------------------------------------------------------------------------

def _ts(fmt: str = "%H:%M") -> str:
    return datetime.now().strftime(fmt)


def _safe_num(v) -> float:
    return v if v is not None else 0


def _validate_env() -> None:
    missing = [k for k, v in {"ONGO_USER": ONGO_USER, "ONGO_PASS": ONGO_PASS}.items() if not v]
    if missing:
        print(f"[ERRO] Variáveis ausentes no .env: {', '.join(missing)}")
        sys.exit(1)
    if not SHEET_ID:
        print("[ERRO] GOOGLE_SHEET_ID não definido no .env.")
        sys.exit(1)


def _fmt_br(v, decimals: int = 3) -> str:
    if v is None:
        return ""
    return f"{v:,.{decimals}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _fmt_ton(kg) -> str:
    """Converte KG → toneladas com 3 casas, formato BR."""
    if kg is None:
        return ""
    return _fmt_br(kg / 1000, 3)


def _strip_code_prefix(nome: str) -> str:
    if not nome:
        return nome
    parts = nome.split("-", 1)
    if len(parts) == 2 and parts[0].strip().isdigit():
        return parts[1].strip()
    return nome


def _fmt_dt(dt_str: str) -> str:
    if not dt_str:
        return ""
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y %H:%M")
    except Exception:
        return dt_str[:16]


def _is_atrasado(dt_str: str, now: datetime) -> bool:
    if not dt_str:
        return False
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt < now
    except Exception:
        return False


def _dias_ativos(first_seen_str: str) -> int:
    if not first_seen_str:
        return 0
    try:
        dt = datetime.strptime(first_seen_str, "%d/%m/%Y %H:%M")
        return (datetime.now() - dt).days
    except Exception:
        return 0


def _mes_de(first_seen_str: str) -> str:
    if not first_seen_str:
        return "Desconhecido"
    try:
        dt = datetime.strptime(first_seen_str, "%d/%m/%Y %H:%M")
        meses = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
                 "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
        return f"{meses[dt.month - 1]}/{dt.year}"
    except Exception:
        return "Desconhecido"


def _load_previous_state() -> tuple:
    if OUTPUT_FILE.exists():
        try:
            data = json.loads(OUTPUT_FILE.read_text(encoding="utf-8"))
            ids = {
                str(r.get("Link/ID Carga", ""))
                for r in data.get("mapped", [])
                if r.get("Link/ID Carga")
            }
            valor_cache       = {str(k): v for k, v in data.get("valor_cache", {}).items()}
            terminal_cache    = {
                str(k): v for k, v in data.get("terminal_cache", {}).items()
                if isinstance(v, dict)
            }
            first_seen_cache  = {str(k): v for k, v in data.get("first_seen_cache", {}).items()}
            historico_seen    = {str(k): v for k, v in data.get("historico_seen", {}).items()}
            return ids, valor_cache, terminal_cache, first_seen_cache, historico_seen
        except Exception:
            pass
    return set(), {}, {}, {}, {}


# ---------------------------------------------------------------------------
# Mapeamento API → linhas da planilha
# ---------------------------------------------------------------------------

def _terminal_cell(term: dict | None, nome_origem: str = "") -> str:
    if not isinstance(term, dict):
        return ""
    label = _strip_code_prefix(nome_origem) or term.get("loc", "")
    lat, lng = term.get("lat"), term.get("lng")
    if lat and lng:
        url = f"https://www.google.com/maps?q={lat},{lng}"
        return f'=HYPERLINK("{url}";"{label}")'
    return label


def _map_api_record(item: dict, timestamp: str, valor_cache: dict, terminal_cache: dict) -> dict:
    carga_id    = str(item.get("idCotacao", ""))
    carga_total = item.get("cargaTotal")
    peso_rest   = item.get("pesoRestante")
    status_code = item.get("statusDaCarga", 0)
    valor       = valor_cache.get(carga_id)
    valor_fmt   = f"{_fmt_br(valor, 2)} R$/Ton" if valor is not None else ""

    return {
        "Data Captura":                  timestamp,
        "Empresa":                       item.get("donoDaCarga", ""),
        "Município Origem":              item.get("municipio_Origem", ""),
        "Terminal Origem/Localização":   _terminal_cell(terminal_cache.get(carga_id), item.get("origem", "")),
        "Origem":                        item.get("origem", ""),
        "Destino":                       item.get("destino", ""),
        "Produto":                       item.get("produto", ""),
        "Quantidade (KG)":               _fmt_br(carga_total, 3) if carga_total is not None else "",
        "Saldo Restante (KG)":           _fmt_br(peso_rest, 3) if peso_rest is not None else "",
        "Valor Proposto (R$/Tonelada)":  valor_fmt,
        "Link/ID Carga":                 carga_id,
        "Status":                        STATUS_CARGA.get(status_code, str(status_code)),
    }


def _map_agendamento(item: dict, terminal_nome: str, timestamp: str) -> dict:
    status_code = item.get("status", 0)
    peso_carr   = item.get("pesoCarregado")
    vol_janela  = item.get("volumeJanela")
    return {
        "Data Captura":          timestamp,
        "ID Cotação":            str(item.get("idCotacao", "")),
        "Empresa":               item.get("nomeDonoCarga", ""),
        "Terminal Origem":       terminal_nome,
        "Produto":               item.get("produto", ""),
        "Destino":               _strip_code_prefix(item.get("destino", "")),
        "Placa":                 item.get("placa", ""),
        "Motorista":             item.get("nomeMotorista", ""),
        "Transportadora":        item.get("transportadora", ""),
        "Tipo Caminhão":         item.get("nomeTipoCaminhao", ""),
        "Volume Agendado (KG)":  _fmt_br(vol_janela, 3) if vol_janela is not None else "",
        "Peso Carregado (KG)":   _fmt_br(peso_carr, 3) if peso_carr is not None else "",
        "Status":                STATUS_AGENDAMENTO.get(status_code, str(status_code)),
        "Data/Hora Agendada":    _fmt_dt(item.get("dataHoraCarregamento", "")),
        "Check-in":              "Sim" if item.get("checkIn") else "Não",
        "Reagendado":            "Sim" if item.get("reagendado") else "Não",
    }


def _map_oferta_analysis(item: dict, agend_idx: dict, first_seen_cache: dict, timestamp: str) -> dict:
    """Monta linha da aba Análise por Oferta — uma linha por cotação.

    Métrica de progresso usa pesoRestante como fonte de verdade histórica:
    - /agendamentos só mostra ativos no momento; entregas já concluídas não aparecem mais
    - cargaTotal - pesoRestante = tudo que foi efetivamente alocado/carregado ao longo do tempo
    """
    carga_id    = str(item.get("idCotacao", ""))
    carga_total = _safe_num(item.get("cargaTotal"))
    peso_rest   = _safe_num(item.get("pesoRestante"))
    status_code = item.get("statusDaCarga", 0)

    agends  = agend_idx.get(carga_id, [])
    em_rota = [a for a in agends if a.get("status") == 2]

    # KG Alocado histórico = saldo consumido (inclui entregas já concluídas + ativos atuais)
    # Fonte mais confiável: pesoRestante atualiza a cada entrega física
    kg_alocado   = carga_total - peso_rest
    pct_concluido = (kg_alocado / carga_total * 100) if carga_total > 0 else 0.0

    # KG em agendamento ativo agora (sub-set visível na API)
    kg_em_agend_ativo = sum(_safe_num(a.get("volumeJanela")) for a in agends)

    rota = (
        f"{_strip_code_prefix(item.get('origem',''))} → "
        f"{_strip_code_prefix(item.get('destino',''))}"
    )
    first_seen = first_seen_cache.get(carga_id, "")

    return {
        "Data Entrada Ongo":       first_seen,
        "Dias Ativo":              _dias_ativos(first_seen),
        "ID Cotação":              carga_id,
        "Empresa":                 item.get("donoDaCarga", ""),
        "Produto":                 item.get("produto", ""),
        "Rota":                    rota,
        "Observação":              (item.get("observacao", "") or "").replace("\n", " | "),
        "KG Total (ton)":          _fmt_ton(carga_total),
        "KG Comprometido (ton)":   _fmt_ton(kg_alocado) if kg_alocado != 0 else "",
        "KG Carregado (ton)":      _fmt_ton(kg_em_agend_ativo) if kg_em_agend_ativo else "",
        "KG Restante (ton)":       _fmt_ton(peso_rest),
        "% Aderência":             round(pct_concluido, 1) if pct_concluido else "",
        "Agendamentos":            len(agends),
        "Caminhões a Caminho":     len(em_rota),
        "Status":                  STATUS_CARGA.get(status_code, str(status_code)),
        "Contrato Comercial":      item.get("contratoComercial", ""),
        "Cód. Venda":              item.get("codigoVenda", ""),
    }


def _compute_historico_rows(fretes: list, agend_idx: dict, first_seen_cache: dict,
                             historico_seen: dict, today: str, timestamp: str) -> list:
    """Retorna linhas para adicionar ao Histórico — uma por cotação ainda não registrada hoje."""
    rows = []
    for item in fretes:
        cid = str(item.get("idCotacao", ""))
        if historico_seen.get(cid) == today:
            continue  # já registrada hoje

        carga_total     = _safe_num(item.get("cargaTotal"))
        peso_rest       = _safe_num(item.get("pesoRestante"))
        kg_comprometido = carga_total - peso_rest  # saldo histórico consumido (fonte: pesoRestante)
        agends          = agend_idx.get(cid, [])
        kg_carregado    = sum(_safe_num(a.get("volumeJanela")) for a in agends)  # ativo visível agora
        pct             = (kg_comprometido / carga_total * 100) if carga_total > 0 else 0
        em_rota_count   = sum(1 for a in agends if a.get("status") == 2)
        status_code     = item.get("statusDaCarga", 0)
        rota = (
            f"{_strip_code_prefix(item.get('origem',''))} → "
            f"{_strip_code_prefix(item.get('destino',''))}"
        )

        rows.append({
            "Data Captura":       timestamp,
            "ID Cotação":         cid,
            "Empresa":            item.get("donoDaCarga", ""),
            "Produto":            item.get("produto", ""),
            "Rota":               rota,
            "KG Total":           _fmt_br(carga_total, 3) if carga_total else "",
            "KG Restante":        _fmt_br(peso_rest, 3),
            "KG Comprometido":    _fmt_br(kg_comprometido, 3) if kg_comprometido != 0 else "",
            "KG Carregado":       _fmt_br(kg_carregado, 3) if kg_carregado else "",
            "% Completado":       round(pct, 1) if pct else "",
            "Qtd A Caminho":      em_rota_count,
            "Status":             STATUS_CARGA.get(status_code, str(status_code)),
            "Data Entrada Ongo":  first_seen_cache.get(cid, ""),
        })
        historico_seen[cid] = today  # marca como registrada hoje

    return rows


def _compute_analise_mensal(fretes: list, agend_idx: dict, first_seen_cache: dict) -> list:
    """Agrupa ofertas por mês de entrada e calcula métricas acumuladas."""
    mensal: dict = {}

    for item in fretes:
        cid         = str(item.get("idCotacao", ""))
        first_seen  = first_seen_cache.get(cid, "")
        mes         = _mes_de(first_seen)
        status_code = item.get("statusDaCarga", 0)

        carga_total     = _safe_num(item.get("cargaTotal"))
        peso_rest       = _safe_num(item.get("pesoRestante"))
        kg_comprometido = carga_total - peso_rest  # histórico real via pesoRestante
        agends          = agend_idx.get(cid, [])
        kg_carregado    = sum(_safe_num(a.get("volumeJanela")) for a in agends)  # ativos visíveis

        if mes not in mensal:
            mensal[mes] = {
                "_sort":            first_seen[:7] if first_seen else "0",
                "Mês":              mes,
                "Ofertas Liberadas": 0,
                "_kg_total":        0,
                "_kg_comprom":      0,
                "_kg_carregado":    0,
                "_kg_rest":         0,
                "Concluídas":       0,
                "Em Andamento":     0,
                "Canceladas":       0,
            }

        m = mensal[mes]
        m["Ofertas Liberadas"]  += 1
        m["_kg_total"]          += carga_total
        m["_kg_comprom"]        += kg_comprometido
        m["_kg_carregado"]      += kg_carregado
        m["_kg_rest"]           += peso_rest
        if status_code == 1:
            m["Concluídas"] += 1
        elif status_code == 0:
            m["Em Andamento"] += 1
        else:
            m["Canceladas"] += 1

    rows = []
    for m in sorted(mensal.values(), key=lambda x: x["_sort"], reverse=True):
        kg_t = m["_kg_total"]
        kg_c = m["_kg_carregado"]
        ader = (kg_c / m["_kg_comprom"] * 100) if m["_kg_comprom"] > 0 else 0
        rows.append({
            "Mês":                      m["Mês"],
            "Ofertas Liberadas":         m["Ofertas Liberadas"],
            "KG Total Liberado (ton)":   _fmt_ton(kg_t),
            "KG Comprometido (ton)":     _fmt_ton(m["_kg_comprom"]) if m["_kg_comprom"] else "",
            "KG Carregado (ton)":        _fmt_ton(kg_c) if kg_c else "",
            "KG Restante (ton)":         _fmt_ton(m["_kg_rest"]),
            "% Aderência Geral":         round(ader, 1) if ader else "",
            "Concluídas":                m["Concluídas"],
            "Em Andamento":              m["Em Andamento"],
            "Canceladas":                m["Canceladas"],
        })
    return rows


def _compute_aderencia(fretes: list, grupos: list, timestamp: str) -> list:
    agend_idx: dict = {}
    for grupo in grupos:
        terminal_nome = _strip_code_prefix(grupo.get("terminal", {}).get("nome", ""))
        for a in grupo.get("agendamentos", []):
            cid = str(a.get("idCotacao", ""))
            if cid:
                a["_terminal"] = terminal_nome
                agend_idx.setdefault(cid, []).append(a)

    now  = datetime.now(tz=timezone.utc)
    rows = []

    for frete in fretes:
        cid = str(frete.get("idCotacao", ""))
        if frete.get("statusDaCarga", 0) != 0:
            continue
        agends = agend_idx.get(cid, [])
        if not agends:
            continue

        ativos     = [a for a in agends if a.get("status") in _STATUS_ATIVOS]
        concluidos = [a for a in agends if a.get("status") in _STATUS_CONCLUIDOS]

        vol_comprometido = sum(_safe_num(a.get("volumeJanela")) for a in ativos)
        vol_carregado    = sum(_safe_num(a.get("pesoCarregado")) for a in concluidos)
        vol_agend_concl  = sum(_safe_num(a.get("volumeJanela")) for a in concluidos)
        saldo_real       = _safe_num(frete.get("pesoRestante"))
        saldo_projetado  = saldo_real - vol_comprometido
        atrasados        = sum(1 for a in ativos if _is_atrasado(a.get("dataHoraCarregamento", ""), now))
        aderencia        = (vol_carregado / vol_agend_concl * 100) if vol_agend_concl > 0 else 0.0

        def cnt(s_set):
            return sum(1 for a in agends if a.get("status") in s_set)

        rows.append({
            "Empresa":                frete.get("donoDaCarga", ""),
            "Produto":                frete.get("produto", ""),
            "Origem → Destino":       f"{_strip_code_prefix(frete.get('origem',''))} → {_strip_code_prefix(frete.get('destino',''))}",
            "Saldo Real (KG)":        _fmt_br(saldo_real, 3),
            "Vol. Comprometido (KG)": _fmt_br(vol_comprometido, 3),
            "Saldo Projetado (KG)":   _fmt_br(saldo_projetado, 3),
            "Agendados":              cnt({1}),
            "A Caminho":              cnt({2}),
            "No Terminal":            cnt({3, 4, 10}),
            "Carregados":             cnt(_STATUS_CONCLUIDOS),
            "Atrasados":              atrasados,
            "Aderência (%)":          round(aderencia, 1),
            "ID Cotação":             cid,
        })

    rows.sort(key=lambda r: r.get("Saldo Real (KG)", ""), reverse=True)
    return rows


# ---------------------------------------------------------------------------
# Playwright — navegação por abas
# ---------------------------------------------------------------------------

def _login(page) -> None:
    page.goto(PAINEL_URL, wait_until="networkidle")
    page.wait_for_url("**/acc.ongocargas.com.br/**", timeout=15_000)
    page.wait_for_selector(
        "input[name='Input.Username'], input[name='Username'], input[type='email']",
        timeout=10_000,
    )
    page.fill("input[name='Input.Username'], input[name='Username'], input[type='email']", ONGO_USER)
    page.fill("input[name='Input.Password'], input[name='Password'], input[type='password']", ONGO_PASS)
    page.click("button[type='submit'], input[type='submit']")
    page.wait_for_url(PAINEL_URL, timeout=20_000)
    try:
        page.wait_for_load_state("networkidle", timeout=30_000)
    except PlaywrightTimeoutError:
        pass


def _dismiss_popup(page) -> None:
    try:
        btn = page.locator("text=Depois")
        btn.wait_for(timeout=3_000)
        btn.click()
        page.wait_for_timeout(500)
    except PlaywrightTimeoutError:
        pass


def _fetch_lista(page) -> tuple:
    result   = {"items": []}
    api_hdrs = {}

    def _on_req(req):
        if "api.ongocargas.com.br" in req.url and not api_hdrs:
            for k, v in req.headers.items():
                if k.lower() in ("authorization", "ocp-apim-subscription-key"):
                    api_hdrs[k] = v

    def _on_resp(resp):
        if "Frete/all-with-cotacao" in resp.url:
            try:
                body  = resp.json()
                items = body.get("data", {}).get("data", [])
                if items:
                    result["items"] = items
            except Exception:
                pass

    page.on("request",  _on_req)
    page.on("response", _on_resp)
    page.goto(CARREGAMENTOS_URL, wait_until="networkidle")
    page.wait_for_timeout(2_000)
    _dismiss_popup(page)
    page.remove_listener("request",  _on_req)
    page.remove_listener("response", _on_resp)

    return result["items"], api_hdrs


def _fetch_valor_proposto(page, ids: list, api_headers: dict) -> tuple:
    if not ids:
        return {}, {}

    BATCH        = 30
    valor_map:    dict = {}
    terminal_map: dict = {}

    for i in range(0, len(ids), BATCH):
        batch = ids[i : i + BATCH]
        try:
            results = page.evaluate(
                """
                async ({ids, headers, baseUrl}) => {
                    return Promise.all(ids.map(id =>
                        fetch(baseUrl + id, {headers})
                            .then(r => r.json())
                            .then(d => {
                                const data = d && d.data;
                                const end  = data && data.percurso
                                             && data.percurso.terminalOrigem
                                             && data.percurso.terminalOrigem.endereco;
                                return {
                                    id,
                                    val:     (data && data.valorProposto != null) ? data.valorProposto : null,
                                    termLoc: end ? (end.cidade + (end.siglaEstado && end.siglaEstado !== '0' ? '/' + end.siglaEstado : '')) : null,
                                    lat:     end ? end.lat : null,
                                    lng:     end ? end.lng : null
                                };
                            })
                            .catch(() => ({id, val: null, termLoc: null}))
                    ));
                }
                """,
                {"ids": batch, "headers": api_headers, "baseUrl": API_DETALHE_BASE},
            )
            for r in results:
                sid = str(r["id"])
                if r.get("val") is not None:
                    valor_map[sid] = r["val"]
                if r.get("termLoc"):
                    terminal_map[sid] = {
                        "loc": r["termLoc"],
                        "lat": r.get("lat"),
                        "lng": r.get("lng"),
                    }
        except Exception as exc:
            print(f"  [AVISO] batch detalhe {i // BATCH + 1} falhou: {exc}")

    return valor_map, terminal_map


# ---------------------------------------------------------------------------
# M32 — Alerta "Sem Localização" (endpoint achado por exploração em 2026-07-08:
# v2/api/DashboardCargas/listagem-all-dashboard-geolocations, mesmo dado que
# alimenta o widget "Sem Localização" do Dashboard nativo do Ongo)
# ---------------------------------------------------------------------------

GEOLOCATIONS_URL = "https://api.ongocargas.com.br/v2/api/DashboardCargas/listagem-all-dashboard-geolocations"


def _fetch_geolocations(page) -> list:
    """Última posição conhecida por caminhão/frete ativo.

    Achado do diagnóstico 2026-07-08: esse endpoint é alimentado pelo widget
    "Cargas no Mapa" do próprio Dashboard — não dá pra replicar via fetch()
    manual com headers de auth crus (retorna 'success:true, data:[]' vazio,
    sem erro). Precisa escutar a resposta de verdade enquanto o Dashboard
    carrega, mesmo padrão de _fetch_lista() pro /carregamentos.
    """
    result = {"items": []}

    def _on_resp(resp):
        if "listagem-all-dashboard-geolocations" in resp.url:
            try:
                body = resp.json()
                items = body.get("data", [])
                if items:
                    result["items"] = items
            except Exception:
                pass

    page.on("response", _on_resp)
    try:
        page.goto(PAINEL_URL, wait_until="networkidle", timeout=15_000)
        page.wait_for_timeout(1_500)
    except PlaywrightTimeoutError:
        pass
    page.remove_listener("response", _on_resp)
    return result["items"]


def _detectar_sem_localizacao(geolocations: list) -> list:
    """Pega o ping mais recente por idFrete e retorna só os marcados isOffline
    pelo próprio Ongo — mesmo critério que o widget nativo usa, sem inventar
    limiar de horas por conta própria."""
    mais_recente: dict = {}
    for g in geolocations:
        idf = g.get("idFrete")
        if idf is None:
            continue
        atual = mais_recente.get(idf)
        if atual is None or (g.get("date") or "") > (atual.get("date") or ""):
            mais_recente[idf] = g
    return [g for g in mais_recente.values() if g.get("isOffline")]


def _map_sem_localizacao_rows(offline: list, timestamp: str) -> list:
    return [
        {
            "Data Captura":  timestamp,
            "ID Frete":      g.get("idFrete"),
            "ID Caminhão":   g.get("idCaminhao"),
            "Último Ping":   _fmt_dt(g.get("date") or ""),
            "Status Frete":  g.get("freteStatus"),
        }
        for g in offline
    ]


# ---------------------------------------------------------------------------
# M34 — Score de Compliance de Descarga (endpoint achado por exploração em
# 2026-07-08: v1/api/Frete/listagem-analise-descarga)
# ---------------------------------------------------------------------------

def _fetch_analise_descarga(page, api_headers: dict, dias: int = 4) -> list:
    """Análises de descarga (compliance) da janela dos últimos `dias` dias."""
    if not api_headers:
        return []
    fim = datetime.now(timezone.utc)
    ini = fim - timedelta(days=dias)
    url = (
        "https://api.ongocargas.com.br/v1/api/Frete/listagem-analise-descarga/"
        f"200/0/{ini.strftime('%Y-%m-%dT%H:%M')}/{fim.strftime('%Y-%m-%dT%H:%M')}/null/null/null/null"
    )
    try:
        data = page.evaluate(
            """
            async ({url, headers}) => {
                const r = await fetch(url, {headers});
                return r.json();
            }
            """,
            {"url": url, "headers": api_headers},
        )
        return (data.get("data") or {}).get("data", []) or []
    except Exception as exc:
        print(f"[LOG {_ts()}] ERRO ao buscar análise de descarga (M34): {exc}")
        return []


def _map_descarga_rows(registros: list) -> list:
    """Achata o array 'children' (1 descarga pode ter varios destinos) em
    linhas simples. Campos booleanos ficam Sim/Nao crus - sem inventar um
    score X/4 proprio, ja que nao confirmamos a formula exata que o portal usa."""
    rows = []
    for r in registros:
        origem = _strip_code_prefix(r.get("origem") or "")
        filhos = r.get("children") or [{}]
        for child in filhos:
            rows.append({
                "Cotação":                r.get("idCotacao"),
                "Transportadora":         r.get("transportadoraName"),
                "Motorista":              r.get("motoristaName"),
                "Placas":                 r.get("placas"),
                "Origem":                 origem,
                "Carregamento":           _fmt_dt(r.get("carregamento") or ""),
                "Destino":                _strip_code_prefix(child.get("destinoName") or ""),
                "Peso Descarregado (KG)": child.get("pesoDescarregado"),
                "Data Descarga":          _fmt_dt(child.get("dataDescarga") or ""),
                "Desligou Localização":   "Sim" if r.get("desligouLocalizacao") else "Não",
                "Substituiu Foto":        "Sim" if r.get("substituicaoFotoDescarga") else "Não",
                "Tem Foto":               "Sim" if child.get("fotoDescarregamento") else "Não",
            })
    return rows


def _upsert_descarregamentos(registros: list) -> None:
    """Grava snapshot no Supabase (ongo_descarregamentos) pra permitir score
    agregado por motorista/transportadora ao longo do tempo (M34)."""
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not supabase_url or not supabase_key or not registros:
        return
    try:
        from supabase import create_client
    except ImportError:
        return

    rows = []
    for r in registros:
        origem = _strip_code_prefix(r.get("origem") or "")
        for child in (r.get("children") or [{}]):
            id_destino = child.get("idFreteDestino")
            if id_destino is None:
                continue
            rows.append({
                "id_cotacao":            r.get("idCotacao"),
                "id_frete_destino":      id_destino,
                "transportadora":        r.get("transportadoraName"),
                "motorista":             r.get("motoristaName"),
                "placas":                r.get("placas"),
                "origem":                origem,
                "destino":               _strip_code_prefix(child.get("destinoName") or ""),
                "peso_descarregado_kg":  child.get("pesoDescarregado"),
                "data_descarga":         child.get("dataDescarga") or None,
                "desligou_localizacao":  bool(r.get("desligouLocalizacao")),
                "substituiu_foto":       bool(r.get("substituicaoFotoDescarga")),
                "tem_foto":              bool(child.get("fotoDescarregamento")),
            })
    if not rows:
        return
    try:
        client = create_client(supabase_url, supabase_key)
        client.table("ongo_descarregamentos").upsert(
            rows, on_conflict="id_cotacao,id_frete_destino",
        ).execute()
        print(f"[LOG {_ts()}] Supabase: {len(rows)} descarregamento(s) sincronizado(s) (M34).")
    except Exception as exc:
        print(f"[LOG {_ts()}] ERRO ao sincronizar ongo_descarregamentos: {exc}")


def _fetch_agendamentos(page) -> list:
    result = {"grupos": []}

    def _on_resp(resp):
        if "Agendamento/get-listagem" in resp.url:
            try:
                body = resp.json()
                data = body.get("data", [])
                if isinstance(data, list):
                    result["grupos"] = data
            except Exception:
                pass

    page.on("response", _on_resp)
    page.goto(AGENDAMENTOS_URL, wait_until="networkidle")
    page.wait_for_timeout(3_000)
    _dismiss_popup(page)
    page.remove_listener("response", _on_resp)

    total = sum(len(g.get("agendamentos", [])) for g in result["grupos"])
    print(f"[LOG {_ts()}] Aba /agendamentos: {total} agendamentos.")
    return result["grupos"]


def _fetch_lances(page) -> list:
    result = {"lances": []}

    def _on_resp(resp):
        url_lower = resp.url.lower()
        if "lance" in url_lower and "api.ongocargas" in url_lower:
            try:
                body = resp.json()
                data = body.get("data", body)
                if isinstance(data, list):
                    result["lances"].extend(data)
                elif isinstance(data, dict):
                    items = data.get("data", data.get("items", data.get("lances", [])))
                    if isinstance(items, list):
                        result["lances"].extend(items)
            except Exception:
                pass

    page.on("response", _on_resp)
    try:
        page.goto(LANCES_URL, wait_until="networkidle", timeout=15_000)
        page.wait_for_timeout(2_000)
        _dismiss_popup(page)
    except PlaywrightTimeoutError:
        print(f"[LOG {_ts()}] Aba /lances: timeout ou seção não disponível — continuando.")
    page.remove_listener("response", _on_resp)

    total = len(result["lances"])
    print(f"[LOG {_ts()}] Aba /lances: {total} lance(s).")
    return result["lances"]


def _map_lance(item: dict, timestamp: str) -> dict:
    val = item.get("valorLance", item.get("valor"))
    return {
        "Data Captura":          timestamp,
        "ID Cotação":            str(item.get("idCotacao", item.get("id", ""))),
        "Embarcador":            item.get("embarcador", item.get("donoDaCarga", "")),
        "Produto":               item.get("produto", ""),
        "Rota":                  f"{_strip_code_prefix(item.get('origem', ''))} → {_strip_code_prefix(item.get('destino', ''))}",
        "Valor Lance (R$/Ton)":  _fmt_br(val, 2) if val is not None else "",
        "Status Lance":          item.get("statusLance", item.get("status", "")),
        "Transportadora":        item.get("transportadora", ""),
        "Data Lance":            _fmt_dt(item.get("dataLance", item.get("dataCriacao", ""))),
    }


# ---------------------------------------------------------------------------
# AUDITORIA
# ---------------------------------------------------------------------------

def _gerar_auditoria(fretes: list, grupos: list, agend_idx: dict,
                     valor_cache: dict, timestamp: str) -> list:
    rows = []
    todos_agend = [a for g in grupos for a in g.get("agendamentos", [])]

    # BLOCO 1: Gargalos — saldo negativo
    negativos = [f for f in fretes if _safe_num(f.get("pesoRestante")) < 0]
    total_kg_neg = sum(abs(_safe_num(f.get("pesoRestante"))) for f in negativos)

    if negativos:
        rows.append({
            "Categoria":            "⚠ GARGALO — Saldo Negativo",
            "Métrica / Rota":       f"{len(negativos)} rota(s) com overbooking detectado",
            "Valor Atual":          f"{_fmt_br(total_kg_neg, 0)} KG em excesso",
            "Impacto Estimado":     "Risco de conflito contratual com embarcador",
            "Prioridade":           "ALTA",
            "Ação CRM Recomendada": "Acionar gestão para renegociação imediata dos contratos afetados.",
        })
        for f in sorted(negativos, key=lambda x: _safe_num(x.get("pesoRestante")))[:5]:
            saldo  = _safe_num(f.get("pesoRestante"))
            cid    = str(f.get("idCotacao", ""))
            val    = valor_cache.get(cid)
            impacto = abs(saldo) / 1000 * val if val else None
            rota   = f"{_strip_code_prefix(f.get('origem',''))} → {_strip_code_prefix(f.get('destino',''))}"
            rows.append({
                "Categoria":            "GARGALO — Detalhe",
                "Métrica / Rota":       rota,
                "Valor Atual":          f"{_fmt_br(saldo, 3)} KG",
                "Impacto Estimado":     f"≈ R$ {_fmt_br(impacto, 0)}" if impacto else "Verificar valor R$/ton",
                "Prioridade":           "ALTA",
                "Ação CRM Recomendada": f"Cotação ID {cid} — revisar capacidade comprometida vs. disponível.",
            })

    # BLOCO 2: Ociosidade
    ociosas = [
        f for f in fretes
        if f.get("statusDaCarga", 0) == 0 and not agend_idx.get(str(f.get("idCotacao", "")))
    ]
    total_ocioso_kg = sum(_safe_num(f.get("pesoRestante")) for f in ociosas)

    if ociosas:
        rows.append({
            "Categoria":            "🔴 OCIOSIDADE — Rotas sem Aceite",
            "Métrica / Rota":       f"{len(ociosas)} rota(s) ativas sem nenhum agendamento",
            "Valor Atual":          f"{_fmt_br(total_ocioso_kg, 0)} KG parados",
            "Impacto Estimado":     "Volume não monetizado — perda de receita por inatividade",
            "Prioridade":           "ALTA",
            "Ação CRM Recomendada": "Disparar oferta proativa via WhatsApp Business para transportadoras parceiras.",
        })
        for f in sorted(ociosas, key=lambda x: -_safe_num(x.get("pesoRestante")))[:5]:
            rota  = f"{_strip_code_prefix(f.get('origem',''))} → {_strip_code_prefix(f.get('destino',''))}"
            saldo = _safe_num(f.get("pesoRestante"))
            rows.append({
                "Categoria":            "OCIOSIDADE — Detalhe",
                "Métrica / Rota":       rota,
                "Valor Atual":          f"{_fmt_br(saldo, 3)} KG disponíveis",
                "Impacto Estimado":     "—",
                "Prioridade":           "MÉDIA",
                "Ação CRM Recomendada": "Incluir em campanha de captação automática N8N.",
            })

    # BLOCO 3: Comportamento de motoristas
    if todos_agend:
        total        = len(todos_agend)
        checkins     = sum(1 for a in todos_agend if a.get("checkIn"))
        reagendados  = sum(1 for a in todos_agend if a.get("reagendado"))
        cancelados   = sum(1 for a in todos_agend if a.get("status") == 0)
        taxa_checkin = checkins / total * 100 if total else 0
        taxa_reag    = reagendados / total * 100 if total else 0
        taxa_cancel  = cancelados / total * 100 if total else 0

        print(f"[AUDITORIA] Check-in: {taxa_checkin:.1f}% | Reagend.: {taxa_reag:.1f}% | Cancel.: {taxa_cancel:.1f}%")
        rows.append({
            "Categoria":            "👤 MOTORISTAS — Check-in",
            "Métrica / Rota":       f"Taxa de check-in: {taxa_checkin:.1f}%",
            "Valor Atual":          f"{checkins}/{total} realizados",
            "Impacto Estimado":     "Baixa aderência = risco de janelas ociosas no terminal",
            "Prioridade":           "ALTA" if taxa_checkin < 70 else "BAIXA",
            "Ação CRM Recomendada": "Automatizar lembrete WhatsApp 2h antes do horário." if taxa_checkin < 80 else "Boa aderência — manter monitoramento.",
        })
        if reagendados:
            rows.append({
                "Categoria":            "MOTORISTAS — Reagendamentos",
                "Métrica / Rota":       f"Taxa de reagendamento: {taxa_reag:.1f}%",
                "Valor Atual":          f"{reagendados} reagendamentos",
                "Impacto Estimado":     "Custo operacional por janelas bloqueadas",
                "Prioridade":           "MÉDIA",
                "Ação CRM Recomendada": "Score de confiabilidade por transportadora — penalizar recorrentes.",
            })
        if cancelados:
            rows.append({
                "Categoria":            "MOTORISTAS — Cancelamentos",
                "Métrica / Rota":       f"Taxa de cancelamento: {taxa_cancel:.1f}%",
                "Valor Atual":          f"{cancelados} cancelamento(s)",
                "Impacto Estimado":     "Recusa = rota exposta novamente sem receita",
                "Prioridade":           "ALTA" if taxa_cancel > 10 else "MÉDIA",
                "Ação CRM Recomendada": "Investigar padrão de recusa por rota — acionar SDR para substituição.",
            })

    # BLOCO 4: Eficiência de carregamento
    with_peso = [
        a for g in grupos for a in g.get("agendamentos", [])
        if a.get("pesoCarregado") is not None and a.get("volumeJanela")
    ]
    if with_peso:
        eficiencias = [
            a["pesoCarregado"] / a["volumeJanela"] * 100
            for a in with_peso if a["volumeJanela"] > 0
        ]
        media_ef = sum(eficiencias) / len(eficiencias) if eficiencias else 0
        print(f"[AUDITORIA] Eficiência média de carregamento: {media_ef:.1f}%")
        rows.append({
            "Categoria":            "📦 EFICIÊNCIA — Carregamento",
            "Métrica / Rota":       f"Eficiência média: {media_ef:.1f}%",
            "Valor Atual":          f"{len(with_peso)} viagens com dados de peso",
            "Impacto Estimado":     "Cada % abaixo de 100% = receita por subdeclaração de peso",
            "Prioridade":           "ALTA" if media_ef < 85 else "MÉDIA",
            "Ação CRM Recomendada": "Alerta para cargas < 80% — revisar capacidade declarada.",
        })

    # BLOCO 5: Taxas de aceite por produto
    produtos: dict = {}
    for f in fretes:
        prod = f.get("produto", "Sem produto")
        produtos.setdefault(prod, {"total": 0, "com_agend": 0})
        produtos[prod]["total"] += 1
        if agend_idx.get(str(f.get("idCotacao", ""))):
            produtos[prod]["com_agend"] += 1

    for prod, stats in sorted(produtos.items(), key=lambda x: -x[1]["total"])[:5]:
        taxa = stats["com_agend"] / stats["total"] * 100 if stats["total"] else 0
        print(f"[AUDITORIA] '{prod}': aceite {taxa:.0f}% ({stats['com_agend']}/{stats['total']})")
        rows.append({
            "Categoria":            "📊 ACEITE — Por Produto",
            "Métrica / Rota":       prod,
            "Valor Atual":          f"{taxa:.0f}% aceite ({stats['com_agend']}/{stats['total']} rotas)",
            "Impacto Estimado":     "Produto com baixo aceite = pouco interesse de mercado",
            "Prioridade":           "ALTA" if taxa < 30 else "BAIXA",
            "Ação CRM Recomendada": "Revisar precificação ou rota — considerar oferta ativa para transportadoras.",
        })

    # BLOCO 6: Oportunidades CRM
    print(f"[AUDITORIA] {len(rows) + 3} insight(s) gerado(s).")
    rows.append({
        "Categoria":            "🚀 CRM — Oportunidade",
        "Métrica / Rota":       "Renegociação automática — saldo negativo",
        "Valor Atual":          f"{len(negativos)} rota(s) com overbooking",
        "Impacto Estimado":     "Recuperação de margem em contratos revistos",
        "Prioridade":           "ALTA",
        "Ação CRM Recomendada": "N8N: saldo negativo → notificar SDR → revisão de contrato com embarcador.",
    })
    rows.append({
        "Categoria":            "CRM — Oportunidade",
        "Métrica / Rota":       "Captação ativa em rotas ociosas",
        "Valor Atual":          f"{len(ociosas)} rota(s) sem transportador",
        "Impacto Estimado":     "Volume não monetizado disponível",
        "Prioridade":           "ALTA",
        "Ação CRM Recomendada": "N8N: rota ociosa > 24h → oferta automática WhatsApp Business.",
    })
    rows.append({
        "Categoria":            "CRM — Inteligência de Mercado",
        "Métrica / Rota":       "Base de precificação histórica por rota",
        "Valor Atual":          f"{len(valor_cache)} cotações com R$/ton",
        "Impacto Estimado":     "Referência para benchmark e outliers de preço",
        "Prioridade":           "MÉDIA",
        "Ação CRM Recomendada": "Usar histórico de valores para sugerir preço competitivo automaticamente.",
    })

    return rows


# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------

def _dispatch_webhook(payload: dict) -> None:
    if not WEBHOOK_URL:
        return
    try:
        data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        req  = urllib.request.Request(
            WEBHOOK_URL,
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(f"[WEBHOOK] {resp.status} — {len(data)} bytes enviados.")
    except Exception as e:
        print(f"[WEBHOOK] Falha: {e}")


# ---------------------------------------------------------------------------
# Google Sheets
# ---------------------------------------------------------------------------

def _sheets_client():
    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("[ERRO] Execute: pip install gspread google-auth")
        sys.exit(1)

    creds_file = Path(CREDS_PATH)
    if not creds_file.exists():
        print(f"[ERRO] Credenciais não encontradas: '{CREDS_PATH}'")
        sys.exit(1)

    creds = Credentials.from_service_account_file(
        str(creds_file),
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
        ],
    )
    return gspread.authorize(creds)


def _get_or_create_ws(sh, name: str):
    import gspread
    try:
        return sh.worksheet(name), False
    except gspread.exceptions.WorksheetNotFound:
        return sh.add_worksheet(title=name, rows=5000, cols=30), True


def _format_ws_header(sh, ws, columns: list, col_widths: list,
                      bg_r: float = 0.10, bg_g: float = 0.40, bg_b: float = 0.65) -> None:
    col_letter = chr(ord("A") + len(columns) - 1)
    ws.format(f"A1:{col_letter}1", {
        "backgroundColor": {"red": bg_r, "green": bg_g, "blue": bg_b},
        "horizontalAlignment": "CENTER",
        "textFormat": {
            "bold": True, "fontSize": 10,
            "foregroundColor": {"red": 1, "green": 1, "blue": 1},
        },
    })
    sh.batch_update({"requests": [{"updateSheetProperties": {
        "properties": {"sheetId": ws.id, "gridProperties": {"frozenRowCount": 1}},
        "fields": "gridProperties.frozenRowCount",
    }}]})
    sh.batch_update({"requests": [
        {"updateDimensionProperties": {
            "range": {"sheetId": ws.id, "dimension": "COLUMNS",
                      "startIndex": i, "endIndex": i + 1},
            "properties": {"pixelSize": w},
            "fields": "pixelSize",
        }}
        for i, w in enumerate(col_widths)
    ]})


def _write_ws(ws, columns: list, data: list) -> None:
    rows = [[r.get(col, "") for col in columns] for r in data]
    ws.clear()
    ws.update([columns] + rows, value_input_option="USER_ENTERED")


def _append_historico_ws(sh, ws, is_new: bool, hist_rows: list) -> None:
    """Adiciona linhas ao Histórico sem apagar as existentes."""
    if is_new:
        ws.update([HIST_COLUMNS], value_input_option="USER_ENTERED")
        _format_ws_header(sh, ws, HIST_COLUMNS, HIST_COL_WIDTHS,
                          bg_r=0.20, bg_g=0.20, bg_b=0.45)
    if hist_rows:
        data_rows = [[r.get(col, "") for col in HIST_COLUMNS] for r in hist_rows]
        ws.append_rows(data_rows, value_input_option="USER_ENTERED")


def _push_to_sheets(mapped: list, mapped_agend: list, mapped_ader: list,
                    mapped_lances: list, mapped_oferta: list,
                    hist_rows: list, mensal_rows: list, audit_rows: list,
                    first_run: bool = False) -> None:
    if not mapped:
        return

    gc = _sheets_client()
    sh = gc.open_by_key(SHEET_ID)

    # Aba 1: Carregamentos
    ws1 = sh.sheet1
    if first_run:
        ws1.update_title("Carregamentos")
    _write_ws(ws1, OUTPUT_COLUMNS, mapped)
    if first_run:
        _format_ws_header(sh, ws1, OUTPUT_COLUMNS, COL_WIDTHS)

    # Aba 2: Agendamentos
    ws2, is_new2 = _get_or_create_ws(sh, "Agendamentos")
    _write_ws(ws2, AGEND_COLUMNS, mapped_agend)
    if first_run or is_new2:
        _format_ws_header(sh, ws2, AGEND_COLUMNS, AGEND_COL_WIDTHS)

    # Aba 3: Aderência
    ws3, is_new3 = _get_or_create_ws(sh, "Aderência")
    _write_ws(ws3, ADER_COLUMNS, mapped_ader)
    if first_run or is_new3:
        _format_ws_header(sh, ws3, ADER_COLUMNS, ADER_COL_WIDTHS)

    # Aba 4: Análise por Oferta — uma linha por cotação
    ws4, is_new4 = _get_or_create_ws(sh, "Análise por Oferta")
    _write_ws(ws4, OFERTA_COLUMNS, mapped_oferta)
    if first_run or is_new4:
        _format_ws_header(sh, ws4, OFERTA_COLUMNS, OFERTA_COL_WIDTHS,
                           bg_r=0.55, bg_g=0.27, bg_b=0.07)

    # Aba 5: Histórico — append-only
    ws5, is_new5 = _get_or_create_ws(sh, "Histórico")
    _append_historico_ws(sh, ws5, is_new5, hist_rows)

    # Aba 6: Análise Mensal
    if mensal_rows:
        ws6, is_new6 = _get_or_create_ws(sh, "Análise Mensal")
        _write_ws(ws6, MENSAL_COLUMNS, mensal_rows)
        if first_run or is_new6:
            _format_ws_header(sh, ws6, MENSAL_COLUMNS, MENSAL_COL_WIDTHS,
                               bg_r=0.10, bg_g=0.38, bg_b=0.15)

    # Aba 7: Lances (só cria se tiver dados)
    if mapped_lances:
        ws7, is_new7 = _get_or_create_ws(sh, "Lances")
        _write_ws(ws7, LANCES_COLUMNS, mapped_lances)
        if first_run or is_new7:
            _format_ws_header(sh, ws7, LANCES_COLUMNS, LANCES_COL_WIDTHS,
                               bg_r=0.13, bg_g=0.55, bg_b=0.13)

    # Aba 8: AUDITORIA
    if audit_rows:
        ws8, is_new8 = _get_or_create_ws(sh, "AUDITORIA")
        _write_ws(ws8, AUDIT_COLUMNS, audit_rows)
        if first_run or is_new8:
            _format_ws_header(sh, ws8, AUDIT_COLUMNS, AUDIT_COL_WIDTHS,
                               bg_r=0.07, bg_g=0.30, bg_b=0.07)

    n_hist = len(hist_rows)
    print(f"[LOG {_ts()}] Sheets atualizado — {n_hist} linha(s) nova(s) no Histórico.")


def _push_valor_transportadora_sheets(sem_localizacao_rows: list, descarga_rows: list) -> None:
    """Abas do FASE 10 (M32/M34) — full-refresh a cada ciclo, mesmo padrão das
    demais abas. Looker Studio conecta direto nessas abas pro dashboard (decisão
    2026-07-08, ver MILESTONES.md FASE 10)."""
    if not sem_localizacao_rows and not descarga_rows:
        return
    gc = _sheets_client()
    sh = gc.open_by_key(SHEET_ID)

    if sem_localizacao_rows:
        ws, is_new = _get_or_create_ws(sh, "Sem Localização")
        _write_ws(ws, SEM_LOCALIZACAO_COLUMNS, sem_localizacao_rows)
        if is_new:
            _format_ws_header(sh, ws, SEM_LOCALIZACAO_COLUMNS, SEM_LOCALIZACAO_COL_WIDTHS,
                               bg_r=0.60, bg_g=0.15, bg_b=0.15)

    if descarga_rows:
        ws, is_new = _get_or_create_ws(sh, "Descarregamentos")
        _write_ws(ws, DESCARGA_COLUMNS, descarga_rows)
        if is_new:
            _format_ws_header(sh, ws, DESCARGA_COLUMNS, DESCARGA_COL_WIDTHS,
                               bg_r=0.15, bg_g=0.30, bg_b=0.55)


# ---------------------------------------------------------------------------
# Schema Supabase
# ---------------------------------------------------------------------------

def _generate_schema() -> None:
    ts  = datetime.now().strftime("%d/%m/%Y %H:%M")
    sql = f"""\
-- schema.sql — Supabase / PostgreSQL — gerado em {ts}
-- Espelha no-grain-os/backend/ongo_geral_migration.sql (fonte de verdade da migração).

CREATE TABLE IF NOT EXISTS public.cargas_ongo (
    id                  BIGSERIAL    PRIMARY KEY,
    link_id_carga       TEXT         UNIQUE NOT NULL,
    data_captura        TIMESTAMPTZ  NOT NULL,
    empresa             TEXT,
    municipio_origem    TEXT,
    terminal_origem     TEXT,
    origem              TEXT,
    destino             TEXT,
    produto             TEXT,
    quantidade_kg       NUMERIC,
    saldo_restante_kg   NUMERIC,
    valor_proposto_ton  NUMERIC,
    status              TEXT,
    criado_em           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    atualizado_em       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cargas_ongo_status    ON public.cargas_ongo (status);
CREATE INDEX IF NOT EXISTS idx_cargas_ongo_municipio ON public.cargas_ongo (municipio_origem);
CREATE INDEX IF NOT EXISTS idx_cargas_ongo_empresa   ON public.cargas_ongo (empresa);

ALTER TABLE public.cargas_ongo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Leitura publica de cargas_ongo" ON public.cargas_ongo FOR SELECT USING (true);
"""
    SCHEMA_FILE.write_text(sql, encoding="utf-8")


# ---------------------------------------------------------------------------
# Supabase — sincronização de cargas_ongo (base para o dashboard M15)
# ---------------------------------------------------------------------------

def _upsert_cargas_ongo(fretes: list, valor_cache: dict, terminal_cache: dict, new_ids: set | None = None,
                         first_seen_cache: dict | None = None) -> None:
    """Sincroniza os lotes ativos com a tabela cargas_ongo (upsert por link_id_carga).

    Nunca deve derrubar o ciclo do Sheets (fonte de verdade atual) — qualquer
    falha aqui só é logada.
    """
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not supabase_url or not supabase_key:
        print(f"[LOG {_ts()}] SUPABASE_URL/SUPABASE_SERVICE_KEY ausentes no .env — pulando sync Supabase.")
        return

    try:
        from supabase import create_client
    except ImportError:
        print(f"[LOG {_ts()}] pacote 'supabase' não instalado (pip install supabase) — pulando sync Supabase.")
        return

    data_captura_iso = datetime.now(timezone.utc).isoformat()
    rows = []
    for item in fretes:
        carga_id = str(item.get("idCotacao", ""))
        if not carga_id:
            continue
        term  = terminal_cache.get(carga_id)
        label = _strip_code_prefix(item.get("origem", "")) or (term.get("loc", "") if isinstance(term, dict) else "")
        status_code = item.get("statusDaCarga", 0)
        rows.append({
            "link_id_carga":      carga_id,
            "data_captura":       data_captura_iso,
            "empresa":            item.get("donoDaCarga", ""),
            "municipio_origem":   item.get("municipio_Origem", ""),
            "terminal_origem":    label,
            "origem":             item.get("origem", ""),
            "destino":            item.get("destino", ""),
            "produto":            item.get("produto", ""),
            "quantidade_kg":      item.get("cargaTotal"),
            "saldo_restante_kg":  item.get("pesoRestante"),
            "valor_proposto_ton": valor_cache.get(carga_id),
            "status":             STATUS_CARGA.get(status_code, str(status_code)),
            "atualizado_em":      data_captura_iso,
            # Data em que a oferta apareceu no Ongo pela 1a vez (mesmo first_seen_cache
            # que ja alimenta a coluna "Data Entrada Ongo" do Historico, ver M15/M9) -
            # pedido do usuario 2026-07-08 pra analise tipo "liberou 13h dia X, carregou
            # tudo no mesmo dia". Formato cru (dd/mm/aaaa hh:mm), mesmo do cache.
            "data_entrada_ongo":  (first_seen_cache or {}).get(carga_id),
        })

    if not rows:
        return

    try:
        client = create_client(supabase_url, supabase_key)
        client.table("cargas_ongo").upsert(rows, on_conflict="link_id_carga").execute()

        # Remove lotes que sumiram da lista ativa do Ongo desde o ultimo ciclo -
        # achado real 2026-07-08: upsert nunca apagava, entao lote fechado/expirado
        # ficava fantasma pra sempre (Sheets tinha 128 linhas reais, Supabase tinha
        # 248 acumuladas desde 02/07 - 120 fantasmas). Mesmo comportamento
        # full-refresh que o Sheets ja tem (_write_ws faz ws.clear() a cada ciclo).
        ids_ativos = [r["link_id_carga"] for r in rows]
        del_resp = (
            client.table("cargas_ongo")
            .delete()
            .not_.in_("link_id_carga", ids_ativos)
            .execute()
        )
        n_removidos = len(del_resp.data or [])

        print(f"[LOG {_ts()}] Supabase: {len(rows)} lote(s) sincronizado(s) em cargas_ongo"
              f" ({n_removidos} fantasma(s) removido(s)).")
    except Exception as exc:
        print(f"[LOG {_ts()}] ERRO ao sincronizar cargas_ongo no Supabase: {exc}")
        # Achado 2026-07-09: essa falha ficava só no log, sem alerta — a coluna
        # data_entrada_ongo faltou ser migrada em produção e o sync ficou parado
        # 1 dia inteiro sem ninguém perceber (Sheets seguia OK, Torre defasada).
        alertar_falha("Ongo - sync cargas_ongo (Torre Ao Vivo)", str(exc))
        return

    # M27.1 — Cerebro Central: indexa só os lotes novos deste ciclo (lotes já
    # conhecidos já têm fragmento de uma execução anterior). Origem usa
    # municipio_origem (cidade real) e destino tem o código numérico removido —
    # texto de rota legível pro embedding, sem alterar cargas_ongo em si.
    if new_ids:
        novos = [r for r in rows if r["link_id_carga"] in new_ids]
        for row in novos:
            origem_memoria = row.get("municipio_origem") or _strip_code_prefix(row.get("origem", ""))
            destino_memoria = _strip_code_prefix(row.get("destino", ""))
            indexar_memoria_sync(
                fonte="ongo",
                identificador_origem=row["link_id_carga"],
                texto_resumo=f"Ongo {row.get('produto')}: {origem_memoria} para {destino_memoria} ({row.get('terminal_origem')})",
                entidade_cliente=row.get("empresa") or "",
            )
        if novos:
            print(f"[LOG {_ts()}] Cerebro Central: {len(novos)} fragmento(s) novo(s) indexado(s) em torre_memoria_global.")


# ---------------------------------------------------------------------------
# Supabase — M41: Ongo como fonte de liberacoes_ativas (Módulo Liberações & Aderência)
# ---------------------------------------------------------------------------

def _upsert_liberacoes_ativas(fretes: list, valor_cache: dict) -> None:
    """Remapeia o Ongo pro schema consolidado liberacoes_ativas (M40/M41).

    Não é uma captura nova — Ongo já flui via _upsert_cargas_ongo() (M15) — é
    normalização pro formato único que /torre/liberacoes (M42) e o matcher por
    ID (M43) vão consumir de todas as fontes (Ongo, BTG SMC, WhatsApp) da
    mesma forma. Mesma política de "nunca derruba o ciclo" que
    _upsert_cargas_ongo já segue — qualquer falha aqui só é logada.

    Tabela só existe depois da migration M40 (backend/liberacoes_migration.sql)
    ser aplicada manualmente pelo usuário no SQL Editor do Supabase — até lá,
    a falha de "tabela não existe" é esperada e não deve gerar alerta.
    """
    supabase_url = os.getenv("SUPABASE_URL", "")
    supabase_key = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not supabase_url or not supabase_key:
        return  # já logado por _upsert_cargas_ongo() no mesmo ciclo

    try:
        from supabase import create_client
    except ImportError:
        return  # já logado por _upsert_cargas_ongo() no mesmo ciclo

    atualizado_em_iso = datetime.now(timezone.utc).isoformat()
    rows = []
    for item in fretes:
        carga_id = str(item.get("idCotacao", ""))
        if not carga_id:
            continue
        status_code = item.get("statusDaCarga", 0)
        rows.append({
            "fonte":                    "ongo",
            "id_externo":               carga_id,
            "cliente":                  item.get("donoDaCarga", ""),
            "origem":                   item.get("origem", ""),
            "destino":                  item.get("destino", ""),
            "produto":                  item.get("produto", ""),
            "volume_total_kg":          item.get("cargaTotal"),
            "saldo_kg":                 item.get("pesoRestante"),
            "valor_tonelada":           valor_cache.get(carga_id),
            "status":                   STATUS_LIBERACAO.get(status_code, "liberado"),
            "ultima_atualizacao_fonte": "ongo_scraper",
            "atualizado_em":            atualizado_em_iso,
        })

    if not rows:
        return

    try:
        client = create_client(supabase_url, supabase_key)

        # Estado anterior a esta rodada (antes do upsert sobrescrever) — usado
        # tanto pela reconciliação de órfãos quanto pelo M50 (só dispara a
        # síntese de fechamento na transição liberado -> zerado/cancelado, uma
        # única vez por lote, nunca a cada ciclo em que ele já está fechado).
        anteriores = (
            client.table("liberacoes_ativas")
            .select("id_externo,status")
            .eq("fonte", "ongo")
            .execute()
        ).data or []
        status_anterior = {r["id_externo"]: r["status"] for r in anteriores}

        client.table("liberacoes_ativas").upsert(rows, on_conflict="fonte,id_externo").execute()
        print(f"[LOG {_ts()}] M41: {len(rows)} liberação(ões) sincronizada(s) em liberacoes_ativas.")

        ids_atuais = {r["id_externo"] for r in rows}
        fechados_agora = {
            r["id_externo"] for r in rows
            if r["status"] in ("zerado", "cancelado") and status_anterior.get(r["id_externo"]) == "liberado"
        }

        # Reconciliação (achado 2026-07-15): cargas que somem do pull atual do
        # Ongo (concluídas/canceladas do lado de lá) ficavam presas pra sempre
        # como "liberado" em liberacoes_ativas, porque o upsert só toca quem
        # ainda está no feed. Isso divergia a tela /torre/liberacoes do card
        # Frete Geral Ongo (167 vs 101 no dia do achado — 66 órfãos parados
        # desde 10-13/07). Marca como "zerado" (oferta encerrada) quem estava
        # "liberado" aqui mas não veio mais no pull de agora.
        orfaos = [id_ for id_, st in status_anterior.items() if st == "liberado" and id_ not in ids_atuais]
        if orfaos:
            client.table("liberacoes_ativas").update({
                "status":         "zerado",
                "atualizado_em":  atualizado_em_iso,
            }).eq("fonte", "ongo").in_("id_externo", orfaos).execute()
            print(f"[LOG {_ts()}] M41: {len(orfaos)} liberação(ões) encerrada(s) no Ongo marcada(s) como zerado.")
            fechados_agora.update(orfaos)

        # M50 — fechamento de lote gera fato histórico + alimenta os 2 RAGs
        # (historico_fechamentos/torre_memoria_global). Busca de novo do banco
        # em vez de reaproveitar `rows` porque órfãos não estão em `rows`, e
        # os dois caminhos (rows + órfãos) precisam dos campos de aderência do
        # M44 (frete_motorista_ton etc.), que só existem em liberacoes_ativas.
        if fechados_agora:
            lotes_fechados = (
                client.table("liberacoes_ativas")
                .select("*")
                .eq("fonte", "ongo")
                .in_("id_externo", list(fechados_agora))
                .execute()
            ).data or []
            for lote in lotes_fechados:
                registrar_execucao_lote_sync(lote)
            print(f"[LOG {_ts()}] M50: {len(lotes_fechados)} execução(ões) de lote registrada(s) (histórico + RAG).")
    except Exception as exc:
        print(f"[LOG {_ts()}] M41: liberacoes_ativas ainda indisponível (rode backend/liberacoes_migration.sql) — {exc}")


# ---------------------------------------------------------------------------
# Ciclo de extração
# ---------------------------------------------------------------------------

def run_cycle(cycle: int, page, known_ids: set,
              valor_cache: dict, terminal_cache: dict,
              first_seen_cache: dict, historico_seen: dict) -> tuple:
    timestamp = datetime.now().strftime("%d/%m/%Y %H:%M")
    today     = datetime.now().strftime("%Y-%m-%d")

    # 1. Carregamentos (lista principal)
    fretes, api_headers = _fetch_lista(page)
    if not fretes:
        raise RuntimeError("API retornou lista vazia — possível expiração de sessão.")

    # 2. Detalhes (valorProposto + terminal) para cotações sem cache
    missing_ids = [
        item["idCotacao"]
        for item in fretes
        if str(item["idCotacao"]) not in valor_cache
        or not isinstance(terminal_cache.get(str(item["idCotacao"])), dict)
    ]
    if missing_ids:
        print(f"[LOG {_ts()}] Buscando detalhes de {len(missing_ids)} cotação(ões)...")
        novos_valores, novos_terminais = _fetch_valor_proposto(page, missing_ids, api_headers)
        valor_cache.update(novos_valores)
        terminal_cache.update(novos_terminais)
        preenchidos = len(novos_valores)
        print(f"[LOG {_ts()}] {preenchidos} com valor | {len(missing_ids) - preenchidos} sem valor.")

    # 3. Registra primeira aparição (data de entrada no Ongo)
    current_ids = {str(item["idCotacao"]) for item in fretes}
    new_ids     = current_ids - known_ids

    # Backfill: primeiro ciclo com cache vazio — registra todas com data atual
    if not first_seen_cache and current_ids:
        for cid in current_ids:
            first_seen_cache[cid] = timestamp
        print(f"[LOG {_ts()}] first_seen_cache inicializado com {len(first_seen_cache)} cotações (data atual como referência base).")
    else:
        for cid in new_ids:
            if cid not in first_seen_cache:
                first_seen_cache[cid] = timestamp
                print(f"[LOG {_ts()}] Nova oferta detectada: ID {cid} → data entrada registrada.")

    # 4. Agendamentos
    print(f"[LOG {_ts()}] Navegando para /agendamentos...")
    grupos = _fetch_agendamentos(page)
    total_agend = sum(len(g.get("agendamentos", [])) for g in grupos)

    # Índice de agendamentos por cotação (usado em múltiplas análises)
    agend_idx: dict = {}
    for grupo in grupos:
        terminal_nome = _strip_code_prefix(grupo.get("terminal", {}).get("nome", ""))
        for a in grupo.get("agendamentos", []):
            cid = str(a.get("idCotacao", ""))
            if cid:
                a["_terminal"] = terminal_nome
                agend_idx.setdefault(cid, []).append(a)

    # 5. Lances
    print(f"[LOG {_ts()}] Navegando para /lances...")
    lances_raw = _fetch_lances(page)

    # 6. Mapeamentos principais
    mapped = [_map_api_record(item, timestamp, valor_cache, terminal_cache) for item in fretes]

    mapped_agend = [
        _map_agendamento(a, _strip_code_prefix(g.get("terminal", {}).get("nome", "")), timestamp)
        for g in grupos for a in g.get("agendamentos", [])
    ]

    mapped_ader = _compute_aderencia(fretes, grupos, timestamp)

    mapped_lances = [_map_lance(l, timestamp) for l in lances_raw]

    # 7. Análise por Oferta
    mapped_oferta = [
        _map_oferta_analysis(item, agend_idx, first_seen_cache, timestamp)
        for item in fretes
    ]
    # Ordena por dias ativo (mais antigas primeiro = mais urgentes)
    mapped_oferta.sort(key=lambda r: -r.get("Dias Ativo", 0))

    # 8. Histórico (append — uma linha por cotação por dia)
    hist_rows = _compute_historico_rows(fretes, agend_idx, first_seen_cache,
                                         historico_seen, today, timestamp)
    print(f"[LOG {_ts()}] Histórico: {len(hist_rows)} linha(s) nova(s) a registrar.")

    # 9. Análise Mensal
    mensal_rows = _compute_analise_mensal(fretes, agend_idx, first_seen_cache)
    print(f"[LOG {_ts()}] Análise Mensal: {len(mensal_rows)} mês(es).")

    # 10. AUDITORIA
    print(f"[LOG {_ts()}] Gerando AUDITORIA...")
    audit_rows = _gerar_auditoria(fretes, grupos, agend_idx, valor_cache, timestamp)

    # 11. Persiste log
    log = {
        "timestamp":         datetime.now().isoformat(),
        "cycle":             cycle,
        "rows_extracted":    len(fretes),
        "new_cargas":        len(new_ids),
        "new_ids":           sorted(new_ids),
        "agendamentos":      total_agend,
        "aderencia_rows":    len(mapped_ader),
        "lances":            len(lances_raw),
        "auditoria_rows":    len(audit_rows),
        "historico_added":   len(hist_rows),
        "mapped":            mapped,
        "valor_cache":       valor_cache,
        "terminal_cache":    terminal_cache,
        "first_seen_cache":  first_seen_cache,
        "historico_seen":    historico_seen,
    }
    OUTPUT_FILE.write_text(json.dumps(log, ensure_ascii=False, indent=2, default=str), encoding="utf-8")

    # 12. Google Sheets
    _push_to_sheets(mapped, mapped_agend, mapped_ader, mapped_lances,
                    mapped_oferta, hist_rows, mensal_rows, audit_rows,
                    first_run=(cycle == 1))

    # 12b. Supabase — sincroniza cargas_ongo (base do dashboard M15)
    _upsert_cargas_ongo(fretes, valor_cache, terminal_cache, new_ids, first_seen_cache)

    # 12b.2 — M41: mesma leitura (fretes/valor_cache), zero requisição extra ao
    # Ongo, remapeando pro schema consolidado do Módulo Liberações & Aderência.
    _upsert_liberacoes_ativas(fretes, valor_cache)

    # 12c. M32/M34 — Valor pra Transportadora (FASE 10, manual/sob demanda por
    # enquanto — decisão 2026-07-08, ver MILESTONES.md). Reaproveita api_headers
    # já capturado no passo 1 (_fetch_lista).
    try:
        geolocations = _fetch_geolocations(page)
        sem_localizacao = _detectar_sem_localizacao(geolocations)
        sem_localizacao_rows = _map_sem_localizacao_rows(sem_localizacao, timestamp)
        if sem_localizacao:
            print(f"[LOG {_ts()}] M32: {len(sem_localizacao)} caminhão(ões) sem localização.")
            alertar_sem_localizacao(sem_localizacao)

        descarga_registros = _fetch_analise_descarga(page, api_headers)
        descarga_rows = _map_descarga_rows(descarga_registros)
        _upsert_descarregamentos(descarga_registros)
        print(f"[LOG {_ts()}] M34: {len(descarga_rows)} linha(s) de descarregamento.")

        _push_valor_transportadora_sheets(sem_localizacao_rows, descarga_rows)
    except Exception as exc:
        print(f"[LOG {_ts()}] ERRO no bloco M32/M34 (não derruba o ciclo principal): {exc}")

    # 13. Webhook
    if WEBHOOK_URL:
        _dispatch_webhook({
            "timestamp":     timestamp,
            "cycle":         cycle,
            "total_cargas":  len(fretes),
            "novas_cargas":  len(new_ids),
            "agendamentos":  total_agend,
            "lances":        len(lances_raw),
            "auditoria":     audit_rows,
            "mensal":        mensal_rows,
        })

    return mapped, current_ids, new_ids, valor_cache, terminal_cache, first_seen_cache, historico_seen


# ---------------------------------------------------------------------------
# Loop principal
# ---------------------------------------------------------------------------

def main() -> None:
    _validate_env()

    sheet_url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}"
    print("=" * 60)
    print("  OCTAMOVE — Monitor de Cargas Ongo  [v5]")
    print(f"  Intervalo : {POLL_INTERVAL // 60} minutos")
    print(f"  Planilha  : {sheet_url}")
    print(f"  Webhook   : {WEBHOOK_URL or '(não configurado)'}")
    print(f"  Iniciado  : {_ts('%d/%m/%Y %H:%M')}")
    print("  Ctrl+C para encerrar.")
    print("=" * 60)

    _generate_schema()
    print(f"[LOG {_ts()}] schema.sql gerado/atualizado.")

    known_ids, valor_cache, terminal_cache, first_seen_cache, historico_seen = _load_previous_state()
    cycle = 0

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page    = browser.new_page()

        print(f"[LOG {_ts()}] Fazendo login...")
        _login(page)
        print(f"[LOG {_ts()}] Login OK. Browser ativo entre ciclos.")

        while True:
            cycle += 1
            print(f"\n[LOG {_ts()}] Iniciando varredura #{cycle}...")

            try:
                (mapped, current_ids, new_ids, valor_cache, terminal_cache,
                 first_seen_cache, historico_seen) = run_cycle(
                    cycle, page, known_ids, valor_cache, terminal_cache,
                    first_seen_cache, historico_seen,
                )
                known_ids = current_ids

                total   = len(mapped)
                new_cnt = len(new_ids)
                novidades = (
                    f"{new_cnt} nova(s): {', '.join(sorted(new_ids))}"
                    if new_cnt else "0 novas cargas"
                )
                print(
                    f"[LOG {_ts()}] Varredura #{cycle} OK — "
                    f"{total} cargas | {novidades} | "
                    f"Aguardando {POLL_INTERVAL // 60} min..."
                )

            except KeyboardInterrupt:
                print(f"\n[LOG {_ts()}] Encerrado pelo usuário.")
                break

            except RuntimeError as exc:
                print(f"[LOG {_ts()}] {exc} — aguardando 20s antes de tentar re-login...")
                # Pausa deliberada antes de relogar — sessao expirada seguida de re-login
                # IMEDIATO e o mesmo padrao (login logo apos outro) que causou fricção real
                # observada em 2026-07-08 (ver MILESTONES.md M38). Nao elimina o risco, so
                # evita empilhar tentativas rapidas sem necessidade.
                time.sleep(20)
                try:
                    _login(page)
                    print(f"[LOG {_ts()}] Re-login OK.")
                except Exception as login_exc:
                    print(f"[LOG {_ts()}] Falha no re-login: {login_exc}.")
                    alertar_falha("Ongo - monitor continuo (re-login)", str(login_exc))

            except Exception as exc:
                print(
                    f"[LOG {_ts()}] ERRO na varredura #{cycle}: {exc}. "
                    f"Próxima tentativa em {POLL_INTERVAL // 60} min..."
                )
                alertar_falha(f"Ongo - monitor continuo (varredura #{cycle})", str(exc))

            try:
                time.sleep(POLL_INTERVAL)
            except KeyboardInterrupt:
                print(f"\n[LOG {_ts()}] Encerrado pelo usuário.")
                break

        browser.close()


if __name__ == "__main__":
    main()
