import { describe, it } from 'vitest'
import { makeV2Config, STAT_KEYS, type Stats } from '../src/index.ts'
import { AVG, avgDeck, duel, fixedDeck, pct, RUN, unit } from './simlib.ts'

const cfg = makeV2Config()

describe.skipIf(!RUN)('C. 능력치 격차', () => {
  it('고정 덱 비교', () => {
    const N = 60
    const best: Stats = { atk: 20, armor: 5, hp: 50, move: 2, range: 10 }
    const worst: Stats = { atk: 15, armor: 1, hp: 30, move: 1, range: 5 }
    for (const [name, X, Y] of [
      ['최고 vs 평범', () => fixedDeck(best), () => avgDeck()],
      ['평범 vs 최악', () => avgDeck(), () => fixedDeck(worst)],
      ['최고 vs 최악', () => fixedDeck(best), () => fixedDeck(worst)],
    ] as const) {
      const r = duel(X, Y, N)
      console.log(`[격차] ${name.padEnd(10)} ${pct(r.rate)} · 평균 ${r.turns.toFixed(1)}턴 · 20턴 판정 ${pct(r.maxT)}`)
    }
    const bumps: [string, Partial<Stats>][] = [
      ['공격력 +2', { atk: 2 }],
      ['방어력 +1', { armor: 1 }],
      ['체력 +5', { hp: 5 }],
      ['이동력 +1 (최대 2)', { move: 1 }],
      ['사거리 +2', { range: 2 }],
    ]
    console.log('[격차] 평범 덱 4명 전원 한 단계 올림 vs 평범')
    for (const [name, d] of bumps) {
      const up = () =>
        AVG.map((s, i) => {
          const t = { ...s }
          for (const k of STAT_KEYS) t[k] = Math.min(cfg.statRanges[k].max, t[k] + (d[k] ?? 0))
          return unit(i, t)
        })
      console.log(`   ${name.padEnd(16)} ${pct(duel(up, () => avgDeck(), N).rate)}`)
    }
  }, 3_600_000)
})
