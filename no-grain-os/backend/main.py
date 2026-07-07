import asyncio
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import webhook_evolution, webhook_gmail, fretes, cotacoes
from routers import precificar, whatsapp_timeline, ongo_historico
from services.gmail_service import poll_gmail_fretes
from services.antt_crawler import sync_antt_coeficientes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("no_grain_os")

GMAIL_POLL_INTERVAL_MINUTES = 1


async def _gmail_job():
    logger.info("[Scheduler] Disparando ciclo Gmail...")
    try:
        resultado = await poll_gmail_fretes()
        logger.info(f"[Scheduler] Gmail concluído: {resultado}")
    except Exception as exc:
        logger.error(f"[Scheduler] Erro no ciclo Gmail: {exc}")


async def _antt_sync_job():
    logger.info("[Scheduler] Disparando sync semanal ANTT...")
    try:
        resultado = await sync_antt_coeficientes()
        logger.info(f"[Scheduler] ANTT sync concluído: {resultado}")
    except Exception as exc:
        # Nunca derruba o scheduler — loga e segue
        logger.error(f"[Scheduler] Erro no sync ANTT: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()

    # Polling Gmail — a cada 1 minuto (30s de delay inicial)
    scheduler.add_job(
        _gmail_job,
        trigger="interval",
        minutes=GMAIL_POLL_INTERVAL_MINUTES,
        id="gmail_poll",
        next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
    )

    # Sync ANTT — toda segunda-feira às 03:00 UTC
    # Primeira execução: 2 minutos após subir (para inicializar tabela se vazia)
    scheduler.add_job(
        _antt_sync_job,
        trigger="cron",
        day_of_week="mon",
        hour=3,
        minute=0,
        id="antt_sync",
        next_run_time=datetime.now(timezone.utc) + timedelta(minutes=2),
    )

    scheduler.start()
    logger.info("=" * 60)
    logger.info("  NO GRAIN OS — Torre de Controle v2.0")
    logger.info("  Rotas ativas:")
    logger.info("    GET  /fretes                    (Radar Cotações)")
    logger.info("    POST /webhook/evolution         (WhatsApp)")
    logger.info("    POST /webhook/gmail/poll        (Gmail manual)")
    logger.info("    POST /api/precificar            (QualP V4 + ANTT)")
    logger.info("    POST /api/precificar/rag        (RAG Histórico)")
    logger.info("    POST /api/precificar/sync-antt  (Sync manual ANTT)")
    logger.info("    GET  /health")
    logger.info(f"  Scheduler Gmail: a cada {GMAIL_POLL_INTERVAL_MINUTES} min")
    logger.info("  Scheduler ANTT : toda segunda-feira 03:00 UTC")
    logger.info("=" * 60)
    yield
    scheduler.shutdown(wait=False)
    logger.info("NO GRAIN OS — Motor encerrado.")


app = FastAPI(
    title="NO GRAIN OS — Torre de Controle",
    description="Radar de cotações, precificador QualP V4 + ANTT, ingestão WhatsApp/Gmail.",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://2.24.201.246:3000",
    ],
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["*"],
)

app.include_router(fretes.router)
app.include_router(cotacoes.router)
app.include_router(precificar.router)
app.include_router(whatsapp_timeline.router)
app.include_router(ongo_historico.router)
app.include_router(webhook_evolution.router)
app.include_router(webhook_gmail.router)


@app.get("/health", tags=["Sistema"])
async def health():
    return {"status": "ok", "service": "no-grain-os", "version": "2.0.0"}
