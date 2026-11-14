import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth'
import PostCard from '../components/PostCard'
import { errorMessage } from '../lib/errors'
import { timeAgo } from '../lib/format'
import type { Comment, Post } from '../types'

export default function PostDetail() {
  const { id = '' } = useParams()
  const { api } = useAuth()
  const [post, setPost] = useState<Post | null | undefined>(undefined)
  const [comments, setComments] = useState<Comment[]>([])
  const [text, setText] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const p = await api!.getPost(id)
      setPost(p)
      if (p) setComments(await api!.listComments(id))
    } catch (e) { setMsg(errorMessage(e)); setPost(null) }
  }, [api, id])
  useEffect(() => { load() }, [load])

  async function send() {
    setBusy(true); setMsg('')
    try { await api!.addComment(id, text); setText(''); await load() } catch (e) { setMsg(errorMessage(e)) } finally { setBusy(false) }
  }
  async function removeComment(cid: string) { try { await api!.deleteComment(cid); await load() } catch (e) { setMsg(errorMessage(e)) } }
  async function reportComment(c: Comment) {
    const reason = window.prompt('通報の理由(任意)')
    if (reason === null) return
    try { await api!.flagContent('comment', c.id, reason); setMsg('通報しました。ありがとうございます。') } catch (e) { setMsg(errorMessage(e)) }
  }

  if (post === undefined) return <div className="page"><p className="hint">読み込み中…</p></div>
  if (post === null) return (
    <div className="page"><p>この投稿は見つかりません(削除・非表示になった可能性があります)。</p><Link to="/community">一覧へもどる</Link></div>
  )
  return (
    <div className="page">
      <Link to="/community">← みんなにもどる</Link>
      <PostCard post={post} detail onChanged={load} onError={setMsg} />
      <h2>コメント</h2>
      {msg && <p className="err" role="alert">{msg}</p>}
      {comments.length === 0 && <p className="hint">まだコメントがありません</p>}
      {comments.map((c) => (
        <div className="card" key={c.id} data-testid="comment">
          <p className="hint">{c.authorName} ・ {timeAgo(c.createdAt)}</p>
          <p className="body">{c.body}</p>
          {c.isMine
            ? <button className="link" onClick={() => removeComment(c.id)}>削除</button>
            : <button className="link" onClick={() => reportComment(c)}>通報</button>}
        </div>
      ))}
      <label>コメントを書く(300文字まで)
        <textarea maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <p className="hint">電話番号・住所・SNSのIDなど、個人を特定できる情報は書かないでください。</p>
      <button className="btn" disabled={busy || !text.trim()} onClick={send}>{busy ? '送信中…' : 'コメントする'}</button>
    </div>
  )
}
