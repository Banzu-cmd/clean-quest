import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { APP_NAME } from '../config'
import { useAuth } from '../auth'
import { errorMessage } from '../lib/errors'

export default function Login() {
  const { api, user, setUser } = useAuth()
  const [mode, setMode] = useState<'in' | 'up'>('up')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!api) return
    setErr(''); setInfo(''); setBusy(true)
    try {
      if (mode === 'up') {
        const p = await api.signUp(email, pw, name.trim() || 'ユーザー')
        if (p) setUser(p)
        else setInfo('確認メールを送りました。メール内のリンクを開いてから、ログインしてください。')
      } else {
        setUser(await api.signIn(email, pw))
      }
    } catch (e2) { setErr(errorMessage(e2)) } finally { setBusy(false) }
  }

  return (
    <div className="page narrow">
      <h1>🌊 {APP_NAME}</h1>
      <p className="lead">まちのごみを見つけて、報告して、拾って、ポイントとコインをためるアプリの実証実験です。</p>
      <form onSubmit={submit} className="card">
        <div className="seg">
          <button type="button" className={mode === 'up' ? 'on' : ''} onClick={() => setMode('up')}>新規登録</button>
          <button type="button" className={mode === 'in' ? 'on' : ''} onClick={() => setMode('in')}>ログイン</button>
        </div>
        {mode === 'up' && (
          <label>ニックネーム(ランキングなどに表示されます)
            <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} placeholder="例: みどり" />
          </label>
        )}
        <label>メールアドレス
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>パスワード(6文字以上)
          <input type="password" required minLength={6} value={pw} onChange={(e) => setPw(e.target.value)}
            autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
        </label>
        {err && <p className="err" role="alert">{err}</p>}
        {info && <p className="ok">{info}</p>}
        <button className="btn" disabled={busy}>{busy ? '処理中…' : mode === 'up' ? '登録してはじめる' : 'ログイン'}</button>
      </form>
      <p className="hint center-text"><a href="/terms">利用規約</a> ・ <a href="/privacy">プライバシーポリシー</a></p>
    </div>
  )
}
