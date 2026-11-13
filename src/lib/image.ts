// 長辺1280pxに縮小してJPEG化する。canvasで再描画するのでEXIF(撮影位置など)は消える。
export async function resizeImage(file: Blob, maxSide = 1280, quality = 0.8): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('CANVAS_FAILED')
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close?.()
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('CANVAS_FAILED'))), 'image/jpeg', quality))
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })
}
