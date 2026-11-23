/** SIM=1 npx vitest run packages/v2/test/sim- */
import { describe, it } from 'vitest'
import { makeV2Config, randomDeck } from '../src/index.ts'
import { attackOnly, dodgeHeavy, duel, greedyFirst, greedyLast, pct, play, RUN } from './simlib.ts'

const cfg = makeV2Config()

describe.skipIf(!RUN)('A. AI 검증 · 기본 지표', () => {
  it('꼼수 AI에게 지지 않는지 (같은 덱, 혼합 AI 쪽 승률)', () => {
    const N = 60
    for (const [name, p] of [
      ['탐욕 (먼저 이동)', greedyFirst],
      ['탐욕 (나중 이동)', greedyLast],
      ['공격만 (최소 이동)', attackOnly],
      ['회피 위주', dodgeHeavy],
    ] as const) {
      const r = duel((i) => randomDeck(cfg, `x${i}`), (i) => randomDeck(cfg, `x${i}`), N, { py: p })
      console.log(`[검증] 혼합 AI vs ${name.padEnd(12)} ${pct(r.rate)}`)
    }
  }, 1_800_000)

  it('혼합 AI끼리 무작위 뽑기 덱', () => {
    const N = 200
    let a = 0, b = 0, d = 0, turns = 0, maxT = 0, moves = 0, acts = 0
    for (let i = 0; i < N; i++) {
      const p = play(randomDeck(cfg, `ra${i}`), randomDeck(cfg, `rb${i}`), i)
      const r = p.s.result!
      r.winner === 'A' ? a++ : r.winner === 'B' ? b++ : d++
      turns += p.s.turn - 1
      if (r.reason === 'maxTurns') maxT++
      for (const e of p.events) {
        if (e.type === 'move' || e.type === 'attack' || e.type === 'buff') acts++
        if (e.type === 'move') moves++
      }
    }
    console.log(`[기본] ${N}판 · 아래(A) ${pct(a / N)} / 위(B) ${pct(b / N)} / 무 ${pct(d / N)} · 평균 ${(turns / N).toFixed(1)}턴 · 20턴 판정 ${pct(maxT / N)} · 행동 중 이동 ${pct(moves / acts)}`)
  }, 1_800_000)
})
