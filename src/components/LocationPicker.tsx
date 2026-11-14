import { useEffect, useRef } from 'react'
import L from 'leaflet'
import { DEFAULT_CENTER } from '../config'

const pinIcon = L.divIcon({ className: 'pin', html: '<span>📍</span>', iconSize: [32, 32], iconAnchor: [16, 30] })

// 地図をタップして場所を選ぶ。value が変わると地図もその位置へ動く
export default function LocationPicker({ value, onChange }: {
  value: { lat: number; lng: number } | null; onChange: (v: { lat: number; lng: number }) => void
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const cb = useRef(onChange)
  cb.current = onChange

  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current).setView(value ? [value.lat, value.lng] : DEFAULT_CENTER, 16)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m)
    m.on('click', (e: L.LeafletMouseEvent) => cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }))
    map.current = m
    return () => { m.remove(); map.current = null; marker.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const m = map.current
    if (!m || !value) return
    if (!marker.current) marker.current = L.marker([value.lat, value.lng], { icon: pinIcon }).addTo(m)
    else marker.current.setLatLng([value.lat, value.lng])
    m.panTo([value.lat, value.lng])
  }, [value])

  return <div ref={el} className="map small-map" data-testid="location-map" />
}
