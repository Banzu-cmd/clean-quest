import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import type { Report } from '../types'
import { DEFAULT_CENTER } from '../config'

// Vite 環境で Leaflet 既定アイコンが壊れるため、絵文字の DivIcon を使う
const icon = (pending: boolean) => L.divIcon({
  className: 'pin', html: `<span class="${pending ? 'pin-pending' : ''}">🗑️</span>`, iconSize: [32, 32], iconAnchor: [16, 30],
})

export default function MapView({ reports, selectedId, onSelect, me }: {
  reports: Report[]; selectedId: string | null; onSelect: (r: Report) => void; me: { lat: number; lng: number } | null
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const cluster = useRef<L.MarkerClusterGroup | null>(null)
  const meMarker = useRef<L.CircleMarker | null>(null)
  const cb = useRef(onSelect)
  cb.current = onSelect

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true }).setView(DEFAULT_CENTER, 15)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    cluster.current = L.markerClusterGroup({ showCoverageOnHover: false }).addTo(m)
    map.current = m
    return () => { m.remove(); map.current = null }
  }, [])

  useEffect(() => {
    const c = cluster.current
    if (!c) return
    c.clearLayers()
    reports.forEach((r) => {
      const mk = L.marker([r.lat, r.lng], { icon: icon(r.status === 'pending'), title: r.tags.join('・') })
      mk.on('click', () => cb.current(r))
      c.addLayer(mk)
    })
  }, [reports])

  useEffect(() => {
    const m = map.current
    if (!m || !me) return
    meMarker.current?.remove()
    meMarker.current = L.circleMarker([me.lat, me.lng], { radius: 8, color: '#1d6fd1', fillColor: '#3b8cf0', fillOpacity: 0.9 }).addTo(m)
    m.setView([me.lat, me.lng], Math.max(m.getZoom(), 16))
  }, [me])

  useEffect(() => {
    const r = reports.find((x) => x.id === selectedId)
    if (r && map.current) map.current.panTo([r.lat, r.lng])
  }, [selectedId, reports])

  return <div ref={el} className="map" data-testid="map" />
}
