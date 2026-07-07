import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.domain_map import resolver_whatsapp
from services.location_parser import resolver_coords_com_geocoding
from services.openai_service import extrair_dados_de_imagem, extrair_dados_logisticos
from services.supabase_writer import inserir_frete
from services.timeline_writer import salvar_mensagem_timeline

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["WhatsApp — Evolution API"])

EVOLUTION_URL  = "http://localhost:8080"
EVOLUTION_KEY  = "octamove_evolution_key_2025"
INSTANCIA      = "octamove"
GRUPOS_PERMITIDOS: dict[str, str] = {
    "120363410106462149@g.us": "Teste Fretes",
    "120363161423451430@g.us": "COA - Central Agrícola",
}


class EvolutionPayload(BaseModel):
    event: str | None = None
    data: dict[str, Any] | None = None


def _extrair_texto(message: dict) -> str:
    return (
        message.get("conversation")
        or message.get("extendedTextMessage", {}).get("text")
        or ""
    )


def _extrair_imagem(message: dict) -> dict | None:
    img = message.get("imageMessage")
    if img:
        return {"mimetype": img.get("mimetype", "image/jpeg"), "caption": img.get("caption", "")}
    return None


async def _baixar_imagem_base64(message_key: dict, message: dict) -> str:
    payload = {
        "message": {"key": message_key, "message": message},
        "convertToMp4": False,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{EVOLUTION_URL}/chat/getBase64FromMediaMessage/{INSTANCIA}",
            json=payload,
            headers={"apikey": EVOLUTION_KEY},
        )
        resp.raise_for_status()
        return resp.json().get("base64", "")


@router.post("/evolution")
async def receber_mensagem_whatsapp(payload: EvolutionPayload):
    data       = payload.data or {}
    key        = data.get("key", {})
    remote_jid = key.get("remoteJid", "")
    from_me    = key.get("fromMe", False)
    message    = data.get("message", {})

    logger.info(f"[Evolution] Recebido — jid={remote_jid} from_me={from_me} event={payload.event}")

    # Só processa mensagens de grupos
    if "@g.us" not in remote_jid:
        logger.info(f"[Evolution] Ignorado — não é grupo (jid={remote_jid})")
        return {"status": "ignored", "reason": "not_group_message"}

    # Só aceita grupos autorizados
    if remote_jid not in GRUPOS_PERMITIDOS:
        logger.info(f"[Evolution] Bloqueado — grupo não autorizado: {remote_jid}")
        return {"status": "ignored", "reason": "grupo_nao_autorizado"}

    grupo_nome = GRUPOS_PERMITIDOS[remote_jid]

    info_imagem = _extrair_imagem(message)

    # ── CARD / IMAGEM ──────────────────────────────────────────────────────────
    if info_imagem:
        logger.info(f"[Evolution] Card recebido — caption: '{info_imagem['caption'][:60]}'")
        try:
            base64_img = await _baixar_imagem_base64(key, message)
        except Exception as exc:
            logger.error(f"[Evolution] Falha download imagem: {exc}")
            raise HTTPException(status_code=502, detail=str(exc))

        if not base64_img:
            return {"status": "ignored", "reason": "imagem_base64_vazia"}

        try:
            carga = await extrair_dados_de_imagem(
                imagem_base64=base64_img,
                mimetype=info_imagem["mimetype"],
                fonte="whatsapp_grupo",
                legenda=info_imagem["caption"],
            )
        except Exception as exc:
            logger.error(f"[Evolution] Falha Vision OpenAI: {exc}")
            raise HTTPException(status_code=502, detail=str(exc))

        cliente, portal_origem = resolver_whatsapp(remote_jid)
        frete_id = inserir_frete(carga, cliente=cliente, portal_origem=portal_origem)
        logger.info(f"[Evolution] Card inserido no Supabase — id={frete_id}")
        return {"status": "ok", "tipo": "card_imagem", "id": frete_id, "data": carga.model_dump()}

    # ── TEXTO ──────────────────────────────────────────────────────────────────
    texto = _extrair_texto(message)
    if not texto.strip():
        logger.info("[Evolution] Ignorado — texto vazio")
        return {"status": "ignored", "reason": "empty_text"}

    logger.info(f"[Evolution] Texto recebido: '{texto[:80]}' ({len(texto)} chars)")

    try:
        carga = await extrair_dados_logisticos(texto, "whatsapp_grupo")
    except Exception as exc:
        logger.error(f"[Evolution] Falha OpenAI texto: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))

    # Classificação: cotação se IA identificou origem E destino (ignora nivel_confianca — GPT é não-determinístico)
    eh_cotacao = (
        carga.origem != "Não Especificado"
        and carga.destino != "Não Especificado"
    )
    classificacao = "cotacao" if eh_cotacao else "aviso"

    if eh_cotacao:
        cliente, portal_origem = resolver_whatsapp(remote_jid)
        coords_coleta = await resolver_coords_com_geocoding(texto)
        frete_id = inserir_frete(
            carga,
            cliente=cliente,
            portal_origem=portal_origem,
            coords_coleta=coords_coleta,
        )
        logger.info(f"[Evolution] Cotação inserida no Supabase — id={frete_id}")
    else:
        frete_id = None
        logger.info("[Evolution] Mensagem classificada como aviso de mercado — não inserida em painel_fretes")

    salvar_mensagem_timeline(texto, classificacao=classificacao, frete_id=frete_id, grupo_nome=grupo_nome)

    return {"status": "ok", "tipo": classificacao, "id": frete_id, "data": carga.model_dump()}
