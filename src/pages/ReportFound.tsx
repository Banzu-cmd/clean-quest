import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import PhotoCapture, { type Photo } from '../components/PhotoCapture'
import SafetyBox from '../components/SafetyBox'
import TagPicker from '../components/TagPicker'
import { RULES } from '../config'
import { getPosition, type Fix } from '../lib/geo'
import { errorMessage } from '../lib/errors'
import { useEffect } from 'react'

export default function ReportFound() {
  const { api } = useAuth()
  const nav = useNavigate()
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [fix, setFix] = useState<Fix | null>(null)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { api!.track('open_report').catch(() => {}); getPosition().then(setFix).catch((e) => setErr(errorMessage(e))) }, [api])

  async function submit() {
    if (!photo || !fix) return
    setBusy(true); setErr('')
    try {
      await api!.submitReport({
        type: 'found', lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, photo: photo.blob, photoHash: photo.hash,
        tags, note, parentId: null, disposedConfirmed: false,
      })
      setDone(true)
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  if (done) return (
    <div className="page narrow center-text">
      <h1>✅ 報告しました</h1>
      <p>運営が確認すると、ポイントがつきます。確認までしばらくお待ちください。</p>
      <button className="btn" onClick={() => nav('/')}>地図にもどる</button>
      <button className="btn secondary" onClick={() => { setDone(false); setPhoto(null); setTags([]); setNote('') }}>続けて報告する</button>
    </div>
  )
  return (
    <div className="page">
      <Link to="/report">← 報告の選び方にもどる</Link>
      <h1>🔍 ごみを見つけた</h1>
      <SafetyBox compact />
      <PhotoCapture photo={photo} onChange={setPhoto} />
      <h3>ごみの種類(複数選べます)</h3>
      <TagPicker value={tags} onChange={setTags} />
      <label>ひとこと(任意・200文字まで)
        <textarea maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="hint">
        {fix ? `📍 位置を取得しました(誤差およそ${Math.round(fix.accuracyM)}m)` : '📍 位置を取得中…'}
        {fix && fix.accuracyM > RULES.accuracyWarnM && ' ※誤差が大きいです。場所を移動して取り直すと確認されやすくなります'}
      </p>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" disabled={!photo || !fix || tags.length === 0 || busy} onClick={submit}>
        {busy ? '送信中…' : '報告する'}
      </button>
    </div>
  )
}
