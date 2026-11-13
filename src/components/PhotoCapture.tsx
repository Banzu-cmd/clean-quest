import { useRef, useState } from 'react'
import { resizeImage, sha256Hex } from '../lib/image'
import { errorMessage } from '../lib/errors'

export interface Photo { blob: Blob; hash: string; url: string }

export default function PhotoCapture({ photo, onChange }: { photo: Photo | null; onChange: (p: Photo | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [err, setErr] = useState('')
  async function pick(f?: File) {
    if (!f) return
    setErr('')
    try {
      const blob = await resizeImage(f)
      onChange({ blob, hash: await sha256Hex(blob), url: URL.createObjectURL(blob) })
    } catch (e) { setErr(errorMessage(e)) }
  }
  return (
    <div className="photo">
      {photo ? <img src={photo.url} alt="撮影した写真" /> : <div className="photo-empty">写真がまだありません</div>}
      <input ref={ref} data-testid="photo-input" type="file" accept="image/*" capture="environment" hidden
        onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" className="btn secondary" onClick={() => ref.current?.click()}>
        {photo ? '撮り直す' : '📷 写真を撮る'}
      </button>
      <p className="hint">人の顔・車のナンバー・家の窓が写らないようにしてください。撮影位置などの情報は写真から消されます。</p>
      {err && <p className="err">{err}</p>}
    </div>
  )
}
