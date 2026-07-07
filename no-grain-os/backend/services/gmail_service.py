"""
Lê e-mails de cotação de frete do Gmail e injeta no Sheets.
Usa token_gmail.json gerado pela autorização OAuth2 local.
Mantém processed_gmail_ids.json para não reprocessar e-mails já tratados.
"""
import asyncio
import base64
import json
import logging
import re
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

from core.config import settings
from services.domain_map import resolver_gmail
from services.location_parser import resolver_coords_com_geocoding
from services.openai_service import extrair_dados_logisticos
from services.supabase_writer import inserir_frete

logger = logging.getLogger(__name__)

SCOPES          = ["https://www.googleapis.com/auth/gmail.readonly"]
TOKEN_PATH      = Path(settings.GMAIL_TOKEN_PATH)
SECRET_PATH     = Path(settings.GMAIL_SECRET_PATH)
PROCESSED_PATH  = Path("processed_gmail_ids.json")

# Filtra e-mails com conteúdo de frete — inclui SPAM (cotações legítimas caem lá)
# Usa OR no nível do assunto + palavras-chave no corpo para maior abrangência
_PALAVRAS = (
    "frete OR cotacao OR cotação OR carga OR oferta OR embarque OR "
    "logistica OR logística OR fretamento OR transportadora OR caminhao OR caminhão"
)
QUERY_GMAIL      = f"is:unread in:inbox ({_PALAVRAS})"
QUERY_GMAIL_SPAM = f"is:unread in:spam ({_PALAVRAS})"

MAX_POR_CICLO = 20  # máximo de e-mails processados por chamada


