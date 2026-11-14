import type {
  AdminUser, Comment, ContentFlagRow, EventName, NewPost, Post, PostKind, FlagRow, Metrics, MyData, NewReport, Period, Profile, RankingResult, Report,
} from '../../types'

export interface Api {
  // 認証
  getUser(): Promise<Profile | null>
  signUp(email: string, password: string, displayName: string): Promise<Profile | null>
  signIn(email: string, password: string): Promise<Profile>
  signOut(): Promise<void>
  acceptTerms(): Promise<void>
  // 地図・報告
  listMapReports(): Promise<Report[]>
  listMyReports(): Promise<Report[]>
  submitReport(r: NewReport): Promise<Report>
  flagReport(id: string, reason: string): Promise<void>
  blockUser(userId: string): Promise<void>
  unblockUser(userId: string): Promise<void>
  listBlocks(): Promise<{ userId: string; displayName: string }[]>
  // みんな(募集・発信)
  listPosts(kind?: PostKind): Promise<Post[]>
  getPost(id: string): Promise<Post | null>
  createPost(p: NewPost): Promise<string>
  joinEvent(id: string): Promise<void>
  leaveEvent(id: string): Promise<void>
  toggleLike(id: string): Promise<boolean>
  listComments(postId: string): Promise<Comment[]>
  addComment(postId: string, body: string): Promise<void>
  deleteComment(id: string): Promise<void>
  removePost(id: string): Promise<void>
  flagContent(type: 'post' | 'comment', id: string, reason: string): Promise<void>
  // マイページ・ゲーム
  getMe(): Promise<MyData>
  buyItem(itemKey: string, slot: number): Promise<void>
  claimQuest(key: string): Promise<number>
  getRanking(period: Period): Promise<RankingResult>
  setRankingVisible(v: boolean): Promise<void>
  setDisplayName(name: string): Promise<void>
  deleteAccount(): Promise<void>
  // 管理
  adminPending(): Promise<Report[]>
  adminReview(id: string, approve: boolean, reason?: string): Promise<void>
  adminRevoke(id: string, reason: string): Promise<void>
  adminSetHidden(id: string, hidden: boolean): Promise<void>
  adminFlags(): Promise<FlagRow[]>
  adminResolveFlag(id: number, hide: boolean): Promise<void>
  adminContentFlags(): Promise<ContentFlagRow[]>
  adminResolveContentFlag(id: number, hide: boolean): Promise<void>
  adminMetrics(): Promise<Metrics>
  adminUsers(): Promise<AdminUser[]>
  adminSuspend(userId: string, suspend: boolean): Promise<void>
  // 計測
  track(name: EventName): Promise<void>
}
