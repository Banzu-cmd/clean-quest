import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { errorMessage } from '../lib/errors'
import type { AdminUser, FlagRow, Metrics, Report } from '../types'

type Tab = 'queue' | 'flags' | 'metrics' | 'users'
const RISK: Record<string, string> = { duplicate_photo: '同じ写真が既にあります', low_accuracy: '位置の誤差が大きい' }

function Card({ r, children }: { r: Report; children: React.ReactNode }) {
  return (
    <div className="card review">
      <img src={r.photoUrl} alt="" />
      <div>
        <p><b>{r.type === 'found' ? '発見' : '回収'}</b> ・ {r.tags.join('・')} ・ {r.userName}</p>
        {r.note && <p>{r.note}</p>}
        <p className="hint">{r.lat.toFixed(5)}, {r.lng.toFixed(5)}(誤差{r.accuracyM != null ? Math.round(r.accuracyM) + 'm' : '不明'}) ・ {new Date(r.createdAt).toLocaleString('ja-JP')}</p>
        {r.riskFlags.map((f) => <span key={f} className="chip warn">⚠ {RISK[f] ?? f}</span>)}
        {children}
      </div>
    </div>
  )
}

export default function Admin() {
  const { api, user } = useAuth()
  const [tab, setTab] = useState<Tab>('queue')
  const [queue, setQueue] = useState<Report[]>([])
  const [flags, setFlags] = useState<FlagRow[]>([])
  const [m, setM] = useState<Metrics | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try {
      if (tab === 'queue') setQueue(await api!.adminPending())
      if (tab === 'flags') setFlags(await api!.adminFlags())
      if (tab === 'metrics') setM(await api!.adminMetrics())
      if (tab === 'users') setUsers(await api!.adminUsers())
    } catch (e) { setMsg(errorMessage(e)) }
  }, [api, tab])
  useEffect(() => { load() }, [load])

  if (user?.role !== 'admin') return <Navigate to="/" replace />
  const run = async (fn: () => Promise<unknown>) => { setMsg(''); try { await fn(); await load() } catch (e) { setMsg(errorMessage(e)) } }
  const reject = (id: string) => {
    const reason = window.prompt('却下の理由(本人に表示されます)')
    if (reason?.trim()) run(() => api!.adminReview(id, false, reason))
  }
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + '%' : '-')

  return (
    <div className="page">
      <h1>🛠️ 管理</h1>
      <div className="seg">
        {(['queue', 'flags', 'metrics', 'users'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {{ queue: '審査待ち', flags: '通報', metrics: '指標', users: 'ユーザー' }[t]}
          </button>
        ))}
      </div>
      {msg && <p className="err" role="alert">{msg}</p>}

      {tab === 'queue' && (queue.length === 0 ? <p className="hint">審査待ちはありません</p> : queue.map((r) => (
        <Card key={r.id} r={r}>
          <div className="row">
            <button className="btn small" onClick={() => run(() => api!.adminReview(r.id, true))}>承認</button>
            <button className="btn small danger" onClick={() => reject(r.id)}>却下</button>
          </div>
        </Card>
      )))}

      {tab === 'flags' && (flags.length === 0 ? <p className="hint">未対応の通報はありません</p> : flags.map((f) => (
        <div key={f.id}>
          <p className="hint">通報理由: {f.reason || '(なし)'}</p>
          {f.report ? (
            <Card r={f.report}>
              <div className="row">
                <button className="btn small danger" onClick={() => run(() => api!.adminResolveFlag(f.id, true))}>非表示にして解決</button>
                <button className="btn small secondary" onClick={() => run(() => api!.adminResolveFlag(f.id, false))}>問題なし</button>
              </div>
            </Card>
          ) : <p>(報告は削除済み)</p>}
        </div>
      )))}

      {tab === 'metrics' && m && (
        <div className="card metrics">
          <p>訪問(端末数) <b>{m.visits}</b></p>
          <p>登録 <b>{m.signups}</b>(訪問→登録 {pct(m.signups, m.visits)})</p>
          <p>1回でも報告 <b>{m.first_report}</b>(登録→報告 {pct(m.first_report, m.signups)})</p>
          <p>2回以上報告(リピート) <b>{m.repeat_users}</b>({pct(m.repeat_users, m.first_report)})</p>
          <p>登録7日後以降も報告 <b>{m.retained_7d}</b></p>
          <p>直近7日のアクティブ <b>{m.weekly_active}</b></p>
          <p>報告 合計 <b>{m.reports_total}</b> / 承認 {m.approved} / 却下 {m.rejected} / 待ち {m.pending}</p>
          <p>平均審査時間 <b>{m.avg_review_hours ?? '-'}</b> 時間 ・ 未対応の通報 {m.open_flags}</p>
        </div>
      )}

      {tab === 'users' && users.map((u) => (
        <div key={u.id} className="row card">
          <span>{u.displayName} ・ 報告{u.reports}件{u.isSuspended && ' ・ 停止中'}</span>
          <button className="btn small secondary" onClick={() => run(() => api!.adminSuspend(u.id, !u.isSuspended))}>{u.isSuspended ? '停止を解除' : '停止'}</button>
        </div>
      ))}
    </div>
  )
}
