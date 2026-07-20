import asyncio
import logging
import re

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from core.config import settings
from services.evolution_service import enviar_mensagem_whatsapp
from services.liberacoes_matcher_service import (
    atualizar_aderencia_sync,
    descartar_evento_sync,
    listar_fila_revisao_sync,
    processar_eventos_pendentes_sync,
    processar_evento_sync,
)
from services.sheets_service import sincronizar_liberacoes
from services.supabase_client import get_supabase_client as _client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/liberacoes", tags=["Liberações & Aderência"])

# M49 — trava mínima do endpoint de notificação (achado #1 do raio-x: zero auth
# em toda a Torre). Falha fechada: sem token configurado, o endpoint recusa
# tudo em vez de deixar passar silenciosamente. Ver PRD.md §9.11.
# Nota: os.getenv() não serve aqui — core/config.py usa pydantic-settings
# (BaseSettings com env_file=".env"), que lê o .env pro objeto `settings`
# sem propagar pro os.environ do processo. Achado ao vivo (401 mesmo com
# token certo no header) durante o teste deste endpoint.


class CorrecaoEvento(BaseModel):
    payload: dict | None = None
    liberacao_ativa_id: str | None = None


class AderenciaUpdate(BaseModel):
    cadencia_diaria: str | None = None
    caminhoes_no_local: int | None = None
    caminhoes_em_transito: int | None = None
    frete_motorista_ton: float | None = None


class NotificarFilialBody(BaseModel):
    filial_id: str


@router.get("/fila-revisao", summary="Lista eventos pendentes de revisão humana (M43)")
async def fila_revisao():
    eventos = await asyncio.to_thread(listar_fila_revisao_sync)
    return {"eventos": eventos, "total": len(eventos)}


@router.post("/processar", summary="Roda o matcher sobre todos os eventos pendentes (M43)")
async def processar():
    resultado = await asyncio.to_thread(processar_eventos_pendentes_sync)
    return resultado


@router.patch("/eventos/{evento_id}/confirmar", summary="Aplica o evento mesmo com confiança baixa/candidato único revisado")
async def confirmar(evento_id: str):
    resultado = await asyncio.to_thread(processar_evento_sync, evento_id, True, None)
    if resultado["status"] == "erro":
        raise HTTPException(status_code=404, detail=resultado["motivo"])
    return resultado


@router.patch("/eventos/{evento_id}/corrigir", summary="Aplica o evento com payload/lote corrigidos pelo usuário")
async def corrigir(evento_id: str, correcao: CorrecaoEvento):
    resultado = await asyncio.to_thread(
        processar_evento_sync, evento_id, True, correcao.model_dump(exclude_none=True)
    )
    if resultado["status"] == "erro":
        raise HTTPException(status_code=404, detail=resultado["motivo"])
    return resultado


@router.patch("/eventos/{evento_id}/descartar", summary="Marca o evento como rejeitado, sem aplicar nada")
async def descartar(evento_id: str):
    resultado = await asyncio.to_thread(descartar_evento_sync, evento_id)
    if resultado["status"] == "erro":
        raise HTTPException(status_code=404, detail=resultado["motivo"])
    return resultado


@router.patch("/{liberacao_id}/aderencia", summary="M44 — Input manual de aderência (No Local/Em Trânsito/Frete Motorista/Cadência)")
async def atualizar_aderencia(liberacao_id: str, dados: AderenciaUpdate):
    # exclude_unset (não exclude_none!) — cadencia_diaria/frete_motorista_ton são
    # nullable de propósito (limpar o campo é uma ação válida, ex.: reverter uma
    # digitação errada). exclude_none jogaria fora um `{"campo": null}` explícito
    # do mesmo jeito que jogaria fora um campo nunca enviado — bug real achado na
    # validação ao vivo do M44 (PATCH retornava 200 mas o valor nunca era limpo).
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status_code=400, detail="Envie ao menos um campo para atualizar.")
    resultado = await asyncio.to_thread(atualizar_aderencia_sync, liberacao_id, campos)
    if resultado["status"] == "erro":
        raise HTTPException(status_code=404, detail=resultado["motivo"])
    return resultado


