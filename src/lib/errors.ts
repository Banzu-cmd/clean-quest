const MAP: Record<string, string> = {
  NOT_AUTHORIZED: '権限がありません。ログインし直してください。',
  SUSPENDED: 'このアカウントは現在利用できません。',
  TERMS_REQUIRED: '先に利用規約への同意が必要です。',
  INVALID_TAG: 'ごみの種類の指定が正しくありません。',
  TAG_REQUIRED: 'ごみの種類を1つ以上選んでください。',
  DAILY_CAP: '今日の投稿上限に達しました。また明日お願いします。',
  RATE_LIMIT: '続けて投稿しすぎです。少し待ってからもう一度お試しください。',
  DISPOSAL_CONFIRM_REQUIRED: '分別して正しく捨てたことの確認にチェックしてください。',
  HAZARD_NOT_COLLECTIBLE: '危険物は拾わないでください。自治体などに連絡してください。',
  INVALID_PARENT: '紐づけ先の報告が見つからないか、すでに対象外です。',
  ALREADY_COLLECTED: 'このごみはすでに回収済みです。',
  PARENT_TOO_FAR: '紐づけ先から離れすぎています。ごみの近くで撮影してください。',
  NOT_FOUND: '対象が見つかりません。',
  ALREADY_REVIEWED: 'すでに審査済みです。',
  REASON_REQUIRED: '理由を入力してください。',
  NOT_APPROVED: '承認済みの報告ではありません。',
  OWN_REPORT: '自分の報告は通報できません。',
  ALREADY_CLAIMED: 'すでに受け取り済みです。',
  NOT_COMPLETED: 'まだ達成していません。',
  INVALID_SLOT: '置き場所が正しくありません。',
  SLOT_TAKEN: 'その場所にはすでにアイテムがあります。',
  NOT_ENOUGH_COINS: 'コインが足りません。',
  GEO_UNSUPPORTED: 'この端末では位置情報が使えません。',
  GEO_DENIED: '位置情報の許可が必要です。ブラウザの設定で許可してください。',
  GEO_FAILED: '位置情報を取得できませんでした。電波のよい場所でもう一度お試しください。',
  CANVAS_FAILED: '写真の処理に失敗しました。別の写真でお試しください。',
}

export function errorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  for (const k of Object.keys(MAP)) if (raw.includes(k)) return MAP[k]
  if (/Invalid login credentials/i.test(raw)) return 'メールアドレスかパスワードが違います。'
  if (/already registered|already been registered/i.test(raw)) return 'このメールアドレスはすでに登録されています。'
  if (/Password should be/i.test(raw)) return 'パスワードは6文字以上にしてください。'
  if (/fetch|network/i.test(raw)) return '通信に失敗しました。電波状況を確認してください。'
  return 'うまくいきませんでした。時間をおいてもう一度お試しください。'
}
