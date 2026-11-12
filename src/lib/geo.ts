export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

export interface Fix { lat: number; lng: number; accuracyM: number }

export function getPosition(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('GEO_UNSUPPORTED'))
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'GEO_DENIED' : 'GEO_FAILED')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}
