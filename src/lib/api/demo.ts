// デモモード: Supabase なしで画面を試すための localStorage 版。
// 動きはサーバー側の仕様(schema.sql)をなるべく再現するが、本番の安全性の根拠にはならない。
import { COINS, levelForXp, POINTS, RULES, XP, HAZARD_TAG } from '../../config'
import { haversineM } from '../geo'
import { blobToDataUrl } from '../image'
import type {
  AdminUser, Badge, EventName, FlagRow, LedgerRow, Metrics, MyData, NewReport, Period, Profile,
  Quest, RankingResult, Report, ShopItem,
} from '../../types'
import type { Api } from './types'

const KEY = 'cq_demo_v1'
const ITEMS: ShopItem[] = [
  { key: 'tree', name: '木', emoji: '🌳', price: 10 }, { key: 'flower', name: '花', emoji: '🌸', price: 15 },
  { key: 'bench', name: 'ベンチ', emoji: '🪑', price: 20 }, { key: 'lamp', name: '街灯', emoji: '💡', price: 25 },
  { key: 'bird', name: '小鳥', emoji: '🐦', price: 30 }, { key: 'dog', name: '犬', emoji: '🐕', price: 40 },
  { key: 'fountain', name: '噴水', emoji: '⛲', price: 60 }, { key: 'cafe', name: 'カフェ', emoji: '☕', price: 80 },
]
const BADGES = [
  { key: 'first_found', name: 'はじめの一歩', description: '初めてごみを報告して承認された', emoji: '🔍' },
  { key: 'first_collected', name: '拾い手', description: '初めてごみを回収して承認された', emoji: '🧤' },
  { key: 'explorer', name: '探検家', description: '3か所以上でごみを報告した', emoji: '🧭' },
  { key: 'careful', name: 'ていねい', description: '却下なしで10件承認された', emoji: '✨' },
]
const QUESTS = [
  { key: 'q_found_2', title: '今週2件、ごみを報告しよう', metric: 'found', target: 2, reward: 10 },
  { key: 'q_collect_1', title: '今週1件、ごみを回収しよう', metric: 'collected', target: 1, reward: 20 },
  { key: 'q_total_5', title: '今週あわせて5件、報告か回収をしよう', metric: 'total', target: 5, reward: 30 },
]
const ME = 'me'

interface Rec extends Omit<Report, 'photoUrl'> { photoUrl: string; photoHash: string }
interface DB {
  me: { name: string; accepted: boolean; showInRanking: boolean; signedIn: boolean; xp: number; coins: number }
  reports: Rec[]
  ledger: LedgerRow[]
  badges: string[]
  town: { slot: number; itemKey: string }[]
  claims: string[]
  flags: { id: number; reportId: string; reason: string; createdAt: string; open: boolean }[]
  blocks: string[]
  suspended: string[]
  events: { client: string; name: EventName }[]
  seq: number
}

function placeholder(label: string, color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="52%" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg)
}

function seed(): DB {
  const now = Date.now()
  const mk = (i: number, name: string, lat: number, lng: number, tags: string[], status: Rec['status'] = 'approved'): Rec => ({
    id: 's' + i, userId: 'u' + i, userName: name, type: 'found', status, lat, lng, accuracyM: 12,
    photoUrl: placeholder(tags[0], '#6b7f8c'), photoHash: 'seed' + i, tags, note: null, parentId: null,
    isCollected: false, hidden: false, riskFlags: [], rejectReason: null, createdAt: new Date(now - i * 3600e3).toISOString(),
  })
  return {
    me: { name: 'デモユーザー', accepted: false, showInRanking: true, signedIn: false, xp: 0, coins: 0 },
    reports: [
      mk(1, 'さくら', 35.7033, 139.5791, ['吸い殻']),
      mk(2, 'たろう', 35.7048, 139.5812, ['ペットボトル・缶']),
      mk(3, 'みどり', 35.7021, 139.5775, ['プラスチック', 'その他']),
      mk(4, 'けんじ', 35.7066, 139.5786, ['大型ごみ'], 'pending'),
    ],
    ledger: [], badges: [], town: [], claims: [], flags: [], blocks: [], suspended: [], events: [], seq: 100,
  }
}

function load(): DB {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DB
  } catch { /* 破損時は作り直す */ }
  return seed()
}
function save(db: DB) { localStorage.setItem(KEY, JSON.stringify(db)) }
const pub = (r: Rec): Report => { const { photoHash: _h, ...rest } = r; void _h; return rest }

function weekStart(): number {
  const jst = new Date(Date.now() + 9 * 3600e3)
  const day = (jst.getUTCDay() + 6) % 7
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - day) - 9 * 3600e3
}

