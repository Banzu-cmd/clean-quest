import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../../config'
import type {
  AdminUser, Badge, EventName, FlagRow, LedgerRow, Metrics, MyData, NewReport, Period, Profile,
  Quest, RankingResult, Report, ShopItem, TownSlot,
} from '../../types'
import type { Api } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>

function mapReport(r: Row): Report {
  return {
    id: r.id, userId: r.user_id, userName: r.profiles?.display_name,
    type: r.type, status: r.status, lat: r.lat, lng: r.lng, accuracyM: r.accuracy_m,
    photoUrl: r.photo_url, tags: r.trash_tags ?? [], note: r.note, parentId: r.parent_report_id,
    isCollected: r.is_collected, hidden: r.hidden, riskFlags: r.risk_flags ?? [],
    rejectReason: r.reject_reason, createdAt: r.created_at,
  }
}

function clientId(): string {
  try {
    let id = localStorage.getItem('cq_client')
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('cq_client', id) }
    return id
  } catch { return 'unknown' }
}

export async function createSupabaseApi(): Promise<Api> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が設定されていません。README を確認してください。')
  }
  const sb: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

  const rpc = async <T = any>(fn: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data as T
  }
  const photoUrl = (path: string) => sb.storage.from('report-photos').getPublicUrl(path).data.publicUrl
  const withUrl = (r: Row): Report => mapReport({ ...r, photo_url: photoUrl(r.photo_path) })
  const uid = async (): Promise<string> => {
    const { data } = await sb.auth.getUser()
    if (!data.user) throw new Error('NOT_AUTHORIZED')
    return data.user.id
  }

  async function loadProfile(): Promise<Profile | null> {
    const { data: u } = await sb.auth.getUser()
    if (!u.user) return null
    const { data, error } = await sb.from('profiles').select('*').eq('id', u.user.id).single()
    if (error || !data) return null
    return {
      id: data.id, displayName: data.display_name, role: data.role, isSuspended: data.is_suspended,
      showInRanking: data.show_in_ranking, termsAccepted: !!data.terms_accepted_at, email: u.user.email ?? undefined,
    }
  }

  const SEL = '*, profiles(display_name)'

  return {
    getUser: loadProfile,
    async signUp(email, password, displayName) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: displayName } } })
      if (error) throw new Error(error.message)
      if (!data.session) return null // メール確認が必要な設定の場合
      return loadProfile()
    },
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password })
      if (error) throw new Error(error.message)
      const p = await loadProfile()
      if (!p) throw new Error('NOT_AUTHORIZED')
      return p
    },
    async signOut() { await sb.auth.signOut() },
    async acceptTerms() { await rpc('accept_terms') },

    async listMapReports() {
      const { data, error } = await sb.from('reports').select(SEL)
        .eq('type', 'found').eq('is_collected', false).eq('hidden', false)
        .in('status', ['approved', 'pending']).order('created_at', { ascending: false }).limit(500)
      if (error) throw new Error(error.message)
      // pending は RLS により自分の分だけ返る
      return (data ?? []).map(withUrl)
    },
    async listMyReports() {
      const id = await uid()
      const { data, error } = await sb.from('reports').select(SEL).eq('user_id', id)
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw new Error(error.message)
      return (data ?? []).map(withUrl)
    },
    async submitReport(r: NewReport) {
      const id = await uid()
      const path = `${id}/${crypto.randomUUID()}.jpg`
      const up = await sb.storage.from('report-photos').upload(path, r.photo, { contentType: 'image/jpeg' })
      if (up.error) throw new Error(up.error.message)
      const { data, error } = await sb.from('reports').insert({
        user_id: id, type: r.type, lat: r.lat, lng: r.lng, accuracy_m: r.accuracyM,
        photo_path: path, photo_hash: r.photoHash, trash_tags: r.tags, note: r.note || null,
        parent_report_id: r.parentId, disposed_confirmed: r.disposedConfirmed,
      }).select(SEL).single()
      if (error) {
        await sb.storage.from('report-photos').remove([path]) // 失敗時は写真も消す
        throw new Error(error.message)
      }
      return withUrl(data)
    },
    async flagReport(id, reason) { await rpc('flag_report', { p_report_id: id, p_reason: reason }) },
    async blockUser(userId) { await rpc('block_user', { p_user: userId }) },
    async unblockUser(userId) { await rpc('unblock_user', { p_user: userId }) },
    async listBlocks() {
      const rows = await rpc<Row[]>('my_blocks')
      return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name }))
    },

    async getMe(): Promise<MyData> {
      const id = await uid()
      const profile = await loadProfile()
      if (!profile) throw new Error('NOT_AUTHORIZED')
      const [prog, points, badgesAll, owned, itemsAll, town, quests, ledger, counts] = await Promise.all([
        sb.from('user_progress').select('*').eq('user_id', id).single(),
        rpc<number>('my_points'),
        sb.from('badges').select('*').order('sort'),
        sb.from('user_badges').select('badge_key').eq('user_id', id),
        sb.from('items').select('*').order('sort'),
        sb.from('user_items').select('slot,item_key').eq('user_id', id),
        rpc<Row[]>('my_weekly_quests'),
        sb.from('point_ledger').select('*').eq('user_id', id).order('created_at', { ascending: false }).limit(30),
        sb.from('reports').select('type').eq('user_id', id).eq('status', 'approved'),
      ])
      const ownedSet = new Set((owned.data ?? []).map((b: Row) => b.badge_key))
      const badges: Badge[] = (badgesAll.data ?? []).map((b: Row) => ({
        key: b.key, name: b.name, description: b.description, emoji: b.emoji, owned: ownedSet.has(b.key),
      }))
      const items: ShopItem[] = (itemsAll.data ?? []).map((i: Row) => ({ key: i.key, name: i.name, emoji: i.emoji, price: i.price }))
      const townSlots: TownSlot[] = (town.data ?? []).map((t: Row) => ({ slot: t.slot, itemKey: t.item_key }))
      const qs: Quest[] = quests.map((q) => ({
        key: q.key, title: q.title, target: q.target, progress: q.progress, rewardCoins: q.reward_coins, claimed: q.claimed,
      }))
      const led: LedgerRow[] = (ledger.data ?? []).map((l: Row) => ({ id: l.id, delta: l.delta, reason: l.reason, createdAt: l.created_at }))
      const rows = (counts.data ?? []) as Row[]
      return {
        profile, xp: prog.data?.xp ?? 0, level: prog.data?.level ?? 1, coins: prog.data?.coins ?? 0, points,
        badges, items, town: townSlots, quests: qs, ledger: led,
        counts: { found: rows.filter((r) => r.type === 'found').length, collected: rows.filter((r) => r.type === 'collected').length },
      }
    },
    async buyItem(itemKey, slot) { await rpc('buy_item', { p_item_key: itemKey, p_slot: slot }) },
    async claimQuest(key) { return rpc<number>('claim_quest', { p_key: key }) },
    async getRanking(period: Period): Promise<RankingResult> {
      const r = await rpc<Row>('get_ranking', { p_period: period })
      return {
        enabled: r.enabled, users: r.users, minUsers: r.min_users, optedOut: r.opted_out,
        rows: (r.rows ?? []).map((x: Row) => ({ rank: x.rank, name: x.name, count: x.count, isMe: x.is_me })),
        me: r.me ? { rank: r.me.rank, count: r.me.count } : null,
      }
    },
    async setRankingVisible(v) {
      const { error } = await sb.from('profiles').update({ show_in_ranking: v }).eq('id', await uid())
      if (error) throw new Error(error.message)
    },
    async setDisplayName(name) {
      const { error } = await sb.from('profiles').update({ display_name: name.slice(0, 20) }).eq('id', await uid())
      if (error) throw new Error(error.message)
    },
    async deleteAccount() { await rpc('delete_my_account'); await sb.auth.signOut() },

    async adminPending() {
      const { data, error } = await sb.from('reports').select(SEL).eq('status', 'pending').order('created_at')
      if (error) throw new Error(error.message)
      return (data ?? []).map(withUrl)
    },
    async adminReview(id, approve, reason) { await rpc('review_report', { p_report_id: id, p_approve: approve, p_reason: reason ?? null }) },
    async adminRevoke(id, reason) { await rpc('admin_revoke_report', { p_report_id: id, p_reason: reason }) },
    async adminSetHidden(id, hidden) { await rpc('admin_set_hidden', { p_report_id: id, p_hidden: hidden }) },
    async adminFlags(): Promise<FlagRow[]> {
      const { data, error } = await sb.from('report_flags').select('*').eq('status', 'open').order('created_at')
      if (error) throw new Error(error.message)
      const ids = [...new Set((data ?? []).map((f: Row) => f.report_id))]
      const reps = ids.length ? (await sb.from('reports').select(SEL).in('id', ids)).data ?? [] : []
      const byId = new Map(reps.map((r: Row) => [r.id, withUrl(r)]))
      return (data ?? []).map((f: Row) => ({
        id: f.id, reportId: f.report_id, reason: f.reason, createdAt: f.created_at, report: byId.get(f.report_id) ?? null,
      }))
    },
    async adminResolveFlag(id, hide) { await rpc('admin_resolve_flag', { p_flag_id: id, p_hide: hide }) },
    async adminMetrics() { return rpc<Metrics>('admin_metrics') },
    async adminUsers(): Promise<AdminUser[]> {
      const [p, r] = await Promise.all([
        sb.from('profiles').select('id,display_name,is_suspended,created_at').eq('role', 'user').order('created_at', { ascending: false }),
        sb.from('reports').select('user_id'),
      ])
      const cnt = new Map<string, number>()
      for (const x of (r.data ?? []) as Row[]) cnt.set(x.user_id, (cnt.get(x.user_id) ?? 0) + 1)
      return ((p.data ?? []) as Row[]).map((u) => ({
        id: u.id, displayName: u.display_name, isSuspended: u.is_suspended, createdAt: u.created_at, reports: cnt.get(u.id) ?? 0,
      }))
    },
    async adminSuspend(userId, suspend) { await rpc('admin_suspend_user', { p_user: userId, p_suspend: suspend }) },

    async track(name: EventName) {
      const { data } = await sb.auth.getUser()
      await sb.from('events').insert({ client_id: clientId(), name, user_id: data.user?.id ?? null })
    },
  }
}
