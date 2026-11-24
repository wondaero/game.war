import { describe, it } from 'vitest'
import { makeV2Config, randomDeck, type V2Config } from '../src/index.ts'
import { mixed, pct, play, RUN } from './simlib.ts'

/** 진영 차이: 같은 덱 쌍을 진영만 바꿔 두 번씩 (덱 운과 진영 효과를 분리) */
function sideReport(name: string, config: Partial<V2Config>, N = 300) {
  const cfg = makeV2Config(config)
  let aWins = 0, bWins = 0, draws = 0, xWins = 0, sameWinnerSide = 0, sameWinnerDeck = 0
  for (let i = 0; i < N; i++) {
    const X = randomDeck(cfg, `ra${i}`), Y = randomDeck(cfg, `rb${i}`)
    const g1 = play(X, Y, i, mixed, mixed, config).s.result!.winner // X = A
    const g2 = play(Y, X, i, mixed, mixed, config).s.result!.winner // X = B
    for (const w of [g1, g2]) w === 'A' ? aWins++ : w === 'B' ? bWins++ : draws++
    xWins += (g1 === 'A' ? 1 : g1 === 'draw' ? 0.5 : 0) + (g2 === 'B' ? 1 : g2 === 'draw' ? 0.5 : 0)
    if (g1 !== 'draw' && g1 === g2) sameWinnerSide++ // 진영이 같은 쪽이 두 번 다 이김 → 진영 효과
    if (g1 !== 'draw' && g2 !== 'draw' && g1 !== g2) sameWinnerDeck++ // 같은 덱이 두 번 다 이김 → 덱 효과
  }
  const G = N * 2
  console.log(
    `[진영] ${name.padEnd(14)} A ${pct(aWins / G)} · B ${pct(bWins / G)} · 무 ${pct(draws / G)} | 덱 X(ra) 승률 ${pct(xWins / G)} | 쌍 ${N}개 중: 같은 덱이 2연승 ${sameWinnerDeck} · 같은 진영이 2연승 ${sameWinnerSide}`,
  )
}

describe.skipIf(!RUN)('진영 차이', () => {
  it('오리지날', () => sideReport('오리지날', {}), 3_600_000)
  it('위험지대(이벤트)', () => sideReport('위험지대(이벤트)', { dangerZoneStartTurn: 5 }), 3_600_000)
})
