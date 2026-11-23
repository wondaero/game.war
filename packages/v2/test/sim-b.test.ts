import { describe, it } from 'vitest'
import { ABILITIES, ABILITY_KINDS } from '../src/index.ts'
import { avgDeck, countFires, duel, pct, RUN } from './simlib.ts'

describe.skipIf(!RUN)('B. 특수능력별', () => {
  it('평범 덱 vs 같은 덱 + 1명에게 능력 (최고 등급)', () => {
    const N = 60
    const rows: [string, number, number][] = []
    for (const kind of ABILITY_KINDS) {
      let fired = 0
      const r = duel(() => avgDeck({ kind, tier: ABILITIES[kind].tiers.length - 1 }), () => avgDeck(), N, {
        onGame: (p, xSide) => (fired += countFires(kind, `${xSide}0`, p.events)),
      })
      rows.push([ABILITIES[kind].name, r.rate, fired / N])
    }
    rows.sort((x, y) => y[1] - x[1])
    console.log('[능력] 능력 쪽 승률 (최고 등급) · 판당 발동')
    for (const [name, rate, f] of rows) console.log(`   ${name.padEnd(12)} ${pct(rate)} · ${f.toFixed(1)}회`)
  }, 3_600_000)
})
