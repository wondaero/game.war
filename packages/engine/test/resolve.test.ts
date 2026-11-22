import { describe, expect, it } from 'vitest'
import { resolveTurn } from '../src/resolve.ts'
import type { StepEvent, TurnLog } from '../src/types.ts'
import { validatePlan } from '../src/validate.ts'
import { P, idle, move, plan, scenario, shoot, tmpl } from './helpers.ts'

const events = (log: TurnLog, step: number) => log.steps[step - 1]!.events
const ofType = <T extends StepEvent['type']>(evs: StepEvent[], t: T) =>
  evs.filter((e): e is Extract<StepEvent, { type: T }> => e.type === t)

const gun = tmpl('gun', { base: { hp: 10, atk: 4 } })
const dummy = tmpl('dummy', { base: { hp: 30 } })

describe('스텝 내 처리 순서: 이동 → 공격 → 사망', () => {
  it('같은 스텝에 이동한 카드는 이동 후 위치로 판정 (회피)', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(2, 1), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan(move('B0', 1, 1)) })
    const evs = events(r.log, 1)
    expect(evs.findIndex((e) => e.type === 'move')).toBeLessThan(evs.findIndex((e) => e.type === 'attack'))
    expect(ofType(evs, 'attack')[0]!.hits).toEqual([])
    expect(r.state.units.B0!.hp).toBe(30)
  })

  it('같은 스텝에 사선 안으로 들어오면 맞음', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(1, 1), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan(move('B0', 2, 1)) })
    expect(r.state.units.B0!.hp).toBe(26)
  })

  it('사망은 공격이 모두 끝난 뒤 동시에: 체력 0이 될 카드도 같은 스텝 공격은 수행', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'A', pos: P(0, 4), t: dummy },
      { side: 'B', pos: P(2, 0), t: gun },
      { side: 'B', pos: P(4, 0), t: dummy },
    ])
    // 서로 4 피해 → 10 → 6. 두 번 더 쏘면 동시 사망
    let st = s
    const r1 = resolveTurn(st, { A: plan(shoot('A0', 'up')), B: plan(shoot('B0', 'down')) })
    st = r1.state
    expect(st.units.A0!.hp).toBe(6)
    expect(st.units.B0!.hp).toBe(6)
    const r2 = resolveTurn(
      { ...st, units: { ...st.units, A0: { ...st.units.A0!, hp: 4 }, B0: { ...st.units.B0!, hp: 4 } } },
      { A: plan(shoot('A0', 'up')), B: plan(shoot('B0', 'down')) },
    )
    const evs = events(r2.log, 1)
    expect(ofType(evs, 'attack')).toHaveLength(2)
    expect(ofType(evs, 'death').map((d) => d.unit)).toEqual(['A0', 'B0'])
    expect(r2.state.units.A0!.alive).toBe(false)
    expect(r2.state.units.B0!.alive).toBe(false)
    expect(r2.state.result).toBeNull() // dummy 가 남아 있음
  })

  it('앞 스텝에서 죽은 카드의 이후 행동은 무효(fizzle)', () => {
    const killer = tmpl('killer', { base: { atk: 99 } })
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: killer },
      { side: 'B', pos: P(2, 0), t: gun },
      { side: 'B', pos: P(4, 0), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan({ type: 'wait' }, shoot('B0', 'down')) })
    expect(ofType(events(r.log, 1), 'death').map((d) => d.unit)).toEqual(['B0'])
    expect(ofType(events(r.log, 2), 'fizzle')).toEqual([
      { type: 'fizzle', side: 'B', action: shoot('B0', 'down'), reason: 'unitDead' },
    ])
    expect(r.state.units.A0!.hp).toBe(10)
  })
})

describe('이동 충돌', () => {
  it('양쪽이 같은 칸으로 이동하면 둘 다 실패', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 3), t: dummy },
      { side: 'B', pos: P(2, 1), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan(move('A0', 2, 2)), B: plan(move('B0', 2, 2)) })
    const blocked = ofType(events(r.log, 1), 'moveBlocked')
    expect(blocked.map((b) => [b.unit, b.reason])).toEqual([
      ['A0', 'collision'],
      ['B0', 'collision'],
    ])
    expect(r.state.units.A0!.pos).toEqual(P(2, 3))
    expect(r.state.units.B0!.pos).toEqual(P(2, 1))
  })

  it('맞바꾸기 이동은 둘 다 실패', () => {
    const s = scenario([
      { side: 'A', pos: P(1, 2), t: dummy },
      { side: 'B', pos: P(2, 2), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan(move('A0', 2, 2)), B: plan(move('B0', 1, 2)) })
    expect(ofType(events(r.log, 1), 'moveBlocked')).toHaveLength(2)
    expect(r.state.units.A0!.pos).toEqual(P(1, 2))
    expect(r.state.units.B0!.pos).toEqual(P(2, 2))
  })

  it('같은 스텝에 비워지는 칸으로는 이동 불가', () => {
    const s = scenario([
      { side: 'A', pos: P(1, 2), t: dummy },
      { side: 'B', pos: P(2, 2), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan(move('A0', 2, 2)), B: plan(move('B0', 2, 1)) })
    expect(ofType(events(r.log, 1), 'moveBlocked')[0]!.reason).toBe('occupied')
    expect(r.state.units.A0!.pos).toEqual(P(1, 2))
    expect(r.state.units.B0!.pos).toEqual(P(2, 1))
  })

  it('다음 스텝에는 비워진 칸으로 이동 가능', () => {
    const s = scenario([
      { side: 'A', pos: P(1, 2), t: dummy },
      { side: 'A', pos: P(0, 4), t: dummy },
      { side: 'B', pos: P(2, 2), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan({ type: 'wait' }, move('A0', 2, 2)), B: plan(move('B0', 2, 1)) })
    expect(r.state.units.A0!.pos).toEqual(P(2, 2))
  })

  it('이동 범위: 자기 진영 + 중립만, 상대 진영 불가, 1칸 상하좌우', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 2), t: dummy },
      { side: 'B', pos: P(0, 0), t: dummy },
    ])
    expect(validatePlan(s, 'A', plan(move('A0', 2, 1))).ok).toBe(false) // 상대 진영
    expect(validatePlan(s, 'A', plan(move('A0', 3, 2))).ok).toBe(true) // 중립
    expect(validatePlan(s, 'A', plan(move('A0', 2, 3))).ok).toBe(true) // 자기 진영
    expect(validatePlan(s, 'A', plan(move('A0', 3, 3))).ok).toBe(false) // 대각
    expect(validatePlan(s, 'A', plan(move('A0', 2, 4))).ok).toBe(false) // 2칸
  })
})

