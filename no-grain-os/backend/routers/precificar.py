"""
Endpoints do Precificador Flash Pro — QualP API V4.
  POST /api/precificar           — Cache-Aside QualP + Piso ANTT
  POST /api/precificar/rag       — Busca RAG no histórico de fechamentos
  POST /api/precificar/sync-antt — Sync manual dos coeficientes ANTT

Regras de cálculo (TRAVA CRÍTICA ANTT):
  - Pedágio e distância vêm exclusivamente da QualP V4.
  - volume_toneladas NÃO entra na fórmula de frete/pedágio.
  - ANTT: Frete_min = (distancia_km × CCD) + CCF, usando capacidade fixa do veículo.
  - Eixos aceitos: 7 (Bitrem 37t) ou 9 (Rodotrem 50t).
"""
import logging
import math

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.qualp_service import consultar_rota
from services.antt_service import calcular_piso_antt
from services.rag_service import buscar_historico_similar
from services.antt_crawler import sync_antt_coeficientes
from services.location_parser import extrair_coords
from services.geocoding_service import geocode_endereco

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/precificar", tags=["Precificador Flash Pro"])

CAPACIDADE_FIXA: dict[int, float] = {4: 14.0, 5: 27.0, 6: 33.0, 7: 37.0, 9: 50.0}


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PrecificarRequest(BaseModel):
    origem: str
    destino: str
    produto: str
    tipo_carga: str = "granel_solido"
    eixos: int = Field(default=7, ge=7, le=9)
    volume_toneladas: float = Field(default=37.0, gt=0, description="Apenas informativo — não entra no cálculo ANTT")
    valor_cotado_por_tonelada: float = Field(default=0.0, ge=0)
    # ── Ponto exato (opcional) — Milestone A: geocodificação além da sede do município ──
    origem_ponto_exato:  str | None = None  # "Nome do Local, Cidade/UF" — enviado pela UI ao clicar "Usar Ponto Exato"
    destino_ponto_exato: str | None = None
    origem_maps_link:    str | None = None  # link cru do Maps (Trizy) — só usado se origem_ponto_exato vier setado
    destino_maps_link:   str | None = None
    origem_lat:          float | None = None  # coordenada já geocodificada (Ongo/WhatsApp/Gmail) — prioridade máxima
    origem_lng:          float | None = None
    destino_lat:         float | None = None
    destino_lng:         float | None = None


class RagRequest(BaseModel):
    origem: str
    destino: str
    produto: str
    tipo_veiculo: str = ""


# ─── Resolução de ponto exato ───────────────────────────────────────────────────
#
# Prioridade: coordenada já geocodificada (Ongo/WhatsApp/Gmail) → coordenada extraída
# do link do Maps (raro na Trizy — o link dela é só uma busca em texto) → texto do
# ponto exato ("Nome do Local, Cidade/UF"), que o próprio QualP geocodifica (cai pra
# sede do município quando não conhece o local, mas isso já é tratado pelo fallback
# automático de consultar_rota() pra Cidade/UF pura).
#
# Integração com Google Geocoding foi avaliada e abortada no M17.1 (restrição de billing no
# Console do cliente). Retomada no Grupo 1 (2026-07-06) usando Nominatim (OpenStreetMap) em vez
# do Google — sem chave/billing, só entra em cache miss quando nem coordenada nem link resolvem.

