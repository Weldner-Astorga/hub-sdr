"""
Geocoding de texto de endereço (fallback quando um link de Maps não carrega lat/lng
embutido — ex.: links de busca/rota tipo "?daddr=Campo+Verde,+MT" ou "/maps/search/...").

Provedor: Nominatim (OpenStreetMap) — gratuito, sem chave/billing. Google Geocoding foi
avaliado no M17.1 e abortado por restrição de billing no Cloud Console do cliente; Nominatim
resolve o mesmo problema sem essa dependência. Política de uso deles exige um User-Agent
identificando a aplicação e pede no máximo ~1 req/s — não é um problema aqui porque só batemos
na API em cache miss, com volume de dezenas de geocodificações por dia.

Estratégia cache-aside (mesmo padrão de qualp_service.py): geocoding_cache -> Nominatim (miss).
"""
import logging
import unicodedata

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "NoGrainOS-Octamove/1.0 (edastorga0@gmail.com)"


def _normalize(texto: str) -> str:
    s = texto.strip().upper()
    s = "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )
    return " ".join(s.split())


def _sb_headers() -> dict:
    return {
        "apikey":        settings.SUPABASE_KEY,
        "Authorization": f"Bearer {settings.SUPABASE_KEY}",
        "Content-Type":  "application/json",
    }


async def _cache_get(endereco: str) -> tuple[float, float] | None:
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            r = await http.get(
                f"{settings.SUPABASE_URL}/rest/v1/geocoding_cache",
                params={
                    "endereco_normalizado": f"eq.{endereco}",
                    "select": "lat,lng",
                },
                headers=_sb_headers(),
            )
            r.raise_for_status()
            rows = r.json()
    except Exception as exc:
        logger.warning("[Geocoding Cache] GET falhou: %s", exc)
        return None

    if not isinstance(rows, list) or not rows:
        return None
    row = rows[0]
    logger.info("[Geocoding Cache] HIT '%s'", endereco)
    return float(row["lat"]), float(row["lng"])


async def _cache_put(endereco: str, lat: float, lng: float) -> None:
    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            await http.post(
                f"{settings.SUPABASE_URL}/rest/v1/geocoding_cache",
                json={
                    "endereco_normalizado": endereco,
                    "lat": lat,
                    "lng": lng,
                    "provider": "nominatim",
                },
                headers={**_sb_headers(), "Prefer": "resolution=merge-duplicates"},
            )
    except Exception as exc:
        logger.warning("[Geocoding Cache] PUT falhou (não bloqueia): %s", exc)


async def geocode_endereco(texto: str) -> tuple[float, float] | None:
    """Resolve lat/lng a partir de um texto de endereço. None se não achar ou der erro."""
    endereco = _normalize(texto)
    if not endereco:
        return None

    cached = await _cache_get(endereco)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=8.0) as http:
            r = await http.get(
                NOMINATIM_URL,
                params={"q": texto, "format": "json", "limit": 1, "countrycodes": "br"},
                headers={"User-Agent": USER_AGENT},
            )
            r.raise_for_status()
            results = r.json()
    except Exception as exc:
        logger.warning("[Geocoding] Nominatim falhou para '%s': %s", texto, exc)
        return None

    if not isinstance(results, list) or not results:
        logger.info("[Geocoding] Nominatim sem resultado para '%s'", texto)
        return None

    lat, lng = float(results[0]["lat"]), float(results[0]["lon"])
    logger.info("[Geocoding] '%s' -> %s,%s", texto, lat, lng)
    await _cache_put(endereco, lat, lng)
    return lat, lng
