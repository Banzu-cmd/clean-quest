import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { levelProgress } from '../config'
import { errorMessage } from '../lib/errors'
import type { MyData } from '../types'

export default function MyPage() {
  const { api, setUser } = useAuth()
  const nav = useNavigate()
  const [d, setD] = useState<MyData | null>(null)
  const [msg, setMsg] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<{ userId: string; displayName: string }[]>([])
  const [name, setName] = useState('')

  const load = useCallback(async () => {
    try {
      const me = await api!.getMe(); setD(me); setName(me.profile.displayName)
      setBlocks(await api!.listBlocks())
    } catch (e) { setMsg(errorMessage(e)) }
  }, [api])
  useEffect(() => { load() }, [load])

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg('')
    try { await fn(); if (ok) setMsg(ok); await load() } catch (e) { setMsg(errorMessage(e)) }
  }

  if (!d) return <div className="page">{msg ? <p className="err">{msg}</p> : '読み込み中…'}</div>
  const lp = levelProgress(d.xp)
  const slotItem = (s: number) => d.town.find((t) => t.slot === s)
  const emoji = (k: string) => d.items.find((i) => i.key === k)?.emoji ?? '❔'

  return (
    <div className="page">
      <h1>🏘️ {d.profile.displayName}のマイ街</h1>
      {msg && <div className="toast inline" role="status" onClick={() => setMsg('')}>{msg}</div>}

      <section className="card stats">
        <div><b>Lv.{d.level}</b><small>あと{lp.needed - lp.current}XPで次のレベル</small>
          <progress value={lp.current} max={lp.needed} /></div>
        <div className="grid3">
          <div><b data-testid="points">{d.points}</b><small>ポイント</small></div>
          <div><b data-testid="coins">{d.coins}</b><small>コイン</small></div>
          <div><b>{d.counts.collected}</b><small>回収</small></div>
        </div>
        <p className="hint">ポイント・コインに金銭的な価値はありません。</p>
      </section>

      <section>
        <h2>バッジ</h2>
        <div className="badges">
          {d.badges.map((b) => (
            <div key={b.key} className={'badge' + (b.owned ? ' own' : '')} title={b.description}>
              <span>{b.owned ? b.emoji : '🔒'}</span><small>{b.name}</small>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>今週のクエスト</h2>
        {d.quests.map((q) => (
          <div key={q.key} className="quest">
            <div><p>{q.title}</p><progress value={q.progress} max={q.target} /><small>{q.progress}/{q.target}</small></div>
            <button className="btn small" disabled={q.claimed || q.progress < q.target}
              onClick={() => run(() => api!.claimQuest(q.key), `コイン${q.rewardCoins}枚をもらいました`)}>
              {q.claimed ? '受取済' : `🪙${q.rewardCoins}`}
            </button>
          </div>
        ))}
        <p className="hint">クエストは毎週月曜にリセットされます。連続記録はありません。休んでも大丈夫です。</p>
      </section>

      <section>
        <h2>マイ街</h2>
        <div className="town" data-testid="town">
          {Array.from({ length: 12 }, (_, s) => {
            const it = slotItem(s)
            return (
              <button key={s} className={'slot' + (it ? ' full' : '')} disabled={!!it || !pick} aria-label={`マス${s + 1}`}
                onClick={() => { const k = pick!; setPick(null); run(() => api!.buyItem(k, s)) }}>
                {it ? emoji(it.itemKey) : pick ? '＋' : ''}
              </button>
            )
          })}
        </div>
        <p className="hint">{pick ? '置きたいマスを選んでください' : 'アイテムを選んでから、空いているマスをタップします'}</p>
        <div className="shop">
          {d.items.map((i) => (
            <button key={i.key} className={'item' + (pick === i.key ? ' on' : '')} disabled={d.coins < i.price}
              onClick={() => setPick(pick === i.key ? null : i.key)}>
              <span>{i.emoji}</span><small>{i.name}</small><small>🪙{i.price}</small>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>ポイントの履歴</h2>
        {d.ledger.length === 0 ? <p className="hint">まだありません</p> : (
          <ul className="ledger">{d.ledger.map((l) => (
            <li key={l.id}><span>{l.reason}</span><b className={l.delta < 0 ? 'neg' : ''}>{l.delta > 0 ? '+' : ''}{l.delta}</b></li>
          ))}</ul>
        )}
      </section>

      <section className="card">
        <h2>設定</h2>
        <label>ニックネーム
          <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn small" disabled={!name.trim()} onClick={() => run(() => api!.setDisplayName(name.trim()), '変更しました')}>変更</button>
        <label className="check"><input type="checkbox" checked={d.profile.showInRanking}
          onChange={(e) => run(() => api!.setRankingVisible(e.target.checked))} />ランキングに名前を表示する</label>
        {blocks.length > 0 && (
          <div><h3>ブロック中</h3>{blocks.map((b) => (
            <div className="row" key={b.userId}><span>{b.displayName}</span>
              <button className="link" onClick={() => run(() => api!.unblockUser(b.userId))}>解除</button></div>
          ))}</div>
        )}
        <div className="row">
          <button className="btn secondary" onClick={async () => { await api!.signOut(); setUser(null); nav('/login') }}>ログアウト</button>
          <button className="btn danger" onClick={async () => {
            if (!window.confirm('アカウントと投稿データをすべて削除します。元に戻せません。よろしいですか?')) return
            try { await api!.deleteAccount(); setUser(null); nav('/login') } catch (e) { setMsg(errorMessage(e)) }
          }}>アカウントを削除</button>
        </div>
      </section>
    </div>
  )
}
