import { DEMO } from '../../config'
import type { Api } from './types'

let cached: Promise<Api> | null = null
export function getApi(): Promise<Api> {
  if (!cached) {
    cached = DEMO
      ? import('./demo').then((m) => m.createDemoApi())
      : import('./supabase').then((m) => m.createSupabaseApi())
  }
  return cached
}
export type { Api }