def _fmt_brl(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _pct_aderencia(lote: dict) -> float | None:
    """Mesma fórmula do frontend (lib/liberacao.ts / torre/liberacoes/page.tsx
    pctAderencia): (no_local + em_transito) / cadência, cadência extraída do
    primeiro número em cadencia_diaria (texto livre, ex.: '8 caminhões/dia')."""
    m = re.search(r"\d+", lote.get("cadencia_diaria") or "")
    if not m:
        return None
    cad = int(m.group())
    if cad == 0:
        return None
    no_local = lote.get("caminhoes_no_local") or 0
    em_transito = lote.get("caminhoes_em_transito") or 0
    return (no_local + em_transito) / cad * 100


def _montar_texto_aderencia(lote: dict) -> str:
    """M48 — texto formatado que hoje sai como print manual pro grupo Diretoria/
    cliente-transportadora (ver Rag de Liberações/). Margem é dado de negócio
    de primeira classe (decisão 2026-07-14), não só contagem operacional."""
    margem = None
    if lote.get("valor_tonelada") is not None and lote.get("frete_motorista_ton") is not None:
        margem = float(lote["valor_tonelada"]) - float(lote["frete_motorista_ton"])
    pct = _pct_aderencia(lote)
    saldo_t = (lote.get("saldo_kg") or 0) / 1000

    linhas = [
        f"*NO GRAIN OS — Aderência: {lote.get('cliente') or '—'}*",
        "",
        f"Rota: {lote.get('origem') or '—'} → {lote.get('destino') or '—'}",
        f"Produto: {lote.get('produto') or '—'}",
        f"Cadência: {lote.get('cadencia_diaria') or '—'}",
        f"No Local: {lote.get('caminhoes_no_local') or 0} | Em Trânsito: {lote.get('caminhoes_em_transito') or 0}",
        # int(x + 0.5) em vez de round()/:.0f — Python arredonda .5 pra baixo em
        # casos como 62.5 (banker's rounding), o frontend (toFixed) arredonda
        # pra cima — sem isso o texto do WhatsApp diverge do que a tela mostra
        # (achado ao vivo: 62% aqui vs 63% na UI pro mesmo lote).
        f"Aderência: {f'{int(pct + 0.5)}%' if pct is not None else '—'}",
        f"Saldo restante: {saldo_t:,.1f} t".replace(",", "_").replace(".", ",").replace("_", "."),
    ]
    if lote.get("frete_motorista_ton") is not None:
        linhas.append(f"Frete Motorista: {_fmt_brl(float(lote['frete_motorista_ton']))}/t")
    if lote.get("valor_tonelada") is not None:
        linhas.append(f"Preço Cliente: {_fmt_brl(float(lote['valor_tonelada']))}/t")
    if margem is not None:
        linhas.append(f"Margem: {_fmt_brl(margem)}/t")
    return "\n".join(linhas)


def _buscar_liberacao_sync(liberacao_id: str) -> dict | None:
    resp = _client().table("liberacoes_ativas").select("*").eq("id", liberacao_id).limit(1).execute()
    return resp.data[0] if resp.data else None


@router.post("/{liberacao_id}/notificar", summary="M49 — Dispara texto de aderência (M48) pra filial via WhatsApp")
async def notificar_filial(
    liberacao_id: str,
    body: NotificarFilialBody,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
):
    if not settings.INTERNAL_NOTIFY_TOKEN or x_internal_token != settings.INTERNAL_NOTIFY_TOKEN:
        raise HTTPException(status_code=401, detail="Token inválido ou não configurado.")

    def _preparar():
        client = _client()
        lote = _buscar_liberacao_sync(liberacao_id)
        if not lote:
            return {"erro": "lote"}
        resp = client.table("filiais").select("*").eq("id", body.filial_id).limit(1).execute()
        filial = resp.data[0] if resp.data else None
        if not filial:
            return {"erro": "filial"}
        return {"lote": lote, "filial": filial}

    dados = await asyncio.to_thread(_preparar)
    if dados.get("erro") == "lote":
        raise HTTPException(status_code=404, detail="Lote não encontrado.")
    if dados.get("erro") == "filial":
        raise HTTPException(status_code=404, detail="Filial não encontrada.")

    lote, filial = dados["lote"], dados["filial"]
    texto = _montar_texto_aderencia(lote) + f"\n\nFilial: {filial['nome']}"

    enviados = []
    for jid in (filial.get("responsavel_1_whatsapp"), filial.get("responsavel_2_whatsapp")):
        if jid:
            ok = await enviar_mensagem_whatsapp(jid, texto)
            enviados.append({"destino": jid, "enviado": ok})

    if not enviados:
        raise HTTPException(status_code=422, detail="Filial sem WhatsApp cadastrado.")

    logger.info(f"[Liberacoes] notificar lote={liberacao_id} filial={filial['nome']} enviados={enviados}")
    return {"enviados": enviados, "texto": texto}


def _listar_liberacoes_sync() -> list[dict]:
    resp = (
        _client().table("liberacoes_ativas")
        .select("*")
        .order("atualizado_em", desc=True)
        .limit(1000)
        .execute()
    )
    return resp.data or []


@router.post("/sync-sheets", summary="M52 — Sincroniza liberacoes_ativas com a aba 'Liberações Ativas' do Sheets")
async def sync_sheets():
    rows = await asyncio.to_thread(_listar_liberacoes_sync)
    url = await asyncio.to_thread(sincronizar_liberacoes, rows)
    if not url:
        raise HTTPException(status_code=502, detail="Falha ao sincronizar com o Google Sheets.")
    return {"sheet_url": url, "linhas": len(rows)}
