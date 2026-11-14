import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import PhotoCapture, { type Photo } from '../components/PhotoCapture'
import SafetyBox from '../components/SafetyBox'
import TagPicker from '../components/TagPicker'
import { POINTS, RULES } from '../config'
import { getPosition, type Fix } from '../lib/geo'
import { errorMessage } from '../lib/errors'

// 見つけて、その場で拾って、捨てるところまでを1枚の写真で報告する
export default function ReportClean() {
  const { api } = useAuth()
  const nav = useNavigate()
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
        type: 'collected', oneShot: true, lat: fix.lat, lng: fix.lng, accuracyM: fix.accuracyM, photo: photo.blob,
        photoHash: photo.hash, tags, note: '', parentId: null, disposedConfirmed: confirm,
      })
      setDone(true)
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  if (done) return (
    <div className="page narrow center-text">
      <h1>🎉 報告を送りました</h1>
      <p>運営が確認すると、{POINTS.oneshot}ポイントとコインがもらえます。ありがとうございます!</p>
      <button className="btn" onClick={() => nav('/')}>地図にもどる</button>
      <button className="btn secondary" onClick={() => { setDone(false); setPhoto(null); setTags([]); setConfirm(false) }}>続けて報告する</button>
    </div>
  )
  return (
    <div className="page">
      <Link to="/report">← 報告の選び方にもどる</Link>
      <h1>⚡ その場で捨てた</h1>
      <SafetyBox />
      <p className="hint">拾ったごみを分別して捨てたあと、<b>ごみ箱に入れた状態</b>を撮影してください(ごみ箱の場所がわかるように)。</p>
      <PhotoCapture photo={photo} onChange={setPhoto} />
      <h3>捨てたごみの種類</h3>
      <TagPicker value={tags} onChange={setTags} disableHazard />
      <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        分別して、正しい場所に捨てました</label>
      <p className="hint">
        {fix ? `📍 位置を取得しました(誤差およそ${Math.round(fix.accuracyM)}m)` : '📍 位置を取得中…'}
        {fix && fix.accuracyM > RULES.accuracyWarnM && ' ※誤差が大きいです。取り直すと確認されやすくなります'}
      </p>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" disabled={!photo || !fix || tags.length === 0 || !confirm || busy} onClick={submit}>
        {busy ? '送信中…' : '報告する'}
      </button>
    </div>
  )
}
