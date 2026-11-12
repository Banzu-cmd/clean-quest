import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import MapView from '../components/MapView'
import { getPosition } from '../lib/geo'
import { errorMessage } from '../lib/errors'
import type { Report } from '../types'

export default function Home() {
  const { api, user } = useAuth()
  const [reports, setReports] = useState<Report[]>([])
  const [sel, setSel] = useState<Report | null>(null)
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(() => { api!.listMapReports().then(setReports).catch((e) => setMsg(errorMessage(e))) }, [api])
  useEffect(load, [load])

  async function locate() {
    setMsg('')
    try { const f = await getPosition(); setMe({ lat: f.lat, lng: f.lng }) } catch (e) { setMsg(errorMessage(e)) }
  }
  async function flag() {
    if (!sel) return
    const reason = window.prompt('通報の理由を入力してください(例: 人の顔が写っている)') ?? ''
    if (!reason.trim()) return
    try { await api!.flagReport(sel.id, reason); setMsg('通報しました。ご協力ありがとうございます。'); setSel(null); load() }
    catch (e) { setMsg(errorMessage(e)) }
  }
  async function block() {
    if (!sel || !window.confirm(`${sel.userName ?? 'このユーザー'}をブロックしますか?(この人の投稿が表示されなくなります)`)) return
    try { await api!.blockUser(sel.userId); setSel(null); load() } catch (e) { setMsg(errorMessage(e)) }
  }

  return (
    <div className="home">
      <MapView reports={reports} selectedId={sel?.id ?? null} onSelect={setSel} me={me} />
      <div className="map-tools">
        <button className="btn small" onClick={locate}>📍 現在地</button>
        <span className="chip">ごみ {reports.length}件</span>
      </div>
      {msg && <div className="toast" role="status" onClick={() => setMsg('')}>{msg}</div>}
      {sel && (
        <div className="sheet" data-testid="pin-sheet">
          <button className="close" onClick={() => setSel(null)} aria-label="閉じる">×</button>
          <img src={sel.photoUrl} alt="ごみの写真" />
          <div className="sheet-body">
            <p><b>{sel.tags.join('・')}</b>{sel.status === 'pending' && <span className="chip warn">確認待ち</span>}</p>
            {sel.note && <p>{sel.note}</p>}
            <p className="hint">報告: {sel.userName ?? '参加者'} ・ {new Date(sel.createdAt).toLocaleString('ja-JP')}</p>
            {sel.tags.includes('危険物')
              ? <p className="err">⚠️ 危険物の可能性があります。触らず、自治体や警察に連絡してください。</p>
              : <Link className="btn" to={`/collect?parent=${sel.id}`}>🧤 これを拾った</Link>}
            {sel.userId !== user?.id && (
              <div className="row">
                <button className="link" onClick={flag}>🚩 通報</button>
                <button className="link" onClick={block}>🚫 ブロック</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
