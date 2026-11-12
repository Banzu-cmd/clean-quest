import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { errorMessage } from '../lib/errors'
import type { Period, RankingResult } from '../types'

export default function Ranking() {
  const { api } = useAuth()
  const [period, setPeriod] = useState<Period>('week')
  const [data, setData] = useState<RankingResult | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setData(null); api!.getRanking(period).then(setData).catch((e) => setErr(errorMessage(e))) }, [api, period])

  return (
    <div className="page">
      <h1>🏆 ランキング</h1>
      <p className="hint">「承認された回収の件数」の順位です。競争より、まちがきれいになることが目的です。</p>
      <div className="seg">
        <button className={period === 'week' ? 'on' : ''} onClick={() => setPeriod('week')}>今週</button>
        <button className={period === 'month' ? 'on' : ''} onClick={() => setPeriod('month')}>今月</button>
      </div>
      {err && <p className="err">{err}</p>}
      {data && !data.enabled && (
        <div className="card">
          <p>ランキングは、参加者が{data.minUsers}人に達すると表示されます。</p>
          <p className="hint">いまの参加者: {data.users}人</p>
        </div>
      )}
      {data?.enabled && (
        <>
          <ol className="rank">
            {data.rows.length === 0 && <li className="empty">まだ回収の記録がありません</li>}
            {data.rows.map((r) => (
              <li key={r.rank + r.name} className={r.isMe ? 'me' : ''}><b>{r.rank}位</b><span>{r.name}</span><em>{r.count}件</em></li>
            ))}
          </ol>
          {data.me ? <p>あなた: <b>{data.me.rank}位</b>({data.me.count}件)</p>
            : <p className="hint">{data.optedOut ? 'ランキングに表示しない設定になっています(マイ街で変更できます)' : 'この期間の回収記録がまだありません'}</p>}
        </>
      )}
    </div>
  )
}
