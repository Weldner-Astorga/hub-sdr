import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client

from core.config import settings
from services.rag_service import indexar_fechamento

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/cotacoes", tags=["Cotações"])

STATUS_VALIDOS = {
    "RECEBIDA",
    "CALCULADA",
    "PENDENTE",
    "COTACAO_FILIAL",
    "APROV_DIRETORIA",
    "RESPONDIDA",
    "COTADO_AGUARDANDO",
    "GANHA",
    "PERDIDA",
}


def _client():
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _update_sync(cotacao_id: str, fields: dict):
    resp = (
        _client()
        .table("painel_fretes")
        .update({**fields, "status_atualizado_em": _now_iso()})
        .eq("id", cotacao_id)
        .execute()
    )
    return resp


async def _update(cotacao_id: str, fields: dict):
    try:
        resp = _update_sync(cotacao_id, fields)
    except Exception as exc:
        # painel_fretes.id é uuid — ids Trizy (ex: "00067487") não são uuid válido
        # e o Postgres rejeita a comparação antes do WHERE rodar (22P02), não um 404 comum.
        # Trata como "não encontrado" para permitir o fallback Trizy em atualizar_status().
        if "invalid input syntax for type uuid" in str(exc):
            raise HTTPException(status_code=404, detail="Cotação não encontrada em painel_fretes.")
        logger.error(f"[Cotacoes] Supabase update failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar: {exc}")
    if not resp.data:
        raise HTTPException(status_code=404, detail="Cotação não encontrada.")
    return resp.data[0]


def _update_status_trizy_sync(id_frete_externo: str, status: str):
    resp = (
        _client()
        .table("octamove_extracao_trizy")
        .update({"status_crm": status})
        .eq("id_frete_externo", id_frete_externo)
        .execute()
    )
    return resp


async def _update_status_trizy(id_frete_externo: str, status: str) -> dict:
    """
    Fallback para cotações vindas do Trizy BID: essas linhas vivem em
    octamove_extracao_trizy (chave id_frete_externo, coluna status_crm),
    não em painel_fretes. Acionado quando o update primário 404.
    """
    try:
        resp = _update_status_trizy_sync(id_frete_externo, status)
    except Exception as exc:
        logger.error(f"[Cotacoes] Supabase Trizy update failed: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Erro ao atualizar Trizy: {exc}")
    if not resp.data:
        raise HTTPException(status_code=404, detail="Cotação não encontrada em painel_fretes nem Trizy.")
    row = resp.data[0]
    row["status"] = row.get("status_crm")
    return row


# ─── Schema bodies ────────────────────────────────────────────────────────────

class StatusUpdate(BaseModel):
    status: str


class CalcularUpdate(BaseModel):
    distancia_km: float
    pedagio_total: float
    antt_piso_por_ton: float


class PrecoUpdate(BaseModel):
    preco_proposto: float
    antt_piso_por_ton: float


class DadosUpdate(BaseModel):
    origem: str | None = None
    destino: str | None = None
    produto: str | None = None
    embarcador: str | None = None
    observacoes: str | None = None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.patch("/{cotacao_id}/status")
async def atualizar_status(cotacao_id: str, body: StatusUpdate):
    if body.status not in STATUS_VALIDOS:
        raise HTTPException(
            status_code=400,
            detail=f"Status inválido. Valores aceitos: {sorted(STATUS_VALIDOS)}",
        )
    try:
        row = await _update(cotacao_id, {"status": body.status})
    except HTTPException as exc:
        if exc.status_code != 404:
            raise
        row = await _update_status_trizy(cotacao_id, body.status)
    logger.info(f"[Cotacoes] id={cotacao_id} → {body.status}")

    # Auto-indexa no RAG quando cotação é finalizada
    if body.status in {"GANHA", "RESPONDIDA"}:
        preco = float(row.get("preco_proposto") or row.get("valor_tonelada") or 0)
        if preco > 0:
            asyncio.create_task(indexar_fechamento(
                origem        = row.get("origem", ""),
                destino       = row.get("destino", ""),
                produto       = row.get("produto", ""),
                tipo_veiculo  = row.get("tipo_veiculo", "") or "",
                valor_tonelada= preco,
                embarcador    = row.get("embarcador", "") or "",
            ))

    return {"id": cotacao_id, "status": row.get("status", body.status)}


@router.patch("/{cotacao_id}/calcular")
async def marcar_calculada(cotacao_id: str, body: CalcularUpdate):
    """
    Acionado pelo frontend após QualP responder com sucesso.
    Grava os dados da rota e avança status para CALCULADA.
    """
    row = await _update(cotacao_id, {
        "status":           "CALCULADA",
        "distancia_km":     body.distancia_km,
        "pedagio_total_calc": body.pedagio_total,
        "antt_piso_por_ton":  body.antt_piso_por_ton,
    })
    logger.info(
        f"[Cotacoes] id={cotacao_id} → CALCULADA | "
        f"{body.distancia_km} km | ped R${body.pedagio_total} | ANTT R${body.antt_piso_por_ton}/t"
    )
    return {"id": cotacao_id, "status": "CALCULADA", "dados": row}


@router.patch("/{cotacao_id}/preco")
async def salvar_preco(cotacao_id: str, body: PrecoUpdate):
    """
    Salva o preço proposto pelo comercial e calcula o status automaticamente:
    - margem < MARGEM_MINIMA_PCT → APROV_DIRETORIA
    - margem >= MARGEM_MINIMA_PCT → COTACAO_FILIAL
    """
    if body.preco_proposto <= 0:
        raise HTTPException(status_code=400, detail="preco_proposto deve ser maior que zero.")

    if body.antt_piso_por_ton > 0:
        margem_pct = (body.preco_proposto - body.antt_piso_por_ton) / body.preco_proposto * 100
    else:
        margem_pct = 100.0  # sem piso ANTT conhecido → assume aprovado

    novo_status = (
        "APROV_DIRETORIA"
        if margem_pct < settings.MARGEM_MINIMA_PCT
        else "COTACAO_FILIAL"
    )

    row = await _update(cotacao_id, {
        "preco_proposto": body.preco_proposto,
        "status":         novo_status,
    })
    logger.info(
        f"[Cotacoes] id={cotacao_id} → {novo_status} | "
        f"R${body.preco_proposto}/t | margem={margem_pct:.1f}% | "
        f"limiar={settings.MARGEM_MINIMA_PCT}%"
    )
    return {
        "id":          cotacao_id,
        "status":      novo_status,
        "margem_pct":  round(margem_pct, 2),
        "preco_proposto": body.preco_proposto,
    }


@router.patch("/{cotacao_id}/dados")
async def atualizar_dados(cotacao_id: str, body: DadosUpdate):
    """
    Permite edição humana dos campos textuais raspados ([Alterar Dados]).
    Só atualiza os campos que foram enviados (não-None).
    """
    campos = {k: v for k, v in body.model_dump().items() if v is not None}
    if not campos:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar.")
    row = await _update(cotacao_id, campos)
    logger.info(f"[Cotacoes] id={cotacao_id} dados editados: {list(campos.keys())}")
    return {"id": cotacao_id, "campos_atualizados": list(campos.keys()), "dados": row}
