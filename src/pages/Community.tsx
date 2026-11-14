import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth'
import PostCard from '../components/PostCard'
import { errorMessage } from '../lib/errors'
import type { Post, PostKind } from '../types'

export default function Community() {
  const { api } = useAuth()
  const [kind, setKind] = useState<PostKind>('event')
  const [posts, setPosts] = useState<Post[] | null>(null)
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    try { setPosts(await api!.listPosts(kind)) } catch (e) { setMsg(errorMessage(e)); setPosts([]) }
  }, [api, kind])
  useEffect(() => { setPosts(null); load() }, [load])

  return (
    <div className="page">
      <div className="row">
        <h1>👥 みんな</h1>
        <Link className="btn small" to={`/community/new?kind=${kind}`}>＋ 投稿する</Link>
      </div>
      <div className="seg" role="tablist">
        <button className={kind === 'event' ? 'on' : ''} onClick={() => setKind('event')}>🧹 掃除の募集</button>
        <button className={kind === 'alert' ? 'on' : ''} onClick={() => setKind('alert')}>📢 ごみ情報</button>
      </div>
      <p className="hint">
        {kind === 'event' ? '日時と場所を決めて、いっしょに掃除する仲間を募集できます。' : 'ごみが多い場所を写真つきで知らせます。'}
        投稿はすぐ公開されます。困った投稿は「通報」してください。
      </p>
      {msg && <p className="err" role="alert">{msg}</p>}
      {posts === null ? <p className="hint">読み込み中…</p>
        : posts.length === 0 ? <p className="hint">まだ投稿がありません。最初の投稿をしてみませんか?</p>
        : posts.map((p) => <PostCard key={p.id} post={p} onChanged={load} onError={setMsg} />)}
    </div>
  )
}
