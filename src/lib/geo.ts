export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

export interface Fix { lat: number; lng: number; accuracyM: number }

export type GeoCode = 'GEO_UNSUPPORTED' | 'GEO_INSECURE' | 'GEO_DENIED' | 'GEO_UNAVAILABLE' | 'GEO_TIMEOUT'

function once(opts: PositionOptions): Promise<Fix> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'GEO_DENIED' : e.code === 3 ? 'GEO_TIMEOUT' : 'GEO_UNAVAILABLE')),
      opts,
    )
  })
}

// まず高精度(GPS)で短く試し、屋内や電波が弱くて失敗したら、精度を下げて(Wi-Fi・基地局)もう一度試す。
// 許可されていない(DENIED)ときだけ、やり直しても意味がないのでそのままエラーにする。
export async function getPosition(): Promise<Fix> {
  if (typeof window !== 'undefined' && window.isSecureContext === false) throw new Error('GEO_INSECURE')
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) throw new Error('GEO_UNSUPPORTED')
  try {
    return await once({ enableHighAccuracy: true, timeout: 8000, maximumAge: 10000 })
  } catch (e) {
    if ((e as Error).message === 'GEO_DENIED') throw e
    return once({ enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 })
  }
}

// SNSアプリなどの中で開いたページ(アプリ内ブラウザ)では、位置情報が使えないことが多い
export function isInAppBrowser(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
  return /Line\/|FBAN|FBAV|FB_IAB|Instagram|Twitter|TikTok|MicroMessenger|Messenger|KAKAOTALK|Snapchat/i.test(ua)
}

export function platform(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): 'ios' | 'android' | 'other' {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'other'
}
