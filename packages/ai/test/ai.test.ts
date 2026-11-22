import { describe, expect, it } from 'vitest'
import {
  createGame,
  deploy,
  makeGachaContext,
  resolveTurn,
  validateDeployment,
  validatePlan,
  type GameState,
} from '@war/engine'
import { buildAiDeck, planDeployment, planTurn } from '../src/index.ts'
import { P, scenario, tmpl } from '../../engine/test/helpers.ts'

const ctx = makeGachaContext()

function aiGame(seed: number): { state: GameState; turns: number } {
  let state = createGame({ teams: { A: buildAiDeck(ctx, `a${seed}`), B: buildAiDeck(ctx, `b${seed}`) } })
  const depA = planDeployment(state, 'A', state.teams.A, seed)
  const depB = planDeployment(state, 'B', state.teams.B, seed)
  expect(validateDeployment(state, 'A', depA).ok).toBe(true)
  expect(validateDeployment(state, 'B', depB).ok).toBe(true)
  state = deploy(state, { A: depA, B: depB })
  let turns = 0
  while (state.phase === 'plan') {
    const A = planTurn(state, 'A', seed)
    const B = planTurn(state, 'B', seed + 1)
    expect(validatePlan(state, 'A', A).ok).toBe(true)
    expect(validatePlan(state, 'B', B).ok).toBe(true)
    state = resolveTurn(state, { A, B }).state
    turns++
  }
  return { state, turns }
}

describe('규칙 기반 AI', () => {
  it('AI 대 AI 50판: 항상 유효한 입력, 항상 종료', () => {
    let annihilation = 0
    for (let seed = 1; seed <= 50; seed++) {
      const { state, turns } = aiGame(seed)
      expect(state.result).not.toBeNull()
      expect(turns).toBeLessThanOrEqual(state.config.maxTurns)
      if (state.result!.reason === 'annihilation') annihilation++
    }
    // AI 가 실제로 교전한다는 회귀 지표 (결정적이므로 흔들리지 않음).
    // 방어력·보호막·회복 도입 후 턴제한 종료가 많아짐 → balance.sim 참고 (교착 문제)
    expect(annihilation).toBeGreaterThanOrEqual(10)
  })

  it('결정적: 같은 상태·시드 → 같은 입력', () => {
    const s = aiGame(7)
    expect(JSON.stringify(aiGame(7))).toBe(JSON.stringify(s))
  })

  it('맞힐 수 있는 대상 중 체력 낮은(처치 가능한) 카드 우선', () => {
    const lobber = tmpl('lobber', { trajectory: { kind: 'lob', minRange: 1, maxRange: 4 }, base: { atk: 5, hp: 20 } })
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: lobber },
      { side: 'B', pos: P(1, 1), t: tmpl('healthy', { base: { hp: 30 } }) },
      { side: 'B', pos: P(3, 1), t: tmpl('weak', { base: { hp: 30 } }) },
    ])
    s.units.B1!.hp = 4
    const first = planTurn(s, 'A', 1).find((a) => a.type === 'attack')
    expect(first).toEqual({ type: 'attack', unit: 'A0', aim: { kind: 'cell', pos: P(3, 1) } })
  })

  it('위협받고 반격할 수 없는 카드는 회피 이동', () => {
    const cannon = tmpl('cannon', { base: { atk: 9 }, trajectory: { kind: 'straight', range: 4 } })
    const pacifist = tmpl('pacifist', { base: { atk: 1, hp: 10 }, trajectory: { kind: 'diagonal', range: 1 } })
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: pacifist },
      { side: 'B', pos: P(2, 0), t: cannon },
    ])
    const p = planTurn(s, 'A', 1)
    expect(p[0]!.type).toBe('move')
    if (p[0]!.type === 'move') expect(p[0]!.to.x).not.toBe(2)
  })
})
