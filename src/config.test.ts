import { describe, expect, it } from 'vitest'
import { levelForXp, levelProgress, xpForLevel } from './config'
import { haversineM } from './lib/geo'

describe('level math', () => {
  it('xpForLevel/levelForXp are inverse at boundaries', () => {
    for (let l = 1; l <= 30; l++) {
      expect(levelForXp(xpForLevel(l))).toBe(l)
      expect(levelForXp(xpForLevel(l + 1) - 1)).toBe(l)
    }
  })
  it('progress is within the level', () => {
    const p = levelProgress(60)
    expect(p.level).toBe(2)
    expect(p.current).toBe(10)
    expect(p.needed).toBe(100)
  })
})
describe('haversine', () => {
  it('is zero for same point and about 111m per 0.001 lat', () => {
    expect(haversineM(35, 139, 35, 139)).toBe(0)
    expect(haversineM(35, 139, 35.001, 139)).toBeGreaterThan(110)
    expect(haversineM(35, 139, 35.001, 139)).toBeLessThan(112)
  })
})
