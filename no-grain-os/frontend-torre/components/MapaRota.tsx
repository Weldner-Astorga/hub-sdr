'use client'
import { useEffect, useRef } from 'react'

export type TollMarker = { lat: number; lng: number; nome: string; valor: number }

type Props = {
  originCoords:    [number, number] | null
  destCoords:      [number, number] | null
  routeCoords?:    [number, number][]
  tollMarkers?:    TollMarker[]
  containerClass?: string
}

export default function MapaRota({ originCoords, destCoords, routeCoords, tollMarkers, containerClass }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef       = useRef<unknown>(null)
  const layersRef    = useRef<unknown[]>([])

  useEffect(() => {
    if (typeof document === 'undefined') return
    if (document.getElementById('leaflet-css')) return
    const link = Object.assign(document.createElement('link'), {
      id:   'leaflet-css',
      rel:  'stylesheet',
      href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
    })
    document.head.appendChild(link)
  }, [])

  useEffect(() => {
    if (!containerRef.current || !originCoords || !destCoords) return
    if (typeof window === 'undefined') return

    import('leaflet').then((Lmod) => {
      const L = Lmod.default ?? Lmod

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      if (!mapRef.current) {
        const mid: [number, number] = [
          (originCoords[0] + destCoords[0]) / 2,
          (originCoords[1] + destCoords[1]) / 2,
        ]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mapRef.current = (L as any).map(containerRef.current!, {
          zoomControl: true,
          scrollWheelZoom: true,
          attributionControl: true,
        }).setView(mid, 5)

        // Basemap escuro de alto contraste — combina com o tema dark da Torre
        // e realça rota/pedágios (padrão de mapa logístico profissional).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(L as any).tileLayer(
          'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
          { attribution: '©OpenStreetMap ©CARTO', maxZoom: 19, subdomains: 'abcd' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ).addTo(mapRef.current as any)
      }

      // Limpar layers anteriores (evita sobreposição de rotas)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      layersRef.current.forEach((l: any) => { try { l.remove() } catch { /* ignore */ } })
      layersRef.current = []

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const map = mapRef.current as any

      const points: [number, number][] =
        routeCoords && routeCoords.length > 1 ? routeCoords : [originCoords, destCoords]

      // Casing escuro por baixo + linha viva por cima — dá profundidade e
      // legibilidade à rota sobre o basemap escuro (técnica cartográfica padrão).
      const lineCasing = L.polyline(points, {
        color: '#0c4a6e', weight: 9, opacity: 0.6, lineCap: 'round', lineJoin: 'round',
      }).addTo(map)
      layersRef.current.push(lineCasing)

      const line = L.polyline(points, {
        color: '#38bdf8', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round',
      }).addTo(map)
      layersRef.current.push(line)

      const mO = L.circleMarker(originCoords, {
        radius: 11, fillColor: '#10b981', color: '#fff', weight: 3, fillOpacity: 1,
      }).bindPopup(`<b style="color:#10b981">Origem</b>`).addTo(map)
      layersRef.current.push(mO)

      const mD = L.circleMarker(destCoords, {
        radius: 11, fillColor: '#ef4444', color: '#fff', weight: 3, fillOpacity: 1,
      }).bindPopup(`<b style="color:#ef4444">Destino</b>`).addTo(map)
      layersRef.current.push(mD)

      if (tollMarkers) {
        tollMarkers.forEach((t) => {
          const tm = L.circleMarker([t.lat, t.lng], {
            radius: 8, fillColor: '#f59e0b', color: '#fff', weight: 2, fillOpacity: 1,
          }).bindPopup(`<b>Pedágio</b><br>${t.nome}<br>R$ ${t.valor.toFixed(2)}`).addTo(map)
          layersRef.current.push(tm)
        })
      }

      map.fitBounds(L.latLngBounds(points), { padding: [36, 36], maxZoom: 12 })
    })
  }, [originCoords, destCoords, routeCoords, tollMarkers])

  useEffect(() => {
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (mapRef.current) { (mapRef.current as any).remove(); mapRef.current = null }
    }
  }, [])

  if (!originCoords || !destCoords) return null

  return (
    <div
      ref={containerRef}
      className={containerClass ?? 'w-full rounded-lg overflow-hidden border border-zinc-700'}
      style={{ background: '#0c1014' }}
    />
  )
}
