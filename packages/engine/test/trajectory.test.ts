import { describe, expect, it } from 'vitest'
import { CROSS_5 } from '../src/cards/catalog.ts'
import { resolveTurn } from '../src/resolve.ts'
import type { StepEvent, TurnLog } from '../src/types.ts'
import { validatePlan } from '../src/validate.ts'
import { P, idle, lob, plan, scenario, shoot, tmpl } from './helpers.ts'

const attacks = (log: TurnLog) =>
  log.steps.flatMap((s) => s.events).filter((e): e is Extract<StepEvent, { type: 'attack' }> => e.type === 'attack')

const target = tmpl('target', { base: { hp: 50 } })

describe('직사', () => {
  const gun = tmpl('gun', { trajectory: { kind: 'straight', range: 4 }, base: { atk: 5 } })

  it('관통: 사선의 적을 순서대로 맞히고 뒤로 갈수록 피해 50%씩 감소', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(2, 2), t: target },
      { side: 'B', pos: P(2, 1), t: target },
      { side: 'B', pos: P(2, 0), t: target },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    const [a] = attacks(r.log)
    expect(a!.hits.map((h) => [h.target, h.pierceIndex, h.base])).toEqual([
      ['B0', 0, 5],
      ['B1', 1, 2], // floor(5 × 0.5)
      ['B2', 2, 1], // floor(2 × 0.5)
    ])
    expect(a!.path).toEqual([P(2, 3), P(2, 2), P(2, 1), P(2, 0)])
  })

  it('관통 피해에도 방어력 적용 (최소 1)', () => {
    const armored = tmpl('armored', { base: { hp: 50, armor: 3 } })
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(2, 1), t: target },
      { side: 'B', pos: P(2, 0), t: armored },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(attacks(r.log)[0]!.hits.map((h) => h.afterArmor)).toEqual([5, 1]) // max(1, 2 − 3)
  })

  it('적 뒤의 아군에서 멈춤 (앞의 적은 맞고, 아군·그 뒤는 안 맞음)', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(2, 0), t: target },
      { side: 'B', pos: P(2, 3), t: target },
    ])
    // A 시점: (2,3) 적 → 관통 계속 → (2,0) 적. 아군 차단 확인은 아래 테스트
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(attacks(r.log)[0]!.hits.map((h) => h.target)).toEqual(['B1', 'B0'])
    const s2 = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(2, 3), t: target },
      { side: 'A', pos: P(2, 2), t: target },
      { side: 'B', pos: P(2, 0), t: target },
    ])
    const r2 = resolveTurn(s2, { A: plan(shoot('A0', 'up')), B: idle() })
    const [a2] = attacks(r2.log)
    expect(a2!.hits.map((h) => h.target)).toEqual(['B0'])
    expect(a2!.blockedBy).toBe('A1')
    expect(r2.state.units.A1!.hp).toBe(50)
  })

  it('관통 감쇠 0 (config 또는 챔프 데이터) → 첫 적에서 멈춤', () => {
    const place = (t: ReturnType<typeof tmpl>, cfg = {}) =>
      scenario(
        [
          { side: 'A', pos: P(2, 4), t },
          { side: 'B', pos: P(2, 1), t: target },
          { side: 'B', pos: P(2, 0), t: target },
        ],
        { config: cfg },
      )
    const byConfig = resolveTurn(place(gun, { lineFalloffBp: 0 }), { A: plan(shoot('A0', 'up')), B: idle() })
    expect(attacks(byConfig.log)[0]!.hits.map((h) => h.target)).toEqual(['B0'])
    expect(byConfig.state.units.B1!.hp).toBe(50)
    const noPierce = tmpl('noPierce', { base: { atk: 5 }, trajectory: { kind: 'straight', range: 4, falloffBp: 0 } })
    const byChamp = resolveTurn(place(noPierce), { A: plan(shoot('A0', 'up')), B: idle() })
    expect(attacks(byChamp.log)[0]!.hits.map((h) => h.target)).toEqual(['B0'])
  })

  it('아군이 막으면 멈추고 아군도 피해 없음', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'A', pos: P(2, 3), t: target },
      { side: 'B', pos: P(2, 0), t: target },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    const [a] = attacks(r.log)
    expect(a!.blockedBy).toBe('A1')
    expect(a!.hits).toEqual([])
    expect(r.state.units.A1!.hp).toBe(50)
    expect(r.state.units.B0!.hp).toBe(50)
  })

  it('사거리 밖은 안 맞음', () => {
    const short = tmpl('short', { trajectory: { kind: 'straight', range: 2 } })
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: short },
      { side: 'B', pos: P(2, 1), t: target },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(attacks(r.log)[0]!.hits).toEqual([])
    expect(attacks(r.log)[0]!.path).toEqual([P(2, 3), P(2, 2)])
  })

  it('직사에 대각 방향 조준은 무효', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(0, 0), t: target },
    ])
    expect(validatePlan(s, 'A', plan(shoot('A0', 'upLeft'))).ok).toBe(false)
  })
})

