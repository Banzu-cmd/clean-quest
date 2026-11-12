export type ReportType = 'found' | 'collected'
export type ReportStatus = 'pending' | 'approved' | 'rejected'

export interface Profile {
  id: string
  displayName: string
  role: 'user' | 'admin'
  isSuspended: boolean
  showInRanking: boolean
  termsAccepted: boolean
  email?: string
}

export interface Report {
  id: string
  userId: string
  userName?: string
  type: ReportType
  status: ReportStatus
  lat: number
  lng: number
  accuracyM: number | null
  photoUrl: string
  tags: string[]
  note: string | null
  parentId: string | null
  isCollected: boolean
  hidden: boolean
  riskFlags: string[]
  rejectReason: string | null
  createdAt: string
}

export interface NewReport {
  type: ReportType
  lat: number
  lng: number
  accuracyM: number | null
  photo: Blob
  photoHash: string
  tags: string[]
  note: string
  parentId: string | null
  disposedConfirmed: boolean
}

export interface Badge { key: string; name: string; description: string; emoji: string; owned: boolean }
export interface ShopItem { key: string; name: string; emoji: string; price: number }
export interface TownSlot { slot: number; itemKey: string }
export interface Quest { key: string; title: string; target: number; progress: number; rewardCoins: number; claimed: boolean }
export interface LedgerRow { id: number; delta: number; reason: string; createdAt: string }

export interface MyData {
  profile: Profile
  xp: number
  level: number
  coins: number
  points: number
  badges: Badge[]
  items: ShopItem[]
  town: TownSlot[]
  quests: Quest[]
  ledger: LedgerRow[]
  counts: { found: number; collected: number }
}

export interface RankingResult {
  enabled: boolean
  users: number
  minUsers: number
  rows: { rank: number; name: string; count: number; isMe: boolean }[]
  me: { rank: number; count: number } | null
  optedOut: boolean
}

export interface FlagRow { id: number; reportId: string; reason: string; createdAt: string; report: Report | null }
export interface AdminUser { id: string; displayName: string; isSuspended: boolean; createdAt: string; reports: number }
export interface Metrics {
  visits: number; signups: number; first_report: number; repeat_users: number; retained_7d: number
  weekly_active: number; reports_total: number; pending: number; approved: number; rejected: number
  avg_review_hours: number | null; open_flags: number
}
export type EventName = 'visit' | 'open_report' | 'open_collect'
export type Period = 'week' | 'month'
