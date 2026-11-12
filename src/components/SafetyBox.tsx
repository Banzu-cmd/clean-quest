export default function SafetyBox({ compact = false }: { compact?: boolean }) {
  return (
    <div className="safety">
      <strong>⚠️ 安全のために</strong>
      <ul>
        <li>車道・線路・水辺・崖のそばなど、危ない場所には入らない</li>
        <li>注射器・割れたガラス・薬品・電池・刃物などの危険物は<b>触らず</b>、自治体や警察に連絡する</li>
        {!compact && <li>私有地に入らない。歩きスマホをしない。必ず手袋やトングを使い、分別して正しく捨てる</li>}
        {!compact && <li>人や車、家の窓などが写らないように撮影する</li>}
      </ul>
    </div>
  )
}
