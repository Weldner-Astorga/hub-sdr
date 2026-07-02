"""
Motor de rota e pedágio — QualP API V4.
Estratégia Cache-Aside: consulta qualp_cache antes de qualquer chamada externa.

Fluxo:
  1. Normaliza origem/destino (UPPERCASE, sem acentos, sem espaços duplos)
  2. Busca na tabela qualp_cache por (origem, destino, eixos)
  3. Cache HIT  → retorna sem consumir token
  4. Cache MISS → POST /rotas/v4 com polyline:true forçado
  5. Persiste resultado no cache com UNIQUE constraint
"""
import logging
import unicodedata
from typing import Optional

import httpx
from pydantic import BaseModel

from core.config import settings

logger = logging.getLogger(__name__)

QUALP_URL = "https://api.qualp.com.br/rotas/v4"


# ── Normalização ──────────────────────────────────────────────────────────────

def _normalize(s: str) -> str:
    s = s.strip().upper()
    s = "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )
    return " ".join(s.split())


# ── Payload QualP V4 ──────────────────────────────────────────────────────────

def _build_payload(origem: str, destino: str, eixos: int) -> dict:
    return {
        "locations": [origem, destino],
        "config": {
            "route": {
                "type_route": "efficient",
                "calculate_return": False,
                "alternative_routes": "0",
                "optimized_route": False,
                "optimized_route_destination": "last",
                "avoid_locations": False,
                "avoid_locations_key": "",
            },
            "vehicle": {
                "type": "truck",
                "axis": str(eixos),
                "top_speed": "",
            },
            "freight_table": {
                "category": "all",
                "freight_load": "all",
                "axis": "all",
            },
            "tolls": {"retroactive_date": ""},
            "fuel_consumption": {"fuel_price": "", "km_fuel": ""},
            "private_places": {
                "max_distance_from_location_to_route": "1000",
                "areas": False,
                "categories": False,
                "contacts": False,
                "products": False,
                "services": False,
            },
        },
        "show": {
            "freight_table": True,
            "tolls": True,
            "fuel_consumption": False,
            "maneuvers": False,
            "truck_scales": False,
            "ufs": False,
            "segments_information": False,
            "private_places": False,
            "static_image": False,
            "link_to_qualp": False,
            "link_to_qualp_report": False,
            "polyline": True,            # CRÍTICO: coordenadas para mapa Leaflet
            "simplified_polyline": False,
        },
        "exception_key": "",
    }


# ── Modelo de saída ───────────────────────────────────────────────────────────

class RouteResult(BaseModel):
    distancia_km: float
    pedagio_total: float
    pedagio_pontos: list[dict]
    polyline: list[list[float]]
    freight_table: list[dict]
    fonte: str


# ── Helpers Supabase ──────────────────────────────────────────────────────────

def _sb_headers() -> dict:
    return {
        "apikey":        settings.SUPABASE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        "Content-Type":  "application/json",
    }


# ── Cache ─────────────────────────────────────────────────────────────────────

async def _cache_get(origem: str, destino: str, eixos: int) -> Optional[RouteResult]:
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            r = await http.get(
                f"{settings.SUPABASE_URL}/rest/v1/qualp_cache",
                params={
                    "origem":  f"eq.{origem}",
                    "destino": f"eq.{destino}",
                    "eixos":   f"eq.{eixos}",
                    "select":  "distancia_km,pedagio_total,pedagio_pontos,polyline,freight_table",
                },
                headers=_sb_headers(),
            )
            r.raise_for_status()
            rows = r.json()
    except Exception as exc:
        logger.warning("[QualP Cache] GET falhou: %s", exc)
        return None

    if not isinstance(rows, list) or not rows:
        return None

    row = rows[0]
    logger.info("[QualP Cache] HIT %s → %s (%dE)", origem, destino, eixos)
    return RouteResult(
        distancia_km  = float(row.get("distancia_km")  or 0),
        pedagio_total = float(row.get("pedagio_total") or 0),
        pedagio_pontos= row.get("pedagio_pontos") or [],
        polyline      = row.get("polyline")       or [],
        freight_table = row.get("freight_table")  or [],
        fonte         = "cache",
    )


async def _cache_put(origem: str, destino: str, eixos: int, result: RouteResult):
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            await http.post(
                f"{settings.SUPABASE_URL}/rest/v1/qualp_cache",
                json={
                    "origem":          origem,
                    "destino":         destino,
                    "eixos":           eixos,
                    "distancia_km":    result.distancia_km,
                    "pedagio_total":   result.pedagio_total,
                    "pedagio_pontos":  result.pedagio_pontos,
                    "polyline":        result.polyline,
                    "freight_table":   result.freight_table,
                },
                headers={**_sb_headers(), "Prefer": "resolution=merge-duplicates"},
            )
    except Exception as exc:
        logger.warning("[QualP Cache] PUT falhou: %s", exc)


