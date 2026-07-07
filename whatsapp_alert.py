"""
Alerta via WhatsApp (Evolution API) quando um cron job local falha (Ongo).
Best-effort: qualquer falha aqui dentro so e logada, nunca propaga - um alerta
que falha nao pode derrubar o script que esta tentando avisar sobre outra falha.
"""
import logging
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

ENV_FILE = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_FILE)

logger = logging.getLogger(__name__)

EVOLUTION_URL       = os.getenv("EVOLUTION_URL", "")
EVOLUTION_KEY       = os.getenv("EVOLUTION_KEY", "")
EVOLUTION_INSTANCIA = os.getenv("EVOLUTION_INSTANCIA", "")
ALERTA_DESTINO      = os.getenv("ALERTA_WHATSAPP_DESTINO", "")


def alertar_falha(origem: str, detalhe: str) -> None:
    """Envia um alerta de falha pro grupo WhatsApp configurado. Nunca lança."""
    if not (EVOLUTION_URL and EVOLUTION_KEY and EVOLUTION_INSTANCIA and ALERTA_DESTINO):
        logger.warning("[Alerta] Credenciais Evolution API ausentes no .env - alerta nao enviado.")
        return

    texto = f"[NO GRAIN OS] Falha em {origem}:\n{detalhe[:300]}"
    try:
        resp = requests.post(
            f"{EVOLUTION_URL}/message/sendText/{EVOLUTION_INSTANCIA}",
            headers={"apikey": EVOLUTION_KEY, "Content-Type": "application/json"},
            json={"number": ALERTA_DESTINO, "textMessage": {"text": texto}},
            timeout=10,
        )
        if resp.status_code >= 300:
            logger.warning(f"[Alerta] Evolution API respondeu {resp.status_code}: {resp.text[:200]}")
        else:
            logger.info(f"[Alerta] Enviado com sucesso: {origem}")
    except Exception as exc:
        logger.warning(f"[Alerta] Falha ao enviar WhatsApp (nao propaga): {exc}")
