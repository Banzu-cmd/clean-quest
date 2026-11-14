import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import { errorMessage } from '../lib/errors'
import { fmtDateTime, osmLink, timeAgo } from '../lib/format'
import type { Post } from '../types'

// 一覧と詳細で共通のカード。操作後は onChanged で再読み込みしてもらう
export default function PostCard({ post: p, onChanged, onError, detail = false }: {
  post: Post; onChanged: () => void; onError: (m: string) => void; detail?: boolean
}) {
  const { api } = useAuth()
  const run = async (fn: () => Promise<unknown>) => {
    onError('')
    try { await fn(); onChanged() } catch (e) { onError(errorMessage(e)) }
  }
  const ended = p.kind === 'event' && (p.canceled || new Date(p.startsAt!).getTime() <= Date.now())
  const full = p.capacity != null && p.participantCount >= p.capacity
  const report = () => {
    const reason = window.prompt('通報の理由(任意)。不適切な内容・個人情報・迷惑行為など')
    if (reason !== null) run(() => api!.flagContent('post', p.id, reason))
  }
  const block = () => {
    if (window.confirm(`${p.authorName} さんをブロックしますか?この人の投稿が見えなくなります。`)) run(() => api!.blockUser(p.authorId))
  }
  const cancel = () => {
    if (window.confirm(p.kind === 'event' ? 'この募集を中止しますか?' : 'この投稿を削除しますか?')) run(() => api!.removePost(p.id))
  }

  return (
    <article className="card post" data-testid="post">
      <div className="row">
        <span className={'chip' + (p.kind === 'alert' ? ' warn' : '')}>{p.kind === 'event' ? '🧹 みんなで掃除' : '📢 ごみ情報'}</span>
        <span className="hint">{p.authorName} ・ {timeAgo(p.createdAt)}</span>
      </div>
      <h3>{detail ? p.title : <Link to={`/community/${p.id}`}>{p.title}</Link>}</h3>
      {p.kind === 'event' && (
        <p className="when">
          {p.canceled ? <b className="err">中止になりました</b> : <b>🗓 {fmtDateTime(p.startsAt!)}{ended && '(終了)'}</b>}
          <br />参加 {p.participantCount}{p.capacity != null ? ` / ${p.capacity}` : ''}人
        </p>
      )}
      <p className="hint">📍 {p.placeName || '場所の名前なし'} ・ <a href={osmLink(p.lat, p.lng)} target="_blank" rel="noreferrer noopener">地図で見る</a></p>
      {p.photoUrl && <img className="post-img" src={p.photoUrl} alt="投稿の写真" />}
      {p.body && <p className="body">{p.body}</p>}
      <div className="row actions">
        <button className={'link' + (p.liked ? ' on' : '')} onClick={() => run(() => api!.toggleLike(p.id))} aria-pressed={p.liked}>
          {p.liked ? '❤️' : '🤍'} {p.likeCount}
        </button>
        <Link className="link" to={`/community/${p.id}`}>💬 {p.commentCount}</Link>
        {p.kind === 'event' && !ended && !p.isMine && (
          p.joined
            ? <button className="btn small secondary" onClick={() => run(() => api!.leaveEvent(p.id))}>参加をやめる</button>
            : <button className="btn small" disabled={full} onClick={() => run(() => api!.joinEvent(p.id))}>{full ? '定員です' : '参加する'}</button>
        )}
        {p.kind === 'event' && p.isMine && !ended && <span className="chip">あなたが主催</span>}
      </div>
      <div className="row">
        {p.isMine
          ? <button className="link" onClick={cancel}>{p.kind === 'event' ? '募集を中止する' : '削除する'}</button>
          : <span><button className="link" onClick={report}>通報</button><button className="link" onClick={block}>ブロック</button></span>}
      </div>
    </article>
  )
}
