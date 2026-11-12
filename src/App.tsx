import { Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom'
import { APP_NAME, DEMO } from './config'
import { useAuth } from './auth'
import Login from './pages/Login'
import TermsGate from './pages/TermsGate'
import Home from './pages/Home'
import ReportFound from './pages/ReportFound'
import ReportCollected from './pages/ReportCollected'
import Ranking from './pages/Ranking'
import MyPage from './pages/MyPage'
import Admin from './pages/Admin'
import { Privacy, Terms } from './pages/Legal'

function Shell() {
  const { user } = useAuth()
  return (
    <div className="shell">
      {DEMO && <div className="demo-banner">デモモード(データはこの端末にのみ保存。あなたは管理者として動作します)</div>}
      <main><Outlet /></main>
      <nav className="tabbar">
        <NavLink to="/" end>🗺️<span>地図</span></NavLink>
        <NavLink to="/report">📸<span>発見</span></NavLink>
        <NavLink to="/collect">🧤<span>回収</span></NavLink>
        <NavLink to="/ranking">🏆<span>ランキング</span></NavLink>
        <NavLink to="/me">🏘️<span>マイ街</span></NavLink>
        {user?.role === 'admin' && <NavLink to="/admin">🛠️<span>管理</span></NavLink>}
      </nav>
    </div>
  )
}

function Guard() {
  const { user, loading } = useAuth()
  if (loading) return <div className="center">読み込み中…</div>
  if (!user) return <Navigate to="/login" replace />
  if (!user.termsAccepted) return <Navigate to="/welcome" replace />
  return <Shell />
}

export default function App() {
  const { fatal, loading } = useAuth()
  if (fatal) return <div className="center card"><h2>{APP_NAME}</h2><p className="err">{fatal}</p></div>
  if (loading) return <div className="center">読み込み中…</div>
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<TermsGate />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route element={<Guard />}>
        <Route path="/" element={<Home />} />
        <Route path="/report" element={<ReportFound />} />
        <Route path="/collect" element={<ReportCollected />} />
        <Route path="/ranking" element={<Ranking />} />
        <Route path="/me" element={<MyPage />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
