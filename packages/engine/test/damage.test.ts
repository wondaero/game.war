import { describe, expect, it } from 'vitest'
import { CROSS_5 } from '../src/cards/catalog.ts'
import { resolveTurn } from '../src/resolve.ts'
import type { GameState, HitRecord, StepEvent, TurnLog } from '../src/types.ts'
import { P, idle, lob, plan, scenario, shoot, sp, tmpl } from './helpers.ts'

const allEvents = (log: TurnLog) => log.steps.flatMap((s) => s.events)
const ofType = <T extends StepEvent['type']>(evs: StepEvent[], t: T) =>
  evs.filter((e): e is Extract<StepEvent, { type: T }> => e.type === t)
const hits = (log: TurnLog): HitRecord[] => ofType(allEvents(log), 'attack').flatMap((a) => a.hits)
const hp = (s: GameState, id: string) => s.units[id]!.hp

const gun = (atk: number, extra: Parameters<typeof tmpl>[1] = {}) =>
  tmpl(`gun${atk}`, { ...extra, base: { hp: 20, atk, ...extra.base } })
const wall = (o: { hp?: number; armor?: number } = {}) =>
  tmpl(`wall${o.hp ?? 30}-${o.armor ?? 0}`, { base: { hp: o.hp ?? 30, atk: 1, armor: o.armor ?? 0 } })

/** A0(아래) 가 위로 B0 를 쏘는 기본 배치 */
function duel(attacker: ReturnType<typeof tmpl>, target: ReturnType<typeof tmpl>, a: { specials?: any[] } = {}, b: { specials?: any[] } = {}) {
  return scenario([
    { side: 'A', pos: P(2, 4), t: attacker, specials: a.specials },
    { side: 'B', pos: P(2, 0), t: target, specials: b.specials },
  ])
}

describe('① 공격력으로 피해 계산', () => {
  it('단일 공격 = 공격력', () => {
    const r = resolveTurn(duel(gun(7), wall()), { A: plan(shoot('A0', 'up')), B: idle() })
    expect(hits(r.log)[0]!.base).toBe(7)
  })
  it('범위 공격 = 공격력 × 비율 (내림)', () => {
    const blast = tmpl('blast', { base: { hp: 20, atk: 7 }, trajectory: { kind: 'area', range: 2, shape: CROSS_5, damageBp: 6000 } })
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: blast },
      { side: 'B', pos: P(2, 2), t: wall() },
    ])
    const r = resolveTurn(s, { A: plan(lob('A0', 2, 3)), B: idle() })
    expect(hits(r.log)[0]!.base).toBe(4) // floor(7 × 0.6)
  })
})

describe('② 방어력만큼 감소 (최소 1)', () => {
  it('공격력 7, 방어력 3 → 4', () => {
    const r = resolveTurn(duel(gun(7), wall({ armor: 3 })), { A: plan(shoot('A0', 'up')), B: idle() })
    expect(hits(r.log)[0]!.afterArmor).toBe(4)
    expect(hp(r.state, 'B0')).toBe(26)
  })
  it('방어력이 공격력 이상이어도 최소 1', () => {
    const r = resolveTurn(duel(gun(3), wall({ armor: 9 })), { A: plan(shoot('A0', 'up')), B: idle() })
    expect(hits(r.log)[0]!.afterArmor).toBe(1)
    expect(hp(r.state, 'B0')).toBe(29)
  })
})

