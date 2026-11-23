import { describe, it } from 'vitest'
import { ABILITIES, ABILITY_KINDS, makeV2Config, randomDeck, STAT_KEYS, type Ability, type UnitInstance } from '../src/index.ts'
import { duel, pct, RUN } from './simlib.ts'

const cfg = makeV2Config()

describe.skipIf(!RUN)('D. 실제 뽑기 분포', () => {
  it('능력치 상위 10% vs 중간 vs 하위 10% (특수능력 없음)', () => {
    const score = (d: UnitInstance[]) =>
      d.reduce((s, u) => s + STAT_KEYS.reduce((x, k) => x + (u.stats[k] - cfg.statRanges[k].min) / (cfg.statRanges[k].max - cfg.statRanges[k].min), 0), 0)
    const strip = (d: UnitInstance[]) => d.map((u) => ({ ...u, ability: null }))
    const decks = Array.from({ length: 3000 }, (_, i) => strip(randomDeck(cfg, `pool${i}`))).sort((x, y) => score(y) - score(x))
    const top = decks.slice(0, 300), mid = decks.slice(1350, 1650), low = decks.slice(2700, 3000)
    const N = 80
    console.log(`[뽑기] 상위 10% vs 중간 ${pct(duel((i) => top[i]!, (i) => mid[i]!, N).rate)} · 중간 vs 하위 10% ${pct(duel((i) => mid[i]!, (i) => low[i]!, N).rate)} · 상위 vs 하위 ${pct(duel((i) => top[i]!, (i) => low[i]!, N).rate)}`)
  }, 3_600_000)

  it('특수능력 개수 (능력치 같은 무작위 덱, 한쪽에만 n개)', () => {
    const N = 80
    for (const n of [1, 2, 4]) {
      const r = duel(
        (i) => {
          const base = randomDeck(cfg, `sp${i}`).map((u) => ({ ...u, ability: null as Ability | null }))
          for (let k = 0; k < n; k++) {
            const kind = ABILITY_KINDS[(i * 7 + k * 5) % ABILITY_KINDS.length]!
            base[k]!.ability = { kind, tier: (i + k) % ABILITIES[kind].tiers.length }
          }
          return base
        },
        (i) => randomDeck(cfg, `sp${i}`).map((u) => ({ ...u, ability: null })),
        N,
      )
      console.log(`[능력 수] ${n}개 vs 0개: ${pct(r.rate)}`)
    }
  }, 3_600_000)
})
