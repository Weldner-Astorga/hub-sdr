from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query

from services import sheets_reader

router = APIRouter(prefix="/api/ongo-geral", tags=["Ongo Geral — Histórico"])


@router.get("/historico", summary="Linhas da aba Histórico (Sheets) para uma data específica")
async def get_historico(
    data: str = Query(default="", description="DD/MM/YYYY — default hoje"),
):
    data_filtro = data or datetime.now(timezone.utc).strftime("%d/%m/%Y")

    try:
        rows = sheets_reader.listar_historico(data_filtro)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=f"Sheets indisponível: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Erro ao ler Histórico: {exc}")

    return {
        "rows":  rows,
        "total": len(rows),
        "data":  data_filtro,
    }