describe('③ 보호막이 먼저 받음 → ④ 남은 피해만 체력 감소', () => {
  it('보호막 5, 피해 7 → 보호막 0, 체력 −2', () => {
    const r = resolveTurn(duel(gun(7), wall(), {}, { specials: [sp('shield', 5)] }), {
      A: plan(shoot('A0', 'up')),
      B: idle(),
    })
    const h = hits(r.log)[0]!
    expect([h.absorbed, h.hpDamage]).toEqual([5, 2])
    expect(r.state.units.B0!.shield).toBe(0)
    expect(hp(r.state, 'B0')).toBe(28)
  })
  it('보호막은 방어력 감소 뒤 피해를 받고, 남은 양은 다음 공격으로 이어지며 다시 차지 않음', () => {
    const s = duel(gun(7), wall({ armor: 2 }), {}, { specials: [sp('shield', 8)] })
    const r1 = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(r1.state.units.B0!.shield).toBe(3) // 8 − (7−2)
    expect(hp(r1.state, 'B0')).toBe(30)
    const r2 = resolveTurn(r1.state, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(r2.state.units.B0!.shield).toBe(0)
    expect(hp(r2.state, 'B0')).toBe(28) // 5 − 3
  })
})

describe('⑤ 반사', () => {
  it('받은 피해(방어력 감소 후, 보호막 흡수분 포함)의 비율을 공격자에게, 내림', () => {
    const r = resolveTurn(duel(gun(9), wall({ armor: 2 }), {}, { specials: [sp('shield', 3), sp('reflect', 3000)] }), {
      A: plan(shoot('A0', 'up')),
      B: idle(),
    })
    const h = hits(r.log)[0]!
    expect(h.afterArmor).toBe(7)
    expect(h.reflect).toEqual({ amount: 2, absorbed: 0, hpDamage: 2 }) // floor(7 × 0.3)
    expect(hp(r.state, 'A0')).toBe(18)
    expect(hp(r.state, 'B0')).toBe(26) // 7 − 보호막 3
  })
  it('반사 피해는 공격자 방어력을 무시하고, 공격자 보호막은 흡수', () => {
    const armored = tmpl('armored', { base: { hp: 20, atk: 10, armor: 9 } })
    const r = resolveTurn(duel(armored, wall(), { specials: [sp('shield', 1)] }, { specials: [sp('reflect', 5000)] }), {
      A: plan(shoot('A0', 'up')),
      B: idle(),
    })
    expect(hits(r.log)[0]!.reflect).toEqual({ amount: 5, absorbed: 1, hpDamage: 4 })
    expect(hp(r.state, 'A0')).toBe(16)
  })
  it('반사된 피해는 다시 반사되지 않음', () => {
    const r = resolveTurn(duel(gun(10), wall(), { specials: [sp('reflect', 10000)] }, { specials: [sp('reflect', 5000)] }), {
      A: plan(shoot('A0', 'up')),
      B: idle(),
    })
    expect(hp(r.state, 'A0')).toBe(15)
    expect(hp(r.state, 'B0')).toBe(20)
  })
  it('비율 결과가 0이면 반사 없음 (피해 3 × 20% = 0)', () => {
    const r = resolveTurn(duel(gun(3), wall(), {}, { specials: [sp('reflect', 2000)] }), {
      A: plan(shoot('A0', 'up')),
      B: idle(),
    })
    expect(hits(r.log)[0]!.reflect).toBeNull()
  })
  it('서로 반사로 마지막 카드끼리 동시 사망 → 무승부', () => {
    const killer = tmpl('killer', { base: { hp: 5, atk: 99 } })
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: killer, specials: [sp('reflect', 10000)] },
      { side: 'B', pos: P(2, 0), t: killer, specials: [sp('reflect', 10000)] },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan(shoot('B0', 'down')) })
    expect(r.state.result).toEqual({ winner: 'draw', reason: 'annihilation' })
  })
})

describe('⑥ 공격 시 회복', () => {
  const cfg = { healCapBp: 10000 } // 상한 영향 제거

  it('실제 체력 감소량 기준 (보호막 흡수분 제외)', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(2, 4), t: gun(8), specials: [sp('lifesteal', 5000)] },
        { side: 'B', pos: P(2, 0), t: wall(), specials: [sp('shield', 4)] },
      ],
      { config: cfg },
    )
    s.units.A0!.hp = 10
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(hits(r.log)[0]!.lifesteal).toBe(2) // (8 − 4) × 50%
    expect(hp(r.state, 'A0')).toBe(12)
  })
  it('초과 피해는 제외 (남은 체력 3인 대상에게 8 피해 → 3 기준)', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(2, 4), t: gun(8), specials: [sp('lifesteal', 10000)] },
        { side: 'B', pos: P(2, 0), t: wall() },
        { side: 'B', pos: P(0, 0), t: wall() },
      ],
      { config: cfg },
    )
    s.units.A0!.hp = 10
    s.units.B0!.hp = 3
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(hits(r.log)[0]!.lifesteal).toBe(3)
  })
  it('반사 피해에는 회복이 적용되지 않음 (반사한 쪽의 흡혈 무관)', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(2, 4), t: gun(10) },
        { side: 'B', pos: P(2, 0), t: wall(), specials: [sp('reflect', 5000), sp('lifesteal', 10000)] },
      ],
      { config: cfg },
    )
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(ofType(allEvents(r.log), 'heal')).toEqual([])
    expect(hp(r.state, 'B0')).toBe(20)
  })
  it('같은 스텝에 체력 0 이하가 된 공격자는 흡혈로 살아나지 못함', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(2, 4), t: gun(8), specials: [sp('lifesteal', 10000)] },
        { side: 'B', pos: P(2, 0), t: gun(9) },
      ],
      { config: cfg },
    )
    s.units.A0!.hp = 5
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan(shoot('B0', 'down')) })
    expect(r.state.units.A0!.alive).toBe(false)
    expect(hits(r.log).find((h) => h.attacker === 'A0')!.lifesteal).toBe(0)
  })
  it('A/B 처리 순서와 무관: 좌우 대칭 배치는 대칭 결과', () => {
    const mk = (flip: boolean) => {
      const a = { t: gun(6), specials: [sp('lifesteal', 5000), sp('shield', 2)] }
      const b = { t: gun(6), specials: [sp('reflect', 3000)] }
      const [x, y] = flip ? [b, a] : [a, b]
      return scenario(
        [
          { side: 'A', pos: P(2, 4), ...x },
          { side: 'B', pos: P(2, 0), ...y },
        ],
        { config: cfg },
      )
    }
    const r1 = resolveTurn(mk(false), { A: plan(shoot('A0', 'up')), B: plan(shoot('B0', 'down')) })
    const r2 = resolveTurn(mk(true), { A: plan(shoot('A0', 'up')), B: plan(shoot('B0', 'down')) })
    expect([hp(r1.state, 'A0'), hp(r1.state, 'B0')]).toEqual([hp(r2.state, 'B0'), hp(r2.state, 'A0')])
  })
})

