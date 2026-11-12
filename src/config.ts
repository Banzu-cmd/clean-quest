export const APP_NAME = 'クリーンクエスト(仮称)'
export const DEMO = import.meta.env.VITE_DEMO === '1'
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

// サーバー側(supabase/schema.sql の settings)と同じ値にしておく
export const RULES = {
  dailyCap: 5,
  collectLinkM: 50,
  accuracyWarnM: 100,
  rankingMinUsers: 30,
  nearDuplicateM: 20,
}
export const POINTS = { found: 10, collected: 30 }
export const XP = { found: 10, collected: 30 }
export const COINS = { found: 5, collected: 15 }

export const TRASH_TAGS = [
  'プラスチック', '漁具・ロープ', 'ペットボトル・缶', '吸い殻',
  '流木・自然物', '大型ごみ', '危険物', 'その他',
] as const
export const HAZARD_TAG = '危険物'

// 初期の地図中心: 武蔵野市(吉祥寺付近)
export const DEFAULT_CENTER: [number, number] = [35.7036, 139.5797]

export function xpForLevel(l: number): number { return 25 * l * (l - 1) }
export function levelForXp(xp: number): number {
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + 4 * (xp / 25))) / 2))
}
export function levelProgress(xp: number) {
  const lv = levelForXp(xp)
  const base = xpForLevel(lv)
  const next = xpForLevel(lv + 1)
  return { level: lv, current: xp - base, needed: next - base }
}
