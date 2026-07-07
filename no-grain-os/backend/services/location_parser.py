"""
Extrai coordenadas geográficas de links Google Maps presentes em textos/e-mails.
Suporta URLs diretas; links curtos (goo.gl / maps.app.goo.gl) requerem redirect — não seguidos aqui.
"""
import re
from urllib.parse import unquote_plus

from services.geocoding_service import geocode_endereco

# lat,lng em ?q=lat,lng ou &q=lat,lng
_RE_Q_PARAM = re.compile(r'[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)')

# /@lat,lng,zoom  (URL de navegação)
_RE_AT_COORD = re.compile(r'/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+),')

# !3d{lat}!4d{lng}  (embed data)
_RE_3D_4D = re.compile(r'!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)')

# Links de "busca/rota" sem coordenada — só texto de endereço (precisa geocodificar):
# ?daddr=Texto+Endereco, /maps/search/Texto, /maps/place/Texto
_RE_DADDR       = re.compile(r'[?&]daddr=([^&]+)')
_RE_MAPS_SEARCH = re.compile(r'/maps/search/([^/?&]+)')
_RE_MAPS_PLACE  = re.compile(r'/maps/place/([^/?&]+)')


def extrair_coords(texto: str) -> tuple[float, float] | tuple[None, None]:
    """
    Varre o texto procurando qualquer padrão de URL do Google Maps com coordenadas.
    Retorna (lat, lng) no primeiro match encontrado, ou (None, None).
    """
    for pattern in (_RE_Q_PARAM, _RE_AT_COORD, _RE_3D_4D):
        m = pattern.search(texto)
        if m:
            return float(m.group(1)), float(m.group(2))
    return None, None


def extrair_endereco_busca(texto: str) -> str | None:
    """
    Varre o texto por links de Maps do tipo busca/rota (sem coordenada embutida) e
    retorna o texto do endereço decodificado, ou None se não achar nenhum.
    """
    for pattern in (_RE_DADDR, _RE_MAPS_SEARCH, _RE_MAPS_PLACE):
        m = pattern.search(texto)
        if m:
            return unquote_plus(m.group(1)).replace(",", ", ").strip()
    return None


async def resolver_coords_com_geocoding(texto: str) -> tuple[float, float] | None:
    """
    Resolve coordenadas a partir de um texto livre (e-mail/mensagem):
    1. Coordenada direta embutida no link (extrair_coords, já existente).
    2. Texto de endereço num link de busca/rota, geocodificado via Nominatim.
    Retorna None se nenhuma das duas encontrar algo (comportamento de hoje é preservado).
    """
    lat, lng = extrair_coords(texto)
    if lat is not None:
        return lat, lng

    endereco = extrair_endereco_busca(texto)
    if not endereco:
        return None

    return await geocode_endereco(endereco)
