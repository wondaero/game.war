import { describe, expect, it } from 'vitest'
import {
  actionError,
  createGame,
  DEFAULT_MIXED,
  deploy,
  makeV2Config,
  planDeployment,
  planTurnMixed,
  planUnits,
  pullUnits,
  randomDeck,
  resolveTurn,
  sanitizePlan,
  spawnUnit,
  validateDeployment,
  validatePlan,
  type Action,
  type GameState,
  type Pos,
  type Side,
} from '../src/index.ts'

const W: Action = { type: 'wait' }

function board(spec: { id: string; side: Side; pos: Pos; range?: number; move?: number }[]): GameState {
  const cfg = makeV2Config({ cardsPerSide: 1, dangerZoneStartTurn: 0 })
  const s: GameState = { config: cfg, phase: 'plan', turn: 1, teams: { A: [], B: [] }, units: {}, result: null }
  for (const u of spec)
    s.units[u.id] = spawnUnit(
      u.id,
      u.side,
      { id: u.id, image: u.id, stats: { atk: 20, armor: 5, hp: 50, move: u.move ?? 1, range: u.range ?? 5 }, ability: null },
      u.pos,
    )
  return s
}

describe('행동 입력: 앞 행동을 반영한 위치 기준', () => {
  // A0 (0,5) 사거리 5. 적 진영 칸 (0,0)까지 거리 5 → 원래 자리에서도 닿음, (1,0)은 거리 6 → 안 닿음
  const s = board([
    { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
    { id: 'A1', side: 'A', pos: { x: 5, y: 5 } },
    { id: 'B0', side: 'B', pos: { x: 5, y: 0 } },
  ])
  const far: Action = { type: 'attack', unit: 'A0', aim: { kind: 'cell', pos: { x: 1, y: 0 } } }

  it('planUnits: 행동 1 이동이 판에 반영됨', () => {
    const u = planUnits(s, 'A', [{ type: 'move', unit: 'A0', to: { x: 0, y: 4 } }])
    expect(u.A0!.pos).toEqual({ x: 0, y: 4 })
    expect(s.units.A0!.pos).toEqual({ x: 0, y: 5 }) // 원래 상태는 그대로
  })

  it('원래 자리에선 사거리 밖인 칸이, 앞으로 옮긴 뒤엔 사거리 안', () => {
    expect(actionError(s, s.units, 'A', far)).toBe('out of range')
    const moved = planUnits(s, 'A', [{ type: 'move', unit: 'A1', to: { x: 4, y: 5 } }, { type: 'move', unit: 'A0', to: { x: 0, y: 4 } }])
    expect(actionError(s, moved, 'A', far)).toBeNull()
  })

  it('계획 검증도 같은 기준 (A1 이동 → A0 이동 → A0 공격은 살아 있는 유닛 2명 이하일 때만 허용)', () => {
    // 살아 있는 내 유닛 2명 → 같은 유닛 여러 행동 허용
    const plan: Action[] = [{ type: 'move', unit: 'A0', to: { x: 0, y: 4 } }, far, W]
    expect(validatePlan(s, 'A', plan).ok).toBe(true)
    expect(validatePlan(s, 'A', [far, { type: 'move', unit: 'A0', to: { x: 0, y: 4 } }, W]).ok).toBe(false)
  })
})

describe('계획 정리 (시간 초과·잘못된 입력)', () => {
  const s = board([
    { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
    { id: 'A1', side: 'A', pos: { x: 3, y: 5 } },
    { id: 'A2', side: 'A', pos: { x: 5, y: 5 } },
    { id: 'B0', side: 'B', pos: { x: 5, y: 0 } },
  ])
  const atk: Action = { type: 'attack', unit: 'A1', aim: { kind: 'cell', pos: { x: 3, y: 2 } } }

  it('맞는 계획은 그대로', () => {
    const p: Action[] = [{ type: 'move', unit: 'A0', to: { x: 0, y: 4 } }, atk, W]
    expect(sanitizePlan(s, 'A', p)).toEqual(p)
  })

  it('이동이 없어도 그대로 (이동 의무 없음), 아무것도 안 내면 대기 3번', () => {
    expect(sanitizePlan(s, 'A', [atk])).toEqual([atk, W, W])
    expect(sanitizePlan(s, 'A', [])).toEqual([W, W, W])
  })

  it('잘못된 계획은 전부 대기', () => {
    expect(sanitizePlan(s, 'A', [atk, atk])).toEqual([W, W, W]) // 같은 캐릭 액션 2번
  })

  it('형식이 깨진 입력도 규칙에 맞는 계획으로', () => {
    for (const raw of [null, 'x', [{ type: 'attack', unit: 'B0' }], [{ type: 'move', unit: 'A0', to: { x: 9, y: 9 } }]])
      expect(validatePlan(s, 'A', sanitizePlan(s, 'A', raw)).ok).toBe(true)
  })

  it('배치 검증: 상대 진영·겹침·형식 오류 거부', () => {
    const g = createGame({ A: randomDeck(makeV2Config(), 1), B: randomDeck(makeV2Config(), 2) })
    expect(validateDeployment(g, 'A', planDeployment(g, 'A', g.teams.A)).ok).toBe(true)
    expect(validateDeployment(g, 'A', planDeployment(g, 'B', g.teams.B)).ok).toBe(false)
    expect(validateDeployment(g, 'A', [{ x: 0, y: 5 }, { x: 0, y: 5 }, { x: 1, y: 5 }, { x: 2, y: 5 }]).ok).toBe(false)
    expect(validateDeployment(g, 'A', 'nope').ok).toBe(false)
  })
})

describe('앱 흐름 그대로 한 판 (AI vs AI)', () => {
  it('뽑기 덱 → 배치 → 끝날 때까지 오류 없이 진행, 같은 입력이면 같은 결과', () => {
    const cfg = makeV2Config()
    const play = () => {
      let g = createGame({ A: randomDeck(cfg, 11), B: randomDeck(cfg, 22) }, cfg)
      g = deploy(g, { A: planDeployment(g, 'A', g.teams.A, 1), B: planDeployment(g, 'B', g.teams.B, 2) })
      while (g.phase === 'plan') {
        const plans = {
          A: sanitizePlan(g, 'A', planTurnMixed(g, 'A', `a${g.turn}`, { ...DEFAULT_MIXED, candidates: 6, iterations: 100 })),
          B: sanitizePlan(g, 'B', []), // 아무것도 안 내는 상대 (시간 초과)
        }
        g = resolveTurn(g, plans).state
      }
      return g.result
    }
    const r = play()
    expect(r).not.toBeNull()
    expect(play()).toEqual(r)
  })

  it('뽑기: 같은 난수 상태 → 같은 결과, 능력 붙는 비율 약 20%', () => {
    const cfg = makeV2Config()
    const a = pullUnits(cfg, { s: 3 }, 2000, 0)
    expect(pullUnits(cfg, { s: 3 }, 2000, 0).units).toEqual(a.units)
    const rate = a.units.filter((u) => u.ability).length / a.units.length
    expect(rate).toBeGreaterThan(0.17)
    expect(rate).toBeLessThan(0.23)
  })
})

describe('행동 규칙 ②: 같은 캐릭 여러 행동 · 액션(공격·능력) 턴당 2번·캐릭당 1번', () => {
  const mv = (id: string, x: number, y: number): Action => ({ type: 'move', unit: id, to: { x, y } })
  const at = (id: string, x: number): Action => ({ type: 'attack', unit: id, aim: { kind: 'cell', pos: { x, y: 2 } } })
  const four = board([
    { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
    { id: 'A1', side: 'A', pos: { x: 2, y: 5 } },
    { id: 'A2', side: 'A', pos: { x: 4, y: 5 } },
    { id: 'A3', side: 'A', pos: { x: 5, y: 3 } },
    { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
  ])
  const two = board([
    { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
    { id: 'A1', side: 'A', pos: { x: 2, y: 5 } },
    { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
  ])
  const one = board([
    { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
    { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
  ])

  it('4명이어도 같은 캐릭이 이동 → 이동 → 공격 가능 (규칙 ②)', () => {
    expect(validatePlan(four, 'A', [mv('A0', 0, 4), at('A0', 0), W]).ok).toBe(true)
    expect(validatePlan(four, 'A', [mv('A0', 0, 4), mv('A0', 0, 3), at('A0', 0)]).ok).toBe(true)
    expect(validatePlan(four, 'A', [mv('A0', 0, 4), at('A1', 2), at('A2', 4)]).ok).toBe(true)
  })
  it('공격은 캐릭당 1번 (몇 명 남았든)', () => {
    expect(validatePlan(four, 'A', [mv('A1', 2, 4), at('A0', 0), at('A0', 1)]).ok).toBe(false)
    expect(validatePlan(two, 'A', [mv('A1', 2, 4), at('A0', 0), at('A0', 1)]).ok).toBe(false)
    expect(validatePlan(one, 'A', [mv('A0', 0, 4), at('A0', 0), at('A0', 1)]).ok).toBe(false)
    expect(validatePlan(one, 'A', [mv('A0', 0, 4), mv('A0', 0, 3), at('A0', 0)]).ok).toBe(true)
  })
  it('턴당 공격은 최대 2번', () => {
    expect(validatePlan(four, 'A', [mv('A0', 0, 4), at('A1', 2), at('A2', 4)]).ok).toBe(true)
    expect(validatePlan(four, 'A', [at('A0', 0), at('A1', 2), mv('A3', 5, 4)]).ok).toBe(true)
    const three = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 4 } },
      { id: 'A1', side: 'A', pos: { x: 2, y: 4 } },
      { id: 'A2', side: 'A', pos: { x: 4, y: 4 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    // 공격 3번 → 3번째에서 공격 수 초과
    const v = validatePlan(three, 'A', [at('A0', 0), at('A1', 2), at('A2', 4)])
    expect(!v.ok && v.errors).toContain('action 2: too many acts')
  })
  it('공격과 능력은 같은 액션으로 셈 (캐릭당 1번, 턴당 2번)', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
      { id: 'A1', side: 'A', pos: { x: 2, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    s.units.A0!.inst = { ...s.units.A0!.inst, ability: { kind: 'heal', tier: 0 } }
    const heal: Action = { type: 'skill', unit: 'A0', aim: { kind: 'unit', id: 'A1' } }
    expect(validatePlan(s, 'A', [mv('A1', 2, 4), heal, W]).ok).toBe(true)
    expect(validatePlan(s, 'A', [mv('A1', 2, 4), heal, heal]).ok).toBe(false)
    expect(validatePlan(s, 'A', [mv('A1', 2, 4), heal, at('A0', 0)]).ok).toBe(false) // 같은 캐릭 회복 + 공격
    expect(validatePlan(s, 'A', [heal, at('A1', 2), mv('A1', 2, 4)]).ok).toBe(true) // A0 회복 + A1 공격 = 2번
  })
})

describe('이동 시 자가 회복', () => {
  it('이동 행동 2번이어도 회복은 턴당 1번', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
      { id: 'A1', side: 'A', pos: { x: 3, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    s.units.A0!.inst = { ...s.units.A0!.inst, ability: { kind: 'moveRegen', tier: 0 } } // 공격력 20의 10% = 2
    s.units.A0!.hp = 30
    const plan: Action[] = [
      { type: 'move', unit: 'A0', to: { x: 0, y: 4 } },
      { type: 'move', unit: 'A0', to: { x: 0, y: 3 } },
      W,
    ]
    const r = resolveTurn(s, { A: plan, B: [W, W, W] })
    const heals = r.log.steps.flat().filter((e) => e.type === 'heal' && e.unit === 'A0')
    expect(heals).toHaveLength(1)
    expect(r.state.units.A0!.hp).toBe(32)
  })
})

describe('1대1 판정', () => {
  // 4명으로 시작한 판에서 각자 1명만 남은 상황
  function duelState(a: { hp: number; maxHp?: number; ability?: boolean }, b: { hp: number; maxHp?: number; ability?: boolean }) {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 5, y: 0 } },
    ])
    s.config = { ...s.config, cardsPerSide: 4 }
    for (const [id, o] of [['A0', a], ['B0', b]] as const) {
      const u = s.units[id]!
      u.inst = { ...u.inst, stats: { ...u.inst.stats, hp: o.maxHp ?? 50 }, ability: o.ability ? { kind: 'reflect', tier: 0 } : null }
      u.hp = o.hp
    }
    return s
  }
  const end = (s: GameState) => resolveTurn(s, { A: [W, W, W], B: [W, W, W] }).state

  it('남은 체력 많은 쪽 승', () => {
    expect(end(duelState({ hp: 20 }, { hp: 10 })).result).toEqual({ winner: 'A', reason: 'oneOnOne' })
  })
  it('체력 같으면 능력치 점수(원래 최대 체력 포함) 낮은 쪽 승', () => {
    expect(end(duelState({ hp: 10, maxHp: 50 }, { hp: 10, maxHp: 30 })).result).toEqual({ winner: 'B', reason: 'oneOnOne' })
  })
  it('특수능력은 +20점', () => {
    expect(end(duelState({ hp: 10, ability: true }, { hp: 10 })).result).toEqual({ winner: 'B', reason: 'oneOnOne' })
  })
  it('체력·점수 다 같으면 판정 없이 계속', () => {
    const s = end(duelState({ hp: 10 }, { hp: 10 }))
    expect(s.result).toBeNull()
    expect(s.phase).toBe('plan')
  })
})
