import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import SafetyBox from '../components/SafetyBox'
import { errorMessage } from '../lib/errors'

export default function TermsGate() {
  const { api, user, refresh } = useAuth()
  const nav = useNavigate()
  const [a, setA] = useState(false)
  const [b, setB] = useState(false)
  const [err, setErr] = useState('')
  if (!user) return <Navigate to="/login" replace />
  if (user.termsAccepted) return <Navigate to="/" replace />

  async function go() {
    try { await api!.acceptTerms(); await refresh(); nav('/', { replace: true }) } catch (e) { setErr(errorMessage(e)) }
  }
  return (
    <div className="page narrow">
      <h1>はじめる前に</h1>
      <SafetyBox />
      <div className="card">
        <p><b>ポイントについて:</b> この実証実験のポイントやコインに金銭的な価値はありません。現金や商品には交換できません。</p>
        <p><b>写真と位置情報:</b> 報告した写真と場所は、運営の確認後、他の参加者に地図で表示されます。個人が写らないようにしてください。</p>
        <label className="check"><input type="checkbox" checked={a} onChange={(e) => setA(e.target.checked)} />
          上の安全のルールを読み、守ります</label>
        <label className="check"><input type="checkbox" checked={b} onChange={(e) => setB(e.target.checked)} />
          <span><Link to="/terms" target="_blank">利用規約</Link>と<Link to="/privacy" target="_blank">プライバシーポリシー</Link>に同意します</span></label>
        {err && <p className="err">{err}</p>}
        <button className="btn" disabled={!a || !b} onClick={go}>同意してはじめる</button>
      </div>
    </div>
  )
}