export async function createDemoApi(): Promise<Api> {
  let db = load()
  const commit = () => save(db)
  const profile = (): Profile => ({
    id: ME, displayName: db.me.name, role: 'admin', isSuspended: false, showInRanking: db.me.showInRanking,
    termsAccepted: db.me.accepted, email: 'demo@example.com',
  })
  const mine = () => db.reports.filter((r) => r.userId === ME)
  const need = () => { if (!db.me.signedIn) throw new Error('NOT_AUTHORIZED') }

  function awardBadges() {
    const m = mine()
    const ap = m.filter((r) => r.status === 'approved')
    const give = (k: string) => { if (!db.badges.includes(k)) db.badges.push(k) }
    if (ap.some((r) => r.type === 'found')) give('first_found')
    if (ap.some((r) => r.type === 'collected')) give('first_collected')
    const spots = new Set(ap.filter((r) => r.type === 'found').map((r) => `${r.lat.toFixed(3)},${r.lng.toFixed(3)}`))
    if (spots.size >= 3) give('explorer')
    if (ap.length >= 10 && !m.some((r) => r.status === 'rejected')) give('careful')
  }

  function questList(): Quest[] {
    const since = weekStart()
    const ap = mine().filter((r) => r.status === 'approved' && new Date(r.createdAt).getTime() >= since)
    return QUESTS.map((q) => {
      const v = q.metric === 'found' ? ap.filter((r) => r.type === 'found').length
        : q.metric === 'collected' ? ap.filter((r) => r.type === 'collected').length : ap.length
      return { key: q.key, title: q.title, target: q.target, progress: Math.min(v, q.target), rewardCoins: q.reward, claimed: db.claims.includes(`${q.key}:${since}`) }
    })
  }

  function rankingRows(since: number) {
    const cnt = new Map<string, { name: string; c: number }>()
    for (const r of db.reports) {
      if (r.type !== 'collected' || r.status !== 'approved' || new Date(r.createdAt).getTime() < since) continue
      if (r.userId === ME && !db.me.showInRanking) continue
      const e = cnt.get(r.userId) ?? { name: r.userName ?? 'ユーザー', c: 0 }
      e.c++; cnt.set(r.userId, e)
    }
    const sorted = [...cnt.entries()].sort((a, b) => b[1].c - a[1].c)
    return sorted.map(([id, e], i) => ({ id, name: e.name, count: e.c, rank: 1 + sorted.findIndex((s) => s[1].c === e.c) + 0 * i }))
  }

  return {
    async getUser() { return db.me.signedIn ? profile() : null },
    async signUp(_e, _p, name) { db.me.name = name || 'デモユーザー'; db.me.signedIn = true; commit(); return profile() },
    async signIn() { db.me.signedIn = true; commit(); return profile() },
    async signOut() { db.me.signedIn = false; commit() },
    async acceptTerms() { need(); db.me.accepted = true; commit() },

    async listMapReports() {
      return db.reports
        .filter((r) => r.type === 'found' && !r.isCollected && !r.hidden && !db.blocks.includes(r.userId) &&
          (r.status === 'approved' || (r.status === 'pending' && r.userId === ME)))
        .map(pub)
    },
    async listMyReports() { need(); return mine().map(pub).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) },

    async submitReport(n: NewReport) {
      need()
      if (!db.me.accepted) throw new Error('TERMS_REQUIRED')
      const midnight = new Date(Date.now() + 9 * 3600e3); midnight.setUTCHours(0, 0, 0, 0)
      const dayStart = midnight.getTime() - 9 * 3600e3
      if (mine().filter((r) => new Date(r.createdAt).getTime() >= dayStart).length >= RULES.dailyCap) throw new Error('DAILY_CAP')
      const last = mine().at(-1)
      if (last && Date.now() - new Date(last.createdAt).getTime() < 10_000) throw new Error('RATE_LIMIT')
      if (n.type === 'found' && n.tags.length === 0) throw new Error('TAG_REQUIRED')
      if (n.type === 'collected') {
        if (!n.disposedConfirmed) throw new Error('DISPOSAL_CONFIRM_REQUIRED')
        if (n.tags.includes(HAZARD_TAG)) throw new Error('HAZARD_NOT_COLLECTIBLE')
        if (n.parentId) {
          const p = db.reports.find((r) => r.id === n.parentId)
          if (!p || p.type !== 'found' || p.status !== 'approved' || p.hidden) throw new Error('INVALID_PARENT')
          if (p.tags.includes(HAZARD_TAG)) throw new Error('HAZARD_NOT_COLLECTIBLE')
          if (p.isCollected) throw new Error('ALREADY_COLLECTED')
          if (haversineM(p.lat, p.lng, n.lat, n.lng) > RULES.collectLinkM) throw new Error('PARENT_TOO_FAR')
        }
      }
      const risk: string[] = []
      if (db.reports.some((r) => r.photoHash === n.photoHash)) risk.push('duplicate_photo')
      if (n.accuracyM != null && n.accuracyM > RULES.accuracyWarnM) risk.push('low_accuracy')
      const dup = mine().some((r) => r.type === n.type && r.status !== 'rejected' &&
        Date.now() - new Date(r.createdAt).getTime() < 24 * 3600e3 && haversineM(r.lat, r.lng, n.lat, n.lng) <= RULES.nearDuplicateM)
      const rec: Rec = {
        id: 'r' + db.seq++, userId: ME, userName: db.me.name, type: n.type, status: dup ? 'rejected' : 'pending',
        lat: n.lat, lng: n.lng, accuracyM: n.accuracyM, photoUrl: await blobToDataUrl(n.photo), photoHash: n.photoHash,
        tags: n.tags, note: n.note || null, parentId: n.type === 'collected' ? n.parentId : null, isCollected: false, hidden: false,
        riskFlags: risk, rejectReason: dup ? '同じ場所で短時間に同種の報告があるため、自動的に対象外になりました' : null,
        createdAt: new Date().toISOString(),
      }
      db.reports.push(rec); commit()
      return pub(rec)
    },
    async flagReport(id, reason) {
      need()
      const r = db.reports.find((x) => x.id === id)
      if (!r) throw new Error('NOT_FOUND')
      if (r.userId === ME) throw new Error('OWN_REPORT')
      db.flags.push({ id: db.seq++, reportId: id, reason, createdAt: new Date().toISOString(), open: true })
      if (db.flags.filter((f) => f.reportId === id && f.open).length >= 3) r.hidden = true
      commit()
    },
    async blockUser(userId) { need(); if (!db.blocks.includes(userId)) db.blocks.push(userId); commit() },
    async unblockUser(userId) { db.blocks = db.blocks.filter((b) => b !== userId); commit() },
    async listBlocks() {
      return db.blocks.map((b) => ({ userId: b, displayName: db.reports.find((r) => r.userId === b)?.userName ?? 'ユーザー' }))
    },

    async getMe(): Promise<MyData> {
      need()
      const ap = mine().filter((r) => r.status === 'approved')
      const badges: Badge[] = BADGES.map((b) => ({ ...b, owned: db.badges.includes(b.key) }))
      return {
        profile: profile(), xp: db.me.xp, level: levelForXp(db.me.xp), coins: db.me.coins,
        points: db.ledger.reduce((s, l) => s + l.delta, 0), badges, items: ITEMS, town: db.town,
        quests: questList(), ledger: [...db.ledger].reverse().slice(0, 30),
        counts: { found: ap.filter((r) => r.type === 'found').length, collected: ap.filter((r) => r.type === 'collected').length },
      }
    },
    async buyItem(itemKey, slot) {
      need()
      const it = ITEMS.find((i) => i.key === itemKey)
      if (!it) throw new Error('NOT_FOUND')
      if (slot < 0 || slot > 11) throw new Error('INVALID_SLOT')
      if (db.town.some((t) => t.slot === slot)) throw new Error('SLOT_TAKEN')
      if (db.me.coins < it.price) throw new Error('NOT_ENOUGH_COINS')
      db.me.coins -= it.price; db.town.push({ slot, itemKey }); commit()
    },
    async claimQuest(key) {
      need()
      const q = questList().find((x) => x.key === key)
      if (!q) throw new Error('NOT_FOUND')
      if (q.claimed) throw new Error('ALREADY_CLAIMED')
      if (q.progress < q.target) throw new Error('NOT_COMPLETED')
      db.claims.push(`${key}:${weekStart()}`); db.me.coins += q.rewardCoins; commit()
      return q.rewardCoins
    },
    async getRanking(period: Period): Promise<RankingResult> {
      need()
      const users = 1 + new Set(db.reports.map((r) => r.userId)).size
      const jst = new Date(Date.now() + 9 * 3600e3)
      const since = period === 'week' ? weekStart() : Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600e3
      const enabled = users >= RULES.rankingMinUsers
      if (!enabled) return { enabled, users, minUsers: RULES.rankingMinUsers, rows: [], me: null, optedOut: !db.me.showInRanking }
      const rows = rankingRows(since)
      const me = rows.find((r) => r.id === ME)
      return {
        enabled, users, minUsers: RULES.rankingMinUsers, optedOut: !db.me.showInRanking,
        rows: rows.slice(0, 10).map((r) => ({ rank: r.rank, name: r.name, count: r.count, isMe: r.id === ME })),
        me: me ? { rank: me.rank, count: me.count } : null,
      }
    },
    async setRankingVisible(v) { db.me.showInRanking = v; commit() },
    async setDisplayName(name) { db.me.name = name.slice(0, 20); commit() },
    async deleteAccount() { localStorage.removeItem(KEY); db = seed() },

    async adminPending() { return db.reports.filter((r) => r.status === 'pending').map(pub) },
    async adminReview(id, approve, reason) {
      const r = db.reports.find((x) => x.id === id)
      if (!r) throw new Error('NOT_FOUND')
      if (r.status !== 'pending') throw new Error('ALREADY_REVIEWED')
      if (!approve) {
        if (!reason?.trim()) throw new Error('REASON_REQUIRED')
        r.status = 'rejected'; r.rejectReason = reason; commit(); return
      }
      r.status = 'approved'
      if (r.type === 'collected' && r.parentId) {
        const p = db.reports.find((x) => x.id === r.parentId); if (p) p.isCollected = true
      }
      if (r.userId === ME) {
        const k = r.type
        db.ledger.push({ id: db.seq++, delta: POINTS[k], reason: k === 'found' ? 'ごみ発見の報告が承認されました' : 'ごみ回収の報告が承認されました', createdAt: new Date().toISOString() })
        db.me.xp += XP[k]; db.me.coins += COINS[k]; awardBadges()
      }
      commit()
    },
    async adminRevoke(id, reason) {
      if (!reason.trim()) throw new Error('REASON_REQUIRED')
      const r = db.reports.find((x) => x.id === id)
      if (!r || r.status !== 'approved') throw new Error('NOT_APPROVED')
      r.status = 'rejected'; r.rejectReason = '承認取り消し: ' + reason
      if (r.type === 'collected' && r.parentId) { const p = db.reports.find((x) => x.id === r.parentId); if (p) p.isCollected = false }
      if (r.userId === ME) {
        db.ledger.push({ id: db.seq++, delta: -POINTS[r.type], reason: '承認が取り消されました', createdAt: new Date().toISOString() })
        db.me.xp = Math.max(0, db.me.xp - XP[r.type]); db.me.coins = Math.max(0, db.me.coins - COINS[r.type])
      }
      commit()
    },
    async adminSetHidden(id, hidden) { const r = db.reports.find((x) => x.id === id); if (r) r.hidden = hidden; commit() },
    async adminFlags(): Promise<FlagRow[]> {
      return db.flags.filter((f) => f.open).map((f) => ({
        id: f.id, reportId: f.reportId, reason: f.reason, createdAt: f.createdAt,
        report: (() => { const r = db.reports.find((x) => x.id === f.reportId); return r ? pub(r) : null })(),
      }))
    },
    async adminResolveFlag(id, hide) {
      const f = db.flags.find((x) => x.id === id)
      if (f) { f.open = false; if (hide) { const r = db.reports.find((x) => x.id === f.reportId); if (r) r.hidden = true } }
      commit()
    },
    async adminMetrics(): Promise<Metrics> {
      const by = new Map<string, number>()
      db.reports.forEach((r) => by.set(r.userId, (by.get(r.userId) ?? 0) + 1))
      return {
        visits: new Set(db.events.filter((e) => e.name === 'visit').map((e) => e.client)).size,
        signups: by.size, first_report: by.size, repeat_users: [...by.values()].filter((v) => v >= 2).length,
        retained_7d: 0, weekly_active: by.size, reports_total: db.reports.length,
        pending: db.reports.filter((r) => r.status === 'pending').length,
        approved: db.reports.filter((r) => r.status === 'approved').length,
        rejected: db.reports.filter((r) => r.status === 'rejected').length,
        avg_review_hours: null, open_flags: db.flags.filter((f) => f.open).length,
      }
    },
    async adminUsers(): Promise<AdminUser[]> {
      const ids = new Map<string, string>()
      db.reports.forEach((r) => ids.set(r.userId, r.userName ?? 'ユーザー'))
      return [...ids].filter(([id]) => id !== ME).map(([id, name]) => ({
        id, displayName: name, isSuspended: db.suspended.includes(id), createdAt: new Date().toISOString(),
        reports: db.reports.filter((r) => r.userId === id).length,
      }))
    },
    async adminSuspend(userId, suspend) {
      db.suspended = suspend ? [...new Set([...db.suspended, userId])] : db.suspended.filter((x) => x !== userId); commit()
    },
    async track(name) { db.events.push({ client: 'demo', name }); commit() },
  }
}
