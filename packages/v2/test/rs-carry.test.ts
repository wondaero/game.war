import { describe, it } from 'vitest'
import { duel, pct, RUN, unit, AVG } from './simlib.ts'
import { RULESETS } from './rulesets.ts'
import type { Stats } from '../src/index.ts'

/** 몰빵 덱(최강 1명 + 최약 3명) vs 평균 4명 */
const best: Stats = { atk: 20, armor: 5, hp: 50, move: 2, range: 10 }
const weak: Stats = { atk: 15, armor: 1, hp: 30, move: 1, range: 5 }
const carry = () => [unit(0, best), unit(1, weak), unit(2, weak), unit(3, weak)]
const even = () => AVG.map((s, i) => unit(i, s))
describe.skipIf(!RUN)('몰빵 vs 고른 덱', () => {
  for (const [name, config] of Object.entries(RULESETS))
    it(name, () => {
      const r = duel(carry, even, 60, { config })
      console.log(`[몰빵] ${name.padEnd(20)} 몰빵 덱 승률 ${pct(r.rate)} · 평균 ${r.turns.toFixed(1)}턴 · 판정 ${pct(r.maxT)}`)
    }, 3_600_000)
})