describe('⑦ 사망 동시 처리', () => {
  it('스텝 이벤트 순서: 이동 → 공격 → 피해 → 회복 → 사망', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(2, 4), t: gun(30), specials: [sp('lifesteal', 5000)] },
        { side: 'A', pos: P(0, 4), t: wall() },
        { side: 'B', pos: P(2, 0), t: wall() },
        { side: 'B', pos: P(4, 1), t: wall() },
      ],
      { config: { healCapBp: 10000 } },
    )
    s.units.A0!.hp = 1
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: plan({ type: 'move', unit: 'B1', to: P(4, 2) }) })
    const types = r.log.steps[0]!.events.map((e) => e.type).filter((t) => t !== 'wait')
    expect(types).toEqual(['move', 'attack', 'damage', 'heal', 'death'])
  })
})

describe('⑧ 턴 끝 자체 회복 · 회복 상한 · 서든데스', () => {
  it('자체 회복은 모든 스텝이 끝난 뒤 턴 끝에 적용', () => {
    const s = duel(gun(5), wall(), {}, { specials: [sp('regen', 2)] })
    s.units.B0!.hp = 20
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(r.log.steps[0]!.unitsAfter.B0!.hp).toBe(15)
    expect(ofType(r.log.endEvents, 'heal')).toEqual([
      { type: 'heal', unit: 'B0', source: 'regen', amount: 2, hpBefore: 15, hpAfter: 17 },
    ])
  })
  it('최대 HP 를 넘지 않음', () => {
    const s = duel(gun(5), wall(), {}, { specials: [sp('regen', 2)] })
    s.units.B0!.hp = 29
    const r = resolveTurn(s, { A: idle(), B: idle() })
    expect(hp(r.state, 'B0')).toBe(30)
  })
  it('회복 상한: 유닛별 턴당 합계(흡혈 + 자체 회복) ≤ 최대 HP 10%', () => {
    // 최대 HP 30 → 상한 3. 흡혈 3 을 먼저 쓰면 자체 회복 0
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun(10, { base: { hp: 30 } }), specials: [sp('lifesteal', 10000)] },
      { side: 'B', pos: P(2, 0), t: wall() },
    ])
    s.units.A0!.hp = 10
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(hits(r.log)[0]!.lifesteal).toBe(3)
    expect(hp(r.state, 'A0')).toBe(13)
  })
  it('서든데스: 10턴부터 회복량 50% (배율 먼저, 그다음 상한)', () => {
    const s = duel(gun(5), wall({ hp: 40 }), {}, { specials: [sp('regen', 3)] })
    s.units.B0!.hp = 20
    expect(hp(resolveTurn(s, { A: idle(), B: idle() }).state, 'B0')).toBe(23)
    const late = { ...s, turn: 10, config: { ...s.config, dangerZoneStartTurn: 0 } } // 위험지대 영향 제거
    expect(hp(resolveTurn(late, { A: idle(), B: idle() }).state, 'B0')).toBe(21) // floor(3 × 0.5)
  })
  it('게임이 스텝 중에 끝나면 자체 회복 없음', () => {
    const s = duel(tmpl('k', { base: { hp: 5, atk: 99 } }), wall(), { specials: [sp('regen', 2)] })
    s.units.A0!.hp = 1
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(r.state.result?.winner).toBe('A')
    expect(r.log.endEvents).toEqual([])
  })
  it('쓰러진 유닛은 회복하지 않음', () => {
    const s = scenario([
      { side: 'A', pos: P(2, 4), t: gun(99) },
      { side: 'A', pos: P(0, 4), t: wall() },
      { side: 'B', pos: P(2, 0), t: wall(), specials: [sp('regen', 2)] },
      { side: 'B', pos: P(4, 0), t: wall() },
    ])
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(r.state.units.B0!.alive).toBe(false)
    expect(ofType(r.log.endEvents, 'heal')).toEqual([])
  })
})

