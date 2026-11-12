import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import PhotoCapture, { type Photo } from '../components/PhotoCapture'
import SafetyBox from '../components/SafetyBox'
import TagPicker from '../components/TagPicker'
import { getPosition, type Fix } from '../lib/geo'
import { errorMessage } from '../lib/errors'

export default function ReportCollected() {
  const { api } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const parent = params.get('parent')
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [confirm, setConfirm] = useState(false)
  const [fix, setFix] = useState<Fix | null>(null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { api!.track('open_collect').catch(() => {}); getPosition().then(setFix).catch((e) => setErr(errorMessage(e))) }, [api])

  async function submit() {
    if (!photo || !fix) return
    setBusy(true); setErr('')
    try {
      await api!.submitReport({
        type: 'collected', lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, photo: photo.blob, photoHash: photo.hash,
        tags, note: '', parentId: parent, disposedConfirmed: confirm,
      })
      setDone(true)
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  if (done) return (
    <div className="page narrow center-text">
      <h1>🎉 回収の報告を送りました</h1>
      <p>運営が確認すると、ポイントとコインがもらえます。ありがとうございます!</p>
      <button className="btn" onClick={() => nav('/')}>地図にもどる</button>
    </div>
  )
  return (
    <div className="page">
      <h1>🧤 ごみを拾った</h1>
      <SafetyBox />
      <p className="hint">{parent ? '地図で選んだごみに紐づけて報告します。' : '地図のごみに紐づけずに、拾ったものだけ報告することもできます。'}</p>
      <PhotoCapture photo={photo} onChange={setPhoto} />
      <h3>拾ったごみの種類</h3>
      <TagPicker value={tags} onChange={setTags} disableHazard />
      <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        分別して、正しい場所に捨てました(または捨てます)</label>
      <p className="hint">{fix ? '📍 位置を取得しました' : '📍 位置を取得中…'}</p>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" disabled={!photo || !fix || !confirm || busy} onClick={submit}>{busy ? '送信中…' : '回収を報告する'}</button>
    </div>
  )
}
