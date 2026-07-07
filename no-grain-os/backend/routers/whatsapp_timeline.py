from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from core.config import settings

router = APIRouter(prefix="/api/whatsapp", tags=["WhatsApp Timeline"])


def _client():
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


@router.get("/timeline", summary="Feed de mensagens do grupo WhatsApp (avisos + cotações)")
async def get_timeline(
    tipo: str = Query(default="aviso", description="'aviso', 'cotacao' ou 'todos'"),
    limit: int = Query(default=50, le=200),
    incluir_tratados: bool = Query(default=False, description="Se True, inclui mensagens já marcadas como Tratado"),
):
    client = _client()
    q = (
        client.table("whatsapp_timeline")
        .select("id, texto, classificacao, criado_em, remetente, grupo_nome")
        .order("criado_em", desc=True)
        .limit(limit)
    )
    if tipo != "todos":
        q = q.eq("classificacao", tipo)
    if not incluir_tratados:
        q = q.eq("tratado", False)
    resp = q.execute()

    def _contar(classificacao: str) -> int:
        r = (
            client.table("whatsapp_timeline")
            .select("id", count="exact")
            .eq("classificacao", classificacao)
            .eq("tratado", False)
            .limit(1)
            .execute()
        )
        return r.count or 0

    return {
        "mensagens":      resp.data or [],
        "total":          len(resp.data or []),
        "total_cotacao":  _contar("cotacao"),
        "total_aviso":    _contar("aviso"),
        "timestamp":      datetime.now(timezone.utc).isoformat(),
    }


@router.patch("/timeline/{mensagem_id}/tratado", summary="Marca uma mensagem da timeline como tratada")
async def marcar_tratado(mensagem_id: str):
    client = _client()
    resp = (
        client.table("whatsapp_timeline")
        .update({"tratado": True})
        .eq("id", mensagem_id)
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Mensagem não encontrada.")
    return {"id": mensagem_id, "tratado": True}
