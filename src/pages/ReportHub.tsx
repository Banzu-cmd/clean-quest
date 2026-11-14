import { Link } from 'react-router-dom'
import { POINTS } from '../config'

export default function ReportHub() {
  return (
    <div className="page">
      <h1>📸 報告する</h1>
      <p className="lead">いまの状況に近いものを選んでください。</p>
      <Link className="card hub" to="/report/clean" data-testid="hub-clean">
        <b>⚡ その場で捨てた(写真1枚)</b>
        <span>見つけたごみをその場で拾って捨てた。捨てたあとのごみ箱を1枚撮るだけ。 <em>+{POINTS.oneshot}pt</em></span>
      </Link>
      <Link className="card hub" to="/report/found" data-testid="hub-found">
        <b>🔍 ごみを見つけた</b>
        <span>いまは拾えない。場所を地図に載せて、ほかの人にまかせる。 <em>+{POINTS.found}pt</em></span>
      </Link>
      <Link className="card hub" to="/collect" data-testid="hub-collect">
        <b>🧤 地図のごみを拾った</b>
        <span>地図に載っているごみを拾って捨てた。 <em>+{POINTS.collected}pt</em></span>
      </Link>
      <p className="hint">どの報告も、運営が確認するとポイントがつきます。危険物は触らず、自治体などに連絡してください。</p>
    </div>
  )
}