async def _resolver_ponto_exato(
    texto: str | None,
    maps_link: str | None,
    lat: float | None,
    lng: float | None,
) -> str | None:
    if lat is not None and lng is not None:
        return f"{lat},{lng}"
    if maps_link:
        lat_link, lng_link = extrair_coords(maps_link)
        if lat_link is not None:
            return f"{lat_link},{lng_link}"
    if texto:
        geocoded = await geocode_endereco(texto)
        if geocoded is not None:
            return f"{geocoded[0]},{geocoded[1]}"
    return texto


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/")
async def precificar(req: PrecificarRequest):
    """
    1. QualP V4 (cache-aside) — distância km + pedágio R$ + polyline para mapa.
    2. ANTT — piso mínimo por tonelada (Res. 6.442/2024) usando capacidade fixa do veículo.
    3. Retorna comparativo com cotação recebida.
    """
    origem_query, destino_query = req.origem, req.destino
    origem_fallback = destino_fallback = None

    if req.origem_ponto_exato:
        resolvido = await _resolver_ponto_exato(req.origem_ponto_exato, req.origem_maps_link, req.origem_lat, req.origem_lng)
        if resolvido:
            origem_query, origem_fallback = resolvido, req.origem

    if req.destino_ponto_exato:
        resolvido = await _resolver_ponto_exato(req.destino_ponto_exato, req.destino_maps_link, req.destino_lat, req.destino_lng)
        if resolvido:
            destino_query, destino_fallback = resolvido, req.destino

    rota = await consultar_rota(origem_query, destino_query, req.eixos, origem_fallback, destino_fallback)

    distancia_km   = rota["distancia_km"]
    pedagio_total  = rota["pedagio_total"]
    cap_fixa       = CAPACIDADE_FIXA.get(req.eixos, 37.0)

    pedagio_por_ton = round(pedagio_total / cap_fixa, 2) if pedagio_total > 0 else 0.0

    antt = await calcular_piso_antt(
        distancia_km=distancia_km,
        eixos=req.eixos,
        tipo_carga=req.tipo_carga,
        volume_toneladas=cap_fixa,
    )

    cotacao_ton   = req.valor_cotado_por_tonelada
    piso_ton      = antt["frete_minimo_por_tonelada"]
    num_viagens   = math.ceil(req.volume_toneladas / cap_fixa)
    piso_total    = round(piso_ton * req.volume_toneladas, 2)
    cotacao_total = round(cotacao_ton * req.volume_toneladas, 2) if cotacao_ton > 0 else None

    diferenca_ton   = round(cotacao_ton - piso_ton, 2)   if cotacao_ton > 0 and piso_ton > 0 else None
    diferenca_total = round(cotacao_total - piso_total, 2) if cotacao_total is not None else None

    if cotacao_ton > 0 and piso_ton > 0:
        status_antt = "acima_piso" if cotacao_ton >= piso_ton else "abaixo_piso"
    else:
        status_antt = "sem_cotacao"

    return {
        "rota": {
            "origem":          rota.get("origem_usada", req.origem),
            "destino":         rota.get("destino_usada", req.destino),
            "distancia_km":    distancia_km,
            "fonte":           rota.get("fonte", ""),
            "polyline":        rota.get("polyline", []),
            "pedagio_pontos":  rota.get("pedagio_pontos", []),
            "freight_table":   rota.get("freight_table", []),
            "aviso":           rota.get("aviso"),
        },
        "pedagio": {
            "valor_total":     pedagio_total,
            "por_tonelada":    pedagio_por_ton,
            "capacidade_fixa": cap_fixa,
        },
        "antt": antt,
        "contrato": {
            "volume_total_ton":   req.volume_toneladas,
            "capacidade_veiculo": cap_fixa,
            "num_viagens":        num_viagens,
            "piso_antt_por_ton":  piso_ton,
            "piso_antt_total":    piso_total,
            "cotacao_por_ton":    cotacao_ton,
            "cotacao_total":      cotacao_total,
            "diferenca_por_ton":  diferenca_ton,
            "diferenca_total":    diferenca_total,
            "status":             status_antt,
        },
        "inputs": {
            "eixos":            req.eixos,
            "volume_toneladas": req.volume_toneladas,
            "tipo_carga":       req.tipo_carga,
        },
    }


@router.post("/rag")
async def precificar_rag(req: RagRequest):
    """Busca preços históricos similares via pgvector (últimos 30 dias)."""
    return await buscar_historico_similar(
        origem=req.origem,
        destino=req.destino,
        produto=req.produto,
        tipo_veiculo=req.tipo_veiculo,
    )


@router.post("/sync-antt")
async def sync_antt_manual():
    """Dispara sincronização manual dos coeficientes ANTT."""
    return await sync_antt_coeficientes()
