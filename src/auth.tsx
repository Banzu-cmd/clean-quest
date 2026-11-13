import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { getApi, type Api } from './lib/api'
import type { Profile } from './types'

interface Ctx {
  api: Api | null
  user: Profile | null
  loading: boolean
  fatal: string | null
  refresh: () => Promise<void>
  setUser: (p: Profile | null) => void
}
const AuthCtx = createContext<Ctx>({ api: null, user: null, loading: true, fatal: null, refresh: async () => {}, setUser: () => {} })
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<Api | null>(null)
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    getApi().then(async (a) => {
      setApi(a)
      try { setUser(await a.getUser()) } catch { setUser(null) }
      a.track('visit').catch(() => {})
      setLoading(false)
    }).catch((e) => { setFatal(e instanceof Error ? e.message : String(e)); setLoading(false) })
  }, [])

  const refresh = useCallback(async () => { if (api) setUser(await api.getUser()) }, [api])
  return <AuthCtx.Provider value={{ api, user, loading, fatal, refresh, setUser }}>{children}</AuthCtx.Provider>
}
