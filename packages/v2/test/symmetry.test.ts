import { describe, expect, it } from 'vitest'
import {
  createGame,
  DEFAULT_MIXED,
  deploy,
  makeV2Config,
  mirror,
  mirrorState,
  planDeployment,
  planTurnMixed,
  randomDeck,
  resolveTurn,
  type GameState,
} from '../src/index.ts'

const fast = { ...DEFAULT_MIXED, candidates: 6, iterations: 100 }

function start(seed: number): GameState {
  const cfg = makeV2Config()
  const g = createGame({ A: randomDeck(cfg, `x${seed}`), B: randomDeck(cfg, `y${seed}`) }, cfg)
  return deploy(g, { A: planDeployment(g, 'A', g.teams.A, seed), B: planDeployment(g, 'B', g.teams.B, seed + 1) })
}

describe('진영 대칭', () => {
  it('엔진: 뒤집은 판을 처리한 결과 = 처리 결과를 뒤집은 것 (여러 판·여러 턴)', () => {
    for (let seed = 1; seed <= 4; seed++) {
      let s = start(seed)
      for (let t = 0; t < 8 && s.phase === 'plan'; t++) {
        const plans = { A: planTurnMixed(s, 'A', `a${t}`, fast), B: planTurnMixed(s, 'B', `b${t}`, fast) }
        const r = resolveTurn(s, plans)
        const rm = resolveTurn(mirrorState(s), mirror(plans, s.config.boardHeight))
        expect(rm.state).toEqual(mirrorState(r.state))
        // 같은 행동 안 이벤트 기록 순서(A 먼저)만 다를 수 있어 순서 무시하고 비교
        const norm = (l: typeof r.log) => ({ ...l, steps: l.steps.map((st) => st.map((e) => JSON.stringify(e)).sort()), endEvents: l.endEvents.map((e) => JSON.stringify(e)).sort() })
        expect(norm(rm.log)).toEqual(norm(mirror(r.log, s.config.boardHeight)))
        s = r.state
      }
    }
  })

  it('AI: B 자리에서 두는 수 = A 자리에서 두는 수를 뒤집은 것', () => {
    const s = start(7)
    const m = mirrorState(s)
    expect(planTurnMixed(m, 'B', 'z', fast)).toEqual(mirror(planTurnMixed(s, 'A', 'z', fast), s.config.boardHeight))
    expect(planDeployment(m, 'B', m.teams.B, 3)).toEqual(mirror(planDeployment(s, 'A', s.teams.A, 3), s.config.boardHeight))
  })
})