describe('⑨ 위험지대 (뒷줄 압박)', () => {
  const cfg = { dangerZoneStartTurn: 8, dangerZoneDamageBp: 2000, dangerZoneGrowEveryTurns: 5, dangerZoneMaxDepth: 2 }
  const mk = (turn: number, extra: Parameters<typeof scenario>[1] = {}) => {
    const s = scenario(
      [
        { side: 'A', pos: P(0, 4), t: wall({ hp: 30, armor: 5 }), specials: [] }, // A 뒷줄
        { side: 'A', pos: P(1, 3), t: wall() }, // A 앞줄
        { side: 'B', pos: P(0, 0), t: wall(), specials: [] }, // B 뒷줄
        { side: 'B', pos: P(1, 1), t: wall() }, // B 앞줄
      ],
      { config: { ...cfg, ...extra.config } },
    )
    return { ...s, turn }
  }

  it('시작 턴 전에는 피해 없음', () => {
    const r = resolveTurn(mk(7), { A: idle(), B: idle() })
    expect(ofType(r.log.endEvents, 'zoneDamage')).toEqual([])
  })

  it('시작 턴부터 양쪽 맨 뒷줄만 최대 HP 20% (방어력 무시), 앞줄은 안전', () => {
    const r = resolveTurn(mk(8), { A: idle(), B: idle() })
    expect(ofType(r.log.endEvents, 'zoneDamage').map((e) => [e.unit, e.amount])).toEqual([
      ['A0', 6],
      ['B0', 6],
    ])
  })

  it('보호막도 무시', () => {
    const s = mk(8)
    s.units.A0!.shield = 99
    const r = resolveTurn(s, { A: idle(), B: idle() })
    expect(hp(r.state, 'A0')).toBe(24)
    expect(r.state.units.A0!.shield).toBe(99)
  })

  it('간격마다 한 줄씩 넓어지고 최대 깊이에서 멈춤', () => {
    const hitUnits = (turn: number) =>
      ofType(resolveTurn(mk(turn), { A: idle(), B: idle() }).log.endEvents, 'zoneDamage').map((e) => e.unit)
    expect(hitUnits(12)).toEqual(['A0', 'B0'])
    expect(hitUnits(13)).toEqual(['A0', 'A1', 'B0', 'B1'])
    expect(hitUnits(30)).toEqual(['A0', 'A1', 'B0', 'B1'])
  })

  it('턴 끝 순서: 자체 회복 → 위험지대 피해 → 사망 → 승패 (동시 전멸 무승부)', () => {
    const s = scenario(
      [
        { side: 'A', pos: P(0, 4), t: wall({ hp: 10 }), specials: [sp('regen', 1)] },
        { side: 'B', pos: P(0, 0), t: wall({ hp: 10 }) },
      ],
      { config: cfg },
    )
    s.turn = 8
    s.units.A0!.hp = 1 // 회복 +1 → 2, 위험지대 −2 → 0
    s.units.B0!.hp = 2
    const r = resolveTurn(s, { A: idle(), B: idle() })
    expect(r.log.endEvents.map((e) => e.type)).toEqual(['heal', 'zoneDamage', 'zoneDamage', 'death', 'death', 'gameOver'])
    expect(r.state.result).toEqual({ winner: 'draw', reason: 'annihilation' })
  })

  it('dangerZoneStartTurn = 0 이면 사용 안 함', () => {
    const r = resolveTurn(mk(15, { config: { dangerZoneStartTurn: 0 } }), { A: idle(), B: idle() })
    expect(ofType(r.log.endEvents, 'zoneDamage')).toEqual([])
  })
})