# ── Extratores do response QualP (schema real de /rotas/v4, em português) ─────
#
# A API devolve nomes de campo em PT-BR e uma polyline codificada (algoritmo
# padrão do Google, precisão 1e6 — não 1e5). Pedágios não trazem lat/lng
# diretamente: cada praça tem um `p_index`, o índice do ponto correspondente
# dentro da polyline decodificada.

def _decode_polyline(encoded: str, precision: float = 1e6) -> list[list[float]]:
    points: list[list[float]] = []
    index = lat = lng = 0
    length = len(encoded)
    while index < length:
        result = shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if (result & 1) else (result >> 1)
        lat += dlat

        result = shift = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if (result & 1) else (result >> 1)
        lng += dlng

        points.append([lat / precision, lng / precision])
    return points


def _extract_distance(data: dict) -> float:
    d = (data.get("distancia") or {}).get("valor")
    if d is None:
        return 0.0
    return round(float(d), 1)


def _extract_polyline(data: dict) -> list[list[float]]:
    encoded = data.get("polilinha_codificada")
    if not encoded:
        return []
    try:
        return _decode_polyline(encoded)
    except Exception:
        logger.warning("[QualP] Falha ao decodificar polilinha_codificada")
        return []


def _extract_tolls(data: dict, eixos: int, polyline: list[list[float]]) -> tuple[float, list[dict]]:
    pedagios = data.get("pedagios") or []
    eixo_key = str(eixos)
    total = 0.0
    pontos = []
    for p in pedagios:
        valor = float((p.get("tarifa") or {}).get(eixo_key) or 0)
        total += valor
        p_index = p.get("p_index")
        coord = polyline[p_index] if isinstance(p_index, int) and 0 <= p_index < len(polyline) else None
        pontos.append({
            "nome":    p.get("nome", ""),
            "rodovia": p.get("rodovia", ""),
            "lat":     coord[0] if coord else None,
            "lng":     coord[1] if coord else None,
            "valor":   valor,
        })
    return round(total, 2), pontos


def _extract_freight_table(data: dict, eixos: int) -> list[dict]:
    dados = (((data.get("tabela_frete") or {}).get("dados") or {}).get("A") or {})
    tabela = dados.get(str(eixos)) or {}
    if not isinstance(tabela, dict):
        return []
    return [{"categoria": k, "valor": v} for k, v in tabela.items()]


# ── Ponto de entrada público ──────────────────────────────────────────────────

async def consultar_rota(origem: str, destino: str, eixos: int = 7) -> dict:
    """
    Cache-Aside: qualp_cache → QualP API V4 (apenas em miss).
    Retorna: distancia_km, pedagio_total, pedagio_pontos, polyline, freight_table, fonte.
    """
    orig_norm = _normalize(origem)
    dest_norm = _normalize(destino)

    cached = await _cache_get(orig_norm, dest_norm, eixos)
    if cached:
        return cached.model_dump()

    if not settings.QUALP_API_TOKEN:
        logger.warning("[QualP] QUALP_API_TOKEN ausente — retornando zeros")
        return RouteResult(
            distancia_km=0.0, pedagio_total=0.0, pedagio_pontos=[],
            polyline=[], freight_table=[], fonte="sem_token",
        ).model_dump()

    payload = _build_payload(orig_norm, dest_norm, eixos)

    async with httpx.AsyncClient(timeout=30.0) as http:
        r = await http.post(
            QUALP_URL,
            json=payload,
            headers={"access-token": settings.QUALP_API_TOKEN, "Content-Type": "application/json"},
        )
        r.raise_for_status()
        data = r.json()

    distancia_km    = _extract_distance(data)
    polyline        = _extract_polyline(data)
    # pedágios não trazem lat/lng — resolvidos via p_index na polyline já decodificada
    pedagio_total, pedagio_pontos = _extract_tolls(data, eixos, polyline)
    freight_table   = _extract_freight_table(data, eixos)

    logger.info(
        "[QualP] MISS → %s→%s | %.1f km | R$%.2f pedágio | %d praças",
        orig_norm, dest_norm, distancia_km, pedagio_total, len(pedagio_pontos),
    )

    result = RouteResult(
        distancia_km   = distancia_km,
        pedagio_total  = pedagio_total,
        pedagio_pontos = pedagio_pontos,
        polyline       = polyline,
        freight_table  = freight_table,
        fonte          = "qualp_v4",
    )
    await _cache_put(orig_norm, dest_norm, eixos, result)
    return result.model_dump()
