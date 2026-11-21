import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPosition, isInAppBrowser, platform } from './geo'

type Cb = (p: unknown) => void
type ErrCb = (e: { code: number }) => void
const pos = { coords: { latitude: 35.7, longitude: 139.58, accuracy: 30 } }

function stubGeo(impl: (ok: Cb, ng: ErrCb, opts: PositionOptions) => void) {
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: vi.fn(impl) }, userAgent: '' })
  return (navigator.geolocation.getCurrentPosition as unknown as ReturnType<typeof vi.fn>)
}
afterEach(() => vi.unstubAllGlobals())

describe('getPosition', () => {
  it('高精度で取れればそのまま返す', async () => {
    const spy = stubGeo((ok) => ok(pos))
    expect(await getPosition()).toEqual({ lat: 35.7, lng: 139.58, accuracyM: 30 })
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('高精度がタイムアウトしたら、低精度でもう一度試す', async () => {
    const spy = stubGeo((ok, ng, opts) => (opts.enableHighAccuracy ? ng({ code: 3 }) : ok(pos)))
    const f = await getPosition()
    expect(f.lat).toBe(35.7)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(spy.mock.calls[1][2].enableHighAccuracy).toBe(false)
  })
  it('許可されていないときは、やり直さずにエラーにする', async () => {
    const spy = stubGeo((_ok, ng) => ng({ code: 1 }))
    await expect(getPosition()).rejects.toThrow('GEO_DENIED')
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('2回とも失敗したら、原因に応じたコードを返す', async () => {
    stubGeo((_ok, ng) => ng({ code: 2 }))
    await expect(getPosition()).rejects.toThrow('GEO_UNAVAILABLE')
  })
  it('httpsでないときは専用のエラー', async () => {
    stubGeo((ok) => ok(pos)); vi.stubGlobal('window', { isSecureContext: false })
    await expect(getPosition()).rejects.toThrow('GEO_INSECURE')
  })
})

describe('端末の判定', () => {
  it('SNSアプリ内ブラウザを見分ける', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) Line/13.0.0')).toBe(true)
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) Instagram 300.0')).toBe(true)
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) Safari/604.1')).toBe(false)
  })
  it('OSを見分ける', () => {
    expect(platform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('ios')
    expect(platform('Mozilla/5.0 (Linux; Android 14)')).toBe('android')
    expect(platform('Mozilla/5.0 (Windows NT 10.0)')).toBe('other')
  })
})