describe('승패', () => {
  const killer = tmpl('killer', { base: { hp: 5, atk: 99 } })

  it('상대 전멸 시 승리, 남은 스텝은 처리하지 않음', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: killer },
      { side: 'B', pos: P(2, 0), t: dummy },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan({ type: 'wait' }, move('B0', 1, 0)) })
    expect(r.state.result).toEqual({ winner: 'A', reason: 'annihilation' })
    expect(r.state.phase).toBe('over')
    expect(r.log.steps).toHaveLength(1)
  })

  it('같은 스텝에 양쪽 마지막 카드가 동시에 죽으면 무승부', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: killer },
      { side: 'B', pos: P(2, 0), t: killer },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan(shoot('B0', 'down')) })
    expect(r.state.result).toEqual({ winner: 'draw', reason: 'annihilation' })
  })

  it('최대 턴 초과 시 남은 체력 비율로 판정', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(2, 4), t: gun },
        { side: 'B', pos: P(2, 0), t: gun },
      ],
      { config: { maxTurns: 1 } },
    )
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(r.state.result).toEqual({ winner: 'A', reason: 'maxTurns' })
    expect(r.log.endEvents).toHaveLength(1)
  })

  it('최대 턴 초과, 체력 비율 같으면 무승부', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(2, 4), t: gun },
        { side: 'B', pos: P(2, 0), t: gun },
      ],
      { config: { maxTurns: 1 } },
    )
    const r = resolveTurn(s, { A: idle(), B: idle() })
    expect(r.state.result).toEqual({ winner: 'draw', reason: 'maxTurns' })
  })
})

describe('턴 입력 규칙', () => {
  const s = scenario([
    { side: 'A', pos: P(0, 4), t: gun },
    { side: 'A', pos: P(1, 4), t: gun },
    { side: 'A', pos: P(2, 4), t: gun },
    { side: 'B', pos: P(2, 0), t: dummy },
  ])

  it('공격은 턴당 최대 2회', () => {
    const v = validatePlan(s, 'A', plan(shoot('A0', 'up'), shoot('A1', 'up'), shoot('A2', 'up')))
    expect(v.ok).toBe(false)
    expect(() =>
      resolveTurn(s, { A: plan(shoot('A0', 'up'), shoot('A1', 'up'), shoot('A2', 'up')), B: idle() }),
    ).toThrow(/at most 2 attacks/)
  })

  it('행동 개수는 정확히 3개', () => {
    expect(validatePlan(s, 'A', [shoot('A0', 'up')]).ok).toBe(false)
  })

  it('같은 카드 여러 행동: 기본 금지(살아 있는 카드 3장), 플래그로 허용', () => {
    const p = plan(move('A0', 0, 3), shoot('A0', 'up'))
    expect(validatePlan(s, 'A', p).ok).toBe(false)
    const s2 = { ...s, config: { ...s.config, allowSameCardMultiAction: true } }
    expect(validatePlan(s2, 'A', p).ok).toBe(true)
    const r = resolveTurn(s2, { A: p, B: idle() })
    expect(r.state.units.A0!.pos).toEqual(P(0, 3))
  })

  it('상대 카드로 행동 불가', () => {
    expect(validatePlan(s, 'A', plan(shoot('B0', 'down'))).ok).toBe(false)
  })
})

describe('막판 교착 방지: 살아 있는 카드 2장 이하면 같은 카드 여러 행동 허용', () => {
  it('2장이면 허용, 3장이면 금지', () => {
    const two = scenario([
      { side: 'A', pos: P(0, 4), t: gun },
      { side: 'A', pos: P(1, 4), t: gun },
      { side: 'B', pos: P(2, 0), t: dummy },
    ])
    const p = plan(move('A0', 0, 3), shoot('A0', 'up'), shoot('A1', 'up'))
    expect(validatePlan(two, 'A', p).ok).toBe(true)
    const r = resolveTurn(two, { A: p, B: idle() })
    expect(r.state.units.A0!.pos).toEqual(P(0, 3))
    const three = scenario([
      { side: 'A', pos: P(0, 4), t: gun },
      { side: 'A', pos: P(1, 4), t: gun },
      { side: 'A', pos: P(2, 4), t: gun },
      { side: 'B', pos: P(2, 0), t: dummy },
    ])
    expect(validatePlan(three, 'A', p).ok).toBe(false)
    const off = { ...two, config: { ...two.config, multiActionWhenCardsAtMost: 0 } }
    expect(validatePlan(off, 'A', p).ok).toBe(false)
  })
})
