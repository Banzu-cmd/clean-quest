import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth'
import LocationPicker from '../components/LocationPicker'
import PhotoCapture, { type Photo } from '../components/PhotoCapture'
import { RULES } from '../config'
import { getPosition } from '../lib/geo'
import { errorMessage } from '../lib/errors'
import type { PostKind } from '../types'

// 掃除の開始時刻の初期値: 3日後の午前10時
function defaultStart(): string {
  const d = new Date(Date.now() + 3 * 86400e3); d.setHours(10, 0, 0, 0)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function PostNew() {
  const { api } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [kind, setKind] = useState<PostKind>(params.get('kind') === 'alert' ? 'alert' : 'event')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [place, setPlace] = useState('')
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null)
  const [start, setStart] = useState(defaultStart())
  const [cap, setCap] = useState('')
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [ack, setAck] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { getPosition().then((f) => setLoc((cur) => cur ?? { lat: f.lat, lng: f.lng })).catch(() => {}) }, [])

  const capNum = cap.trim() === '' ? null : Number(cap)
  const capOk = capNum === null || (Number.isInteger(capNum) && capNum >= 2 && capNum <= 200)
  const ready = !!title.trim() && !!loc && ack && capOk && (kind === 'event' ? !!start : !!photo)

  async function submit() {
    if (!loc) return
    setBusy(true); setErr('')
    try {
      const id = await api!.createPost({
        kind, title, body, lat: loc.lat, lng: loc.lng, placeName: place,
        startsAt: kind === 'event' ? new Date(start).toISOString() : null,
        capacity: kind === 'event' ? capNum : null, photo: kind === 'alert' ? photo!.blob : null, safetyAck: ack,
      })
      nav(`/community/${id}`, { replace: true })
    } catch (e) { setErr(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="page">
      <Link to="/community">← みんなにもどる</Link>
      <h1>＋ 投稿する</h1>
      <div className="seg">
        <button className={kind === 'event' ? 'on' : ''} onClick={() => setKind('event')}>🧹 掃除の募集</button>
        <button className={kind === 'alert' ? 'on' : ''} onClick={() => setKind('alert')}>📢 ごみ情報</button>
      </div>

      <label>タイトル(60文字まで)
        <input type="text" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder={kind === 'event' ? '例: 井の頭公園の池まわりを30分だけ掃除' : '例: 駅北側の植え込みにごみが多いです'} />
      </label>

      {kind === 'event' && (
        <>
          <label>開催日時
            <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label>定員(任意・2〜200人)
            <input type="text" inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="空欄なら定員なし" />
          </label>
          {!capOk && <p className="err">定員は2〜200の整数で入力してください。</p>}
        </>
      )}

      <h3>場所</h3>
      <p className="hint">地図をタップして位置を選びます(最初は現在地)。{kind === 'event' && ' 集合する場所を選んでください。'}</p>
      <LocationPicker value={loc} onChange={setLoc} />
      <button type="button" className="btn secondary small" onClick={() => getPosition().then((f) => setLoc({ lat: f.lat, lng: f.lng })).catch((e) => setErr(errorMessage(e)))}>
        📍 現在地にする
      </button>
      <label>場所の名前(任意・60文字まで)
        <input type="text" maxLength={60} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="例: 井の頭公園 七井橋あたり" />
      </label>

      {kind === 'alert' && (<><h3>写真(必須)</h3><PhotoCapture photo={photo} onChange={setPhoto} /></>)}

      <label>くわしい説明(任意・500文字まで)
        <textarea maxLength={500} value={body} onChange={(e) => setBody(e.target.value)}
          placeholder={kind === 'event' ? '持ち物・集合場所の目印・雨天時の扱いなど' : '見た状況など'} />
      </label>

      <div className="safety">
        <strong>⚠️ 投稿前に確認してください</strong>
        <ul>
          <li>投稿は<b>すぐ全員に公開</b>されます。電話番号・住所・SNSのID・顔写真など、個人を特定できる情報は書かない</li>
          {kind === 'event' && <li>集合場所は<b>人目のある公共の場所</b>にし、明るい時間帯に開催する。見知らぬ人と会うことになるため、安全に十分配慮する</li>}
          {kind === 'event' && <li>危険な場所(車道・水辺・崖など)は避け、危険物は触らない。主催者の責任で安全を確保する</li>}
          <li>私有地に無断で入らない。特定の人や店を非難する内容は書かない</li>
        </ul>
        <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          上の内容を理解し、守ります</label>
      </div>
      <p className="hint">1日に投稿できるのは{RULES.postDailyCap}件までです。</p>
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn" disabled={!ready || busy} onClick={submit}>{busy ? '送信中…' : '投稿する'}</button>
    </div>
  )
}