describe('대각선', () => {
  const diag = tmpl('diag', { trajectory: { kind: 'diagonal', range: 4 } })

  it('대각선도 관통: 사선의 적을 순서대로, 뒤는 감소', () => {
    const s = scenario([
      { side: 'A', pos: P(0, 4), t: diag },
      { side: 'B', pos: P(2, 2), t: target },
      { side: 'B', pos: P(3, 1), t: target },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'upRight')), B: idle() })
    expect(attacks(r.log)[0]!.hits.map((h) => [h.target, h.base])).toEqual([
      ['B0', 3],
      ['B1', 1],
    ])
  })

  it('아군에게 막힘', () => {
    const s = scenario([
      { side: 'A', pos: P(0, 4), t: diag },
      { side: 'A', pos: P(1, 3), t: target },
      { side: 'B', pos: P(3, 1), t: target },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'upRight')), B: idle() })
    expect(attacks(r.log)[0]!.blockedBy).toBe('A1')
    expect(r.state.units.B0!.hp).toBe(50)
  })
})

describe('곡사', () => {
  const mortar = tmpl('mortar', { trajectory: { kind: 'lob', minRange: 2, maxRange: 4 }, base: { atk: 4 } })

  it('사이 칸의 카드(아군·적 모두)를 무시하고 목표 칸에 떨어짐', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: mortar },
      { side: 'A', pos: P(2, 3), t: target }, // 아군 사이
      { side: 'B', pos: P(2, 1), t: target }, // 적 사이
      { side: 'B', pos: P(2, 0), t: target }, // 목표
    ])
    const r = resolveTurn(s, { A: plan(lob('A0', 2, 0)), B: idle() })
    expect(attacks(r.log)[0]!.hits.map((h) => h.target)).toEqual(['B1'])
    expect(r.state.units.B0!.hp).toBe(50)
    expect(r.state.units.B1!.hp).toBe(46)
    expect(r.state.units.A1!.hp).toBe(50)
  })

  it('최소 사거리 미만은 조준 불가', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 3), t: mortar },
      { side: 'B', pos: P(2, 1), t: target },
    ])
    expect(validatePlan(s, 'A', plan(lob('A0', 2, 2))).ok).toBe(false) // 거리 1
    expect(validatePlan(s, 'A', plan(lob('A0', 2, 1))).ok).toBe(true) // 거리 2
  })

  it('최대 사거리 초과는 조준 불가 (맨해튼 거리)', () => {
    const s = scenario([
      { side: 'A', pos: P(0, 4), t: mortar },
      { side: 'B', pos: P(4, 0), t: target },
    ])
    expect(validatePlan(s, 'A', plan(lob('A0', 4, 0))).ok).toBe(false) // 거리 8
    expect(validatePlan(s, 'A', plan(lob('A0', 2, 2))).ok).toBe(true) // 거리 4
  })

  it('빈 칸 조준 허용 (빗나감)', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: mortar },
      { side: 'B', pos: P(0, 0), t: target },
    ])
    const r = resolveTurn(s, { A: plan(lob('A0', 2, 1)), B: idle() })
    expect(attacks(r.log)[0]!.hits).toEqual([])
  })
})

describe('범위', () => {
  const blast = tmpl('blast', {
    trajectory: { kind: 'area', range: 2, shape: CROSS_5, damageBp: 6000 },
    base: { atk: 5 },
  })

  it('십자 범위 안의 적 전부, 아군 제외, 피해 60%', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: blast },
      { side: 'A', pos: P(1, 3), t: target }, // 범위 안 아군
      { side: 'B', pos: P(2, 2), t: target }, // 범위 안 적
      { side: 'B', pos: P(4, 2), t: target }, // 범위 밖 적
    ])
    // 중심 (2,3): 범위 = (2,3),(2,2),(2,4),(1,3),(3,3) — 자기 칸 포함이지만 자신은 안 맞음
    const r = resolveTurn(s, { A: plan(lob('A0', 2, 3)), B: idle() })
    const [a] = attacks(r.log)
    expect(a!.hits.map((h) => h.target)).toEqual(['B0'])
    expect(a!.hits[0]!.base).toBe(3) // floor(5 × 0.6)
    expect(r.state.units.A1!.hp).toBe(50)
  })

  it('여러 적에게 각각 판정', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: blast },
      { side: 'B', pos: P(2, 1), t: target },
      { side: 'B', pos: P(1, 2), t: target },
      { side: 'B', pos: P(3, 2), t: target },
    ])
    const r = resolveTurn(s, { A: plan(lob('A0', 2, 2)), B: idle() })
    expect(attacks(r.log)[0]!.hits.map((h) => h.target).sort()).toEqual(['B0', 'B1', 'B2'])
  })

  it('사거리 밖 중심은 조준 불가', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: blast },
      { side: 'B', pos: P(2, 0), t: target },
    ])
    expect(validatePlan(s, 'A', plan(lob('A0', 2, 1))).ok).toBe(false) // 거리 3
  })
})
