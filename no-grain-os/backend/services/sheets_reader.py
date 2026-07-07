"""
Leitura da aba 'Carregamentos' da planilha Octamove - Cargas Ongo.
Usa OAuth2 (token_sheets.json) — somente leitura.
Fonte: ongo_geral
"""
import logging
import re
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from core.config import settings

logger = logging.getLogger(__name__)

SCOPES   = ["https://www.googleapis.com/auth/spreadsheets.readonly"]
ABA_NOME = "Carregamentos"

# Índices das colunas da aba Carregamentos
# A  B        C                D                            E       F        G        H               I                  J              K           L
# 0  1        2                3                            4       5        6        7               8                  9              10          11
# DC Empresa  Munic.Origem  Terminal Origem/Local.  Origem  Destino Produto  Qtd(KG)  Saldo(KG)  R$/Ton  Link/ID  Status
COL = {
    "data_captura":  0,
    "empresa":       1,
    "municipio":     2,
    "terminal":      3,
    "origem_raw":    4,
    "destino_raw":   5,
    "produto":       6,
    "quantidade_kg": 7,
    "valor_raw":     9,
    "id_carga":      10,
    "status":        11,
}

_ONGO_ID_RE = re.compile(r"^\d{10}-(.+)$")


def _get_service():
    token_path = Path(settings.GOOGLE_SHEETS_TOKEN_PATH)
    if not token_path.exists():
        raise FileNotFoundError(
            f"Token OAuth2 não encontrado: {token_path}. "
            "Execute: python autorizar_sheets.py"
        )
    creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        token_path.write_text(creds.to_json(), encoding="utf-8")
        logger.info("[SheetsReader] Token renovado.")
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _cell(row: list, idx: int) -> str:
    return row[idx].strip() if idx < len(row) else ""


def _parse_valor(raw: str) -> float:
    """'135,00 R$/Ton'  →  135.0"""
    clean = re.sub(r"[^\d,.]", "", raw).replace(".", "").replace(",", ".")
    try:
        return float(clean)
    except ValueError:
        return 0.0


def _parse_volume(raw_kg: str) -> str:
    """'1.500.000,00'  →  '1.500 t'"""
    clean = raw_kg.replace(".", "").replace(",", ".").strip()
    try:
        tons = float(clean) / 1000
        return f"{tons:,.0f} t".replace(",", ".")
    except ValueError:
        return raw_kg


def _extrair_nome(raw: str) -> str:
    """'0003001416-FAZENDA SANTA LUZIA'  →  'FAZENDA SANTA LUZIA'"""
    m = _ONGO_ID_RE.match(raw)
    return m.group(1).strip() if m else raw.strip()


def listar_fretes() -> list[dict]:
    """
    Lê aba 'Carregamentos' e retorna lista de fretes no formato CargaLogistica.
    fonte_ingestao = 'ongo_geral'
    """
    if not settings.GOOGLE_SHEET_ID:
        logger.warning("[SheetsReader] GOOGLE_SHEET_ID não configurado.")
        return []

    try:
        service = _get_service()

        resp = service.spreadsheets().values().get(
            spreadsheetId=settings.GOOGLE_SHEET_ID,
            range=f"{ABA_NOME}!A:L",
        ).execute()

        rows = resp.get("values", [])
        if len(rows) <= 1:
            logger.info("[SheetsReader] Aba vazia ou só cabeçalho.")
            return []

        fretes = []
        for row_num, row in enumerate(rows[1:], start=2):
            produto  = _cell(row, COL["produto"])
            terminal = _cell(row, COL["terminal"])
            municipio = _cell(row, COL["municipio"])

            if not produto and not terminal:
                continue  # linha vazia

            origem  = f"{terminal}, {municipio}" if terminal and municipio else (terminal or municipio)
            destino = _extrair_nome(_cell(row, COL["destino_raw"]))
            id_ongo = _cell(row, COL["id_carga"])

            fretes.append({
                "id":             id_ongo if id_ongo else f"ONG-{row_num}",
                "origem":         origem.title(),
                "destino":        destino.title(),
                "produto":        produto.title(),
                "tipo_veiculo":   "Não Especificado",
                "valor_tonelada": _parse_valor(_cell(row, COL["valor_raw"])),
                "volume_total":   _parse_volume(_cell(row, COL["quantidade_kg"])),
                "fonte_ingestao": "ongo_geral",
                "id_ongo":        id_ongo,
            })

        logger.info(f"[SheetsReader] {len(fretes)} fretes lidos de '{ABA_NOME}'.")
        return fretes

    except FileNotFoundError:
        raise
    except Exception as exc:
        logger.error(f"[SheetsReader] Erro: {exc}", exc_info=True)
        raise


# ─── Aba "Histórico" (append-only, escrita por extract_ongo.py) ────────────────

ABA_HISTORICO   = "Histórico"
COL_HISTORICO = [
    "Data Captura", "ID Cotação", "Empresa", "Produto", "Rota",
    "KG Total", "KG Restante", "KG Comprometido", "KG Carregado",
    "% Completado", "Qtd A Caminho", "Status", "Data Entrada Ongo",
]


def listar_historico(data_filtro: str) -> list[dict]:
    """
    Lê a aba 'Histórico' e retorna as linhas cuja 'Data Captura' (formato
    'DD/MM/YYYY HH:MM') bate com data_filtro ('DD/MM/YYYY').
    """
    if not settings.GOOGLE_SHEET_ID:
        logger.warning("[SheetsReader] GOOGLE_SHEET_ID não configurado.")
        return []

    try:
        service = _get_service()
        resp = service.spreadsheets().values().get(
            spreadsheetId=settings.GOOGLE_SHEET_ID,
            range=f"{ABA_HISTORICO}!A:M",
        ).execute()

        rows = resp.get("values", [])
        if len(rows) <= 1:
            return []

        resultado = []
        for row in rows[1:]:
            data_captura = _cell(row, 0)
            if not data_captura.startswith(data_filtro):
                continue
            resultado.append({
                col: _cell(row, idx) for idx, col in enumerate(COL_HISTORICO)
            })

        logger.info(f"[SheetsReader] Histórico: {len(resultado)} linha(s) para {data_filtro}.")
        return resultado

    except FileNotFoundError:
        raise
    except Exception as exc:
        logger.error(f"[SheetsReader] Erro ao ler Histórico: {exc}", exc_info=True)
        raise
