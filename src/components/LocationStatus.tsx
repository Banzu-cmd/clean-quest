import { RULES } from '../config'
import { isInAppBrowser, platform } from '../lib/geo'
import type { useLocation } from '../lib/useLocation'

// 位置情報の状態の表示。失敗したときは、原因に合わせた対処と「もう一度取得」のボタンを出す
export default function LocationStatus({ loc }: { loc: ReturnType<typeof useLocation> }) {
  const { fix, error, code, loading, retry } = loc
  if (fix) {
    return (
      <p className="hint" data-testid="geo-ok">
        📍 位置を取得しました(誤差およそ{Math.round(fix.accuracyM)}m)
        {fix.accuracyM > RULES.accuracyWarnM && ' ※誤差が大きいです。屋外や窓の近くで取り直すと、確認されやすくなります。'}
        {' '}<button type="button" className="link" onClick={retry}>取り直す</button>
      </p>
    )
  }
  if (loading) return <p className="hint">📍 位置を取得中…(許可を求められたら「許可」を選んでください)</p>

  const p = platform()
  return (
    <div className="geo-help" role="alert" data-testid="geo-error">
      <p className="err">📍 {error}</p>
      {isInAppBrowser() && (
        <p>いま開いているのは、SNSなどのアプリの中の画面かもしれません。位置情報が使えないことがあるので、<b>SafariやChromeで開き直して</b>ください(画面右上のメニューから「ブラウザで開く」)。</p>
      )}
      {code === 'GEO_DENIED' && (
        <ul>
          {p === 'ios' && <li>iPhone: 「設定」→「プライバシーとセキュリティ」→「位置情報サービス」をオンにし、使っているブラウザ(Safariなど)を「Appの使用中は許可」にします。(画面は機種やiOSで少し違います)</li>}
          {p === 'android' && <li>Android(Chrome): アドレスバー左のアイコン→「権限」→「位置情報」を「許可」にします。端末の「位置情報」もオンにしてください。</li>}
          {p === 'other' && <li>ブラウザのアドレスバー左のアイコンから、このサイトの「位置情報」を「許可」にしてください。</li>}
          <li>設定を変えたら、下のボタンでもう一度取得します。</li>
        </ul>
      )}
      {(code === 'GEO_UNAVAILABLE' || code === 'GEO_TIMEOUT') && (
        <ul>
          <li>端末の位置情報(GPS)がオンか確認します。機内モードやバッテリーセーバーも見直してください。</li>
          <li>建物の中や地下では取れにくいので、窓の近くか屋外で試します。</li>
        </ul>
      )}
      <button type="button" className="btn small secondary" onClick={retry}>📍 もう一度取得する</button>
    </div>
  )
}
