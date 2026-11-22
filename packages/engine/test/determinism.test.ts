import { describe, expect, it } from 'vitest'
import { MVP_CHAMPS } from '../src/cards/catalog.ts'
import { createUnit, makeGachaContext } from '../src/gacha/index.ts'
import { createGame, deploy } from '../src/game.ts'
import { resolveTurn } from '../src/resolve.ts'
import { createRngState, type RngState } from '../src/rng.ts'
import type { GameState, TurnPlan, UnitInstance } from '../src/types.ts'
import { P, plan, shoot } from './helpers.ts'

const ctx = makeGachaContext()

function team(ids: string[], seed: string): UnitInstance[] {
  let rng: RngState = createRngState(seed)
  return ids.map((id) => {
    const r = createUnit(ctx, id, rng, 0)
    rng = r.rng
    return r.unit
  })
}

function setup(): GameState {
  const ids = ['vanguard', 'mirrormage', 'shieldbearer', 'mortar']
  const g = createGame({ teams: { A: team(ids, 'a'), B: team(ids, 'b') } })
  return deploy(g, {
    A: [P(1, 4), P(2, 3), P(3, 4), P(0, 3)],
    B: [P(1, 0), P(2, 1), P(3, 0), P(0, 1)],
  })
}

const plans: Record<'A' | 'B', TurnPlan> = {
  A: plan(shoot('A0', 'up'), shoot('A2', 'up'), { type: 'move', unit: 'A1', to: P(2, 4) }),
  B: plan(shoot('B0', 'down'), { type: 'attack', unit: 'B3', aim: { kind: 'cell', pos: P(0, 3) } }, { type: 'wait' }),
}

describe('결정성', () => {
  it('같은 입력 → 같은 결과 (상태·로그 완전 일치)', () => {
    expect(JSON.stringify(resolveTurn(setup(), plans))).toBe(JSON.stringify(resolveTurn(setup(), plans)))
  })

  it('resolveTurn 은 입력 상태를 변경하지 않음 (순수 함수)', () => {
    const s = setup()
    const before = JSON.stringify(s)
    resolveTurn(s, plans)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('상태는 JSON 직렬화 후 복원해도 같은 결과 (서버 저장·재개 가능)', () => {
    const s = setup()
    const restored = JSON.parse(JSON.stringify(s)) as GameState
    expect(JSON.stringify(resolveTurn(restored, plans))).toBe(JSON.stringify(resolveTurn(s, plans)))
  })

  it('보호막은 개체 특수능력에서 매치 시작 시 채워짐', () => {
    const s = setup()
    for (const u of Object.values(s.units)) {
      expect(u.shield).toBe(u.instance.specials.find((x) => x.kind === 'shield')?.value ?? 0)
      expect(u.hp).toBe(u.instance.stats.hp)
    }
  })
})

describe('MVP 챔프 구성', () => {
  it('공격·방어·지원 역할과 직사·대각·곡사·범위 궤적이 모두 존재', () => {
    expect(new Set(MVP_CHAMPS.map((c) => c.role))).toEqual(new Set(['attack', 'defense', 'support']))
    expect(new Set(MVP_CHAMPS.map((c) => c.trajectory.kind))).toEqual(new Set(['straight', 'diagonal', 'lob', 'area']))
  })
  it('슬롯이 많은 챔프일수록 일반 능력치(체력+공격력 최대) 합이 낮음 — 역할 내 비교', () => {
    const power = (id: string) => {
      const c = MVP_CHAMPS.find((x) => x.id === id)!
      return c.statRanges.hp.max + c.statRanges.atk.max * 2
    }
    expect(power('warden')).toBeLessThan(power('shieldbearer'))
  })
})

describe('덱 검증', () => {
  const ids = ['vanguard', 'sniper', 'mortar', 'warden']
  it('같은 챔프 중복은 기본 금지', () => {
    expect(() =>
      createGame({ teams: { A: team(['vanguard', 'vanguard', 'mortar', 'warden'], 'x'), B: team(ids, 'y') } }),
    ).toThrow(/duplicate champ/)
  })
  it('덱은 정확히 4장', () => {
    expect(() => createGame({ teams: { A: team(ids.slice(0, 3), 'x'), B: team(ids, 'y') } })).toThrow()
  })
  it('배치는 자기 진영 안, 칸 중복 불가', () => {
    const g = createGame({ teams: { A: team(ids, 'x'), B: team(ids, 'y') } })
    const okB = [P(0, 0), P(1, 0), P(2, 1), P(3, 1)]
    expect(() => deploy(g, { A: [P(0, 4), P(1, 4), P(2, 2), P(3, 3)], B: okB })).toThrow(/own zone/)
    expect(() => deploy(g, { A: [P(0, 4), P(0, 4), P(2, 3), P(3, 3)], B: okB })).toThrow(/duplicate cell/)
    expect(deploy(g, { A: [P(0, 4), P(1, 4), P(2, 3), P(3, 3)], B: okB }).phase).toBe('plan')
  })
})