def _get_gmail_service():
    creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        TOKEN_PATH.write_text(creds.to_json(), encoding="utf-8")
        logger.info("[Gmail] Token renovado automaticamente.")
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _carregar_processados() -> set[str]:
    if PROCESSED_PATH.exists():
        try:
            return set(json.loads(PROCESSED_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    return set()


def _salvar_processados(ids: set[str]) -> None:
    PROCESSED_PATH.write_text(json.dumps(list(ids), indent=2), encoding="utf-8")


def _extrair_corpo(payload: dict) -> str:
    """Extrai texto plano do payload da mensagem Gmail (suporta multipart)."""
    mime = payload.get("mimeType", "")

    if mime == "text/plain":
        data = payload.get("body", {}).get("data", "")
        if data:
            return base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")

    if mime == "text/html":
        data = payload.get("body", {}).get("data", "")
        if data:
            html = base64.urlsafe_b64decode(data + "==").decode("utf-8", errors="ignore")
            return re.sub(r"<[^>]+>", " ", html)

    for part in payload.get("parts", []):
        texto = _extrair_corpo(part)
        if texto.strip():
            return texto

    return ""


def _extrair_assunto(headers: list[dict]) -> str:
    for h in headers:
        if h.get("name", "").lower() == "subject":
            return h.get("value", "")
    return ""


def _extrair_remetente(headers: list[dict]) -> str:
    for h in headers:
        if h.get("name", "").lower() == "from":
            raw = h.get("value", "")
            m = re.search(r'<([^>]+)>', raw)
            return m.group(1).lower() if m else raw.strip().lower()
    return ""


async def poll_gmail_fretes() -> dict:
    """
    Busca e-mails não lidos de cotação de frete, extrai dados logísticos
    e injeta no Google Sheets. Retorna sumário do ciclo.
    """
    logger.info("[Gmail] Iniciando ciclo de polling...")

    try:
        service     = _get_gmail_service()
        processados = _carregar_processados()
    except Exception as exc:
        logger.error(f"[Gmail] Falha ao iniciar serviço: {exc}")
        return {"status": "erro", "detalhe": str(exc)}

    # Busca inbox + spam (cotações legítimas frequentemente caem no spam)
    mensagens = []
    for query_label, query in [("inbox", QUERY_GMAIL), ("spam", QUERY_GMAIL_SPAM)]:
        try:
            result = service.users().messages().list(
                userId="me",
                q=query,
                maxResults=MAX_POR_CICLO,
            ).execute()
            encontrados = result.get("messages", [])
            logger.info(f"[Gmail] {len(encontrados)} e-mail(s) em {query_label}.")
            mensagens.extend(encontrados)
        except Exception as exc:
            logger.error(f"[Gmail] Falha ao listar {query_label}: {exc}")

    if not mensagens:
        logger.info("[Gmail] Nenhuma mensagem encontrada.")
        return {"status": "ok", "injetados": 0, "ignorados": 0, "erros": 0, "total_encontrados": 0}

    logger.info(f"[Gmail] Total combinado: {len(mensagens)} e-mail(s).")

    injetados  = 0
    ignorados  = 0
    erros      = 0
    novos_ids  = set()

    for msg_ref in mensagens:
        msg_id = msg_ref["id"]

        if msg_id in processados:
            ignorados += 1
            continue

        try:
            msg = service.users().messages().get(
                userId="me",
                id=msg_id,
                format="full",
            ).execute()
        except Exception as exc:
            logger.error(f"[Gmail] Falha ao obter mensagem {msg_id}: {exc}")
            erros += 1
            novos_ids.add(msg_id)  # marca como processado para não tentar de novo
            continue

        payload    = msg.get("payload", {})
        headers    = payload.get("headers", [])
        assunto    = _extrair_assunto(headers)
        remetente  = _extrair_remetente(headers)
        corpo      = _extrair_corpo(payload).strip()

        if not corpo:
            logger.warning(f"[Gmail] Mensagem {msg_id} sem corpo extraível — ignorando.")
            novos_ids.add(msg_id)
            ignorados += 1
            continue

        texto_completo = f"Assunto: {assunto}\n\n{corpo}"
        logger.info(f"[Gmail] Processando: '{assunto[:60]}' ({len(corpo)} chars)")

        try:
            carga = await extrair_dados_logisticos(texto_completo, "gmail_cotacao")
        except Exception as exc:
            logger.error(f"[Gmail] Falha OpenAI msg {msg_id}: {exc}")
            erros += 1
            novos_ids.add(msg_id)
            continue

        # Critério de cotação: origem/destino identificados — ignora nivel_confianca
        # (GPT-4o-mini é não-determinístico nesse campo; mesmo fix já aplicado no
        # classificador do WhatsApp, ver webhook_evolution.py).
        if carga.origem == "Não Especificado" or carga.destino == "Não Especificado":
            logger.info(f"[Gmail] Sem origem/destino — '{assunto[:40]}' — ignorando.")
            novos_ids.add(msg_id)
            ignorados += 1
            continue

        cliente, portal_origem = resolver_gmail(remetente)
        coords_coleta = await resolver_coords_com_geocoding(corpo)

        loop        = asyncio.get_event_loop()
        _mid        = msg_id  # captura para o closure do lambda
        registro_id = await loop.run_in_executor(
            None,
            lambda: inserir_frete(
                carga,
                cliente=cliente,
                portal_origem=portal_origem,
                coords_coleta=coords_coleta,
                gmail_message_id=_mid,
            ),
        )

        if registro_id is None:
            # Gravação falhou (rede, Supabase fora do ar, etc.) — NÃO marca como
            # processado, senão o e-mail some pra sempre sem nunca ser gravado.
            # Tenta de novo no próximo ciclo (1min).
            logger.error(f"[Gmail] Falha ao gravar msg {msg_id} no Supabase — será retentado no próximo ciclo.")
            erros += 1
            continue

        logger.info(
            f"[Gmail] Injetado id={registro_id} — {carga.produto} | "
            f"{carga.origem} -> {carga.destino} [{carga.nivel_confianca.upper()}] | cliente={cliente}"
        )
        novos_ids.add(msg_id)
        injetados += 1

    processados.update(novos_ids)
    _salvar_processados(processados)

    resumo = {
        "status": "ok",
        "injetados": injetados,
        "ignorados": ignorados,
        "erros": erros,
        "total_encontrados": len(mensagens),
    }
    logger.info(f"[Gmail] Ciclo concluído: {resumo}")
    return resumo
