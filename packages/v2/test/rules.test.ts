import { describe, expect, it } from 'vitest'
import {
  createGame,
  deploy,
  hitDamage,
  makeV2Config,
  planDeployment,
  planTurn,
  randomDeck,
  reachable,
  resolveTurn,
  spawnUnit,
  validatePlan,
  type Ability,
  type Action,
  type GameState,
  type Pos,
  type Side,
  type Stats,
  type TurnPlan,
  type UnitInstance,
  type UnitState,
} from '../src/index.ts'

const W: Action = { type: 'wait' }
const base: Stats = { atk: 20, armor: 5, hp: 50, move: 1, range: 10 }

function inst(id: string, stats: Partial<Stats> = {}, ability: Ability | null = null): UnitInstance {
  return { id, image: id, stats: { ...base, ...stats }, ability }
}

/** 판을 직접 구성 (A 진영 y=3..5, B 진영 y=0..2) */
function board(spec: { id: string; side: Side; pos: Pos; stats?: Partial<Stats>; ability?: Ability | null }[]): GameState {
  const cfg = makeV2Config({ cardsPerSide: 1, dangerZoneStartTurn: 0 })
  const s: GameState = {
    config: cfg,
    phase: 'plan',
    turn: 1,
    teams: { A: [], B: [] },
    units: {},
    result: null,
  }
  for (const u of spec) s.units[u.id] = spawnUnit(u.id, u.side, inst(u.id, u.stats, u.ability ?? null), u.pos)
  return s
}
const run = (s: GameState, A: TurnPlan, B: TurnPlan) => resolveTurn(s, { A, B })
const keys = (ps: Pos[]) => ps.map((p) => `${p.x},${p.y}`).sort()
const bMove = (s: GameState, id = 'B0'): Action => ({ type: 'move', unit: id, to: reachable(s.config, s.units, s.units[id]!, 1)[0]! })

describe('이동: 아군 건너뛰기', () => {
  it('아군 1명을 건너 다음 빈칸, 2명이면 그 다음 칸', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
      { id: 'A1', side: 'A', pos: { x: 1, y: 5 } },
      { id: 'A2', side: 'A', pos: { x: 2, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    expect(keys(reachable(s.config, s.units, s.units.A0!, 1))).toEqual(['0,4', '3,5'])
  })

  it('이동력 2: 오른쪽(아군 건너) → 위(아군 건너) ㄱ자 도착', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 }, stats: { move: 2 } },
      { id: 'A1', side: 'A', pos: { x: 1, y: 5 } },
      { id: 'A2', side: 'A', pos: { x: 2, y: 4 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    expect(keys(reachable(s.config, s.units, s.units.A0!, 2))).toContain('2,3')
  })

  it('상대 진영으로는 못 감 (앞줄에서 앞으로 불가)', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 3 } },
      { id: 'B0', side: 'B', pos: { x: 5, y: 0 } },
    ])
    expect(keys(reachable(s.config, s.units, s.units.A0!, 1))).toEqual(['0,4', '1,3'])
  })

  it('이동 의무 없음: 대기 3번도 가능 (설정으로 켜면 이동 최소 1회)', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    expect(validatePlan(s, 'A', [W, W, W]).ok).toBe(true)
    expect(validatePlan({ ...s, config: { ...s.config, minMovesPerTurn: 1 } }, 'A', [W, W, W]).ok).toBe(false)
    expect(validatePlan(s, 'A', [{ type: 'move', unit: 'A0', to: { x: 1, y: 5 } }, W, W]).ok).toBe(true)
  })

  it('도착 칸 고정: 건너뛰려던 아군이 먼저 죽어도 입력한 칸에 도착', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 } },
      { id: 'A1', side: 'A', pos: { x: 1, y: 5 }, stats: { hp: 30, armor: 1 } },
      { id: 'B0', side: 'B', pos: { x: 1, y: 0 }, stats: { atk: 20 } },
      { id: 'B1', side: 'B', pos: { x: 3, y: 0 }, stats: { atk: 20 } },
    ])
    s.units.A1!.hp = 10
    const A: TurnPlan = [W, { type: 'move', unit: 'A0', to: { x: 2, y: 5 } }, W]
    const B: TurnPlan = [{ type: 'attack', unit: 'B0', aim: { kind: 'cell', pos: { x: 1, y: 5 } } }, bMove(s, 'B1'), W]
    const r = run(s, A, B)
    expect(r.state.units.A1!.alive).toBe(false)
    expect(r.state.units.A0!.pos).toEqual({ x: 2, y: 5 })
  })
})

describe('피해 계산', () => {
  const pair = (atkAb: Ability | null) =>
    board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 3 }, ability: atkAb },
      { id: 'B0', side: 'B', pos: { x: 0, y: 2 } },
    ])
  const dmg = (s: GameState) => hitDamage(s.units.A0!, s.units.B0!, 1)
  it('공격력 − 방어력', () => expect(dmg(pair(null))).toBe(15))
  it('방어력 무시 50%: 방어 5 → 3', () => expect(dmg(pair({ kind: 'armorPierce', tier: 0 }))).toBe(17))
  it('광역딜 20%: (20 − 5) × 20% = 3', () => expect(dmg(pair({ kind: 'splash', tier: 0 }))).toBe(3))
  it('퍼센트딜 15%: 15 + 50 × 15% = 22', () => expect(dmg(pair({ kind: 'percentDmg', tier: 2 }))).toBe(22))
  it('도핑 1.2배: 24 − 5 = 19', () => expect(dmg(pair({ kind: 'doping', tier: 1 }))).toBe(19))
})

describe('특수능력', () => {
  it('무효: 맞은 유닛의 다음 행동이 취소, 같은 행동(동시)은 유지', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 3 }, ability: { kind: 'nullify', tier: 0 } },
      { id: 'A1', side: 'A', pos: { x: 5, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 2 } },
      { id: 'B1', side: 'B', pos: { x: 5, y: 0 } },
    ])
    const A: TurnPlan = [{ type: 'attack', unit: 'A0', aim: { kind: 'cell', pos: { x: 0, y: 2 } } }, { type: 'move', unit: 'A1', to: { x: 4, y: 5 } }, W]
    // B0 은 1번째 행동(동시)으로 공격 → 유지. B1 이동 후 B0 은 못 움직임(이미 행동)
    const B: TurnPlan = [{ type: 'attack', unit: 'B0', aim: { kind: 'cell', pos: { x: 0, y: 3 } } }, bMove(s, 'B1'), W]
    const r = run(s, A, B)
    expect(r.log.steps[0]!.some((e) => e.type === 'attack' && e.unit === 'B0')).toBe(true)
    expect(r.state.units.B0!.nullified).toBe(true) // 다음 턴 첫 행동이 무효
    const r2 = run(r.state, [{ type: 'move', unit: 'A1', to: { x: 3, y: 5 } }, W, W], [{ type: 'move', unit: 'B0', to: { x: 1, y: 2 } }, W, W])
    expect(r2.log.steps[0]!.some((e) => e.type === 'fizzle' && e.reason === 'nullified')).toBe(true)
    expect(r2.state.units.B0!.pos).toEqual({ x: 0, y: 2 })
  })

  it('맹독: 중첩, 맞은 턴 포함 2턴 동안 턴 끝 피해 (방어력 무시)', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 3 }, ability: { kind: 'poison', tier: 1 } },
      { id: 'A1', side: 'A', pos: { x: 5, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 2 } },
      { id: 'B1', side: 'B', pos: { x: 5, y: 0 } },
    ])
    const atk: Action = { type: 'attack', unit: 'A0', aim: { kind: 'cell', pos: { x: 0, y: 2 } } }
    const r1 = run(s, [atk, { type: 'move', unit: 'A1', to: { x: 4, y: 5 } }, W], [bMove(s, 'B1'), W, W])
    expect(r1.log.endEvents.find((e) => e.type === 'poisonTick')).toMatchObject({ damage: 2 })
    const r2 = run(r1.state, [atk, { type: 'move', unit: 'A1', to: { x: 3, y: 5 } }, W], [bMove(r1.state, 'B1'), W, W])
    expect(r2.log.endEvents.find((e) => e.type === 'poisonTick')).toMatchObject({ damage: 4 }) // 2중첩
    expect(r2.state.units.B0!.poison).toHaveLength(1)
  })

  it('버프: 2턴 유지, 사용한 턴부터 3턴 뒤 재사용', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 }, ability: { kind: 'teamAtkUp', tier: 2 } },
      { id: 'A1', side: 'A', pos: { x: 5, y: 5 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    const buff: Action = { type: 'skill', unit: 'A0' }
    const mv = (st: GameState): Action => ({ type: 'move', unit: 'A1', to: reachable(st.config, st.units, st.units.A1!, 1)[0]! })
    let st = run(s, [buff, mv(s), W], [bMove(s), W, W]).state
    expect(hitDamage(st.units.A1!, st.units.B0!, 2)).toBe(18) // 2턴째 23 − 5
    expect(validatePlan(st, 'A', [buff, mv(st), W]).ok).toBe(false) // 2턴: 대기
    st = run(st, [mv(st), W, W], [bMove(st), W, W]).state
    expect(hitDamage(st.units.A1!, st.units.B0!, 3)).toBe(15) // 3턴: 만료
    expect(validatePlan(st, 'A', [buff, mv(st), W]).ok).toBe(false) // 3턴: 대기
    st = run(st, [mv(st), W, W], [bMove(st), W, W]).state
    expect(validatePlan(st, 'A', [buff, mv(st), W]).ok).toBe(true) // 4턴: 가능
  })

  it('아군 회복: 받는 쪽 공격력 × 비율', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 5 }, ability: { kind: 'heal', tier: 2 } },
      { id: 'A1', side: 'A', pos: { x: 5, y: 5 }, stats: { atk: 15 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 0 } },
    ])
    s.units.A1!.hp = 20
    const r = run(s, [{ type: 'skill', unit: 'A0', aim: { kind: 'unit', id: 'A1' } }, { type: 'move', unit: 'A1', to: { x: 4, y: 5 } }, W], [bMove(s), W, W])
    expect(r.state.units.A1!.hp).toBe(29) // 15 × 60% = 9
  })

  it('유도탄: 상대가 피해도 명중', () => {
    const s = board([
      { id: 'A0', side: 'A', pos: { x: 0, y: 3 }, ability: { kind: 'homing', tier: 3 } },
      { id: 'B0', side: 'B', pos: { x: 0, y: 2 } },
    ])
    const r = run(s, [{ type: 'attack', unit: 'A0', aim: { kind: 'unit', id: 'B0' } }, { type: 'move', unit: 'A0', to: { x: 1, y: 3 } }, W], [bMove(s), W, W])
    expect(r.state.units.B0!.hp).toBe(50 - 9) // (20 − 5) × 60%
  })
})

describe('AI 대 AI', () => {
  it('무작위 덱 40판: 항상 유효한 입력, 항상 종료', () => {
    const cfg = makeV2Config()
    for (let i = 0; i < 40; i++) {
      const teams = { A: randomDeck(cfg, `a${i}`), B: randomDeck(cfg, `b${i}`) }
      let s = createGame(teams)
      s = deploy(s, { A: planDeployment(s, 'A', teams.A, i), B: planDeployment(s, 'B', teams.B, i) })
      while (s.phase === 'plan') {
        const A = planTurn(s, 'A', i)
        const B = planTurn(s, 'B', i + 1)
        expect(validatePlan(s, 'A', A).ok).toBe(true)
        expect(validatePlan(s, 'B', B).ok).toBe(true)
        s = resolveTurn(s, { A, B }).state
      }
      expect(s.result).not.toBeNull()
      expect(s.turn).toBeLessThanOrEqual(cfg.maxTurns + 1)
    }
  }, 120_000)
})

void ({} as UnitState)

describe('혼합 전략 AI', () => {
  it('5판: 항상 유효한 입력, 항상 종료', async () => {
    const { planTurnMixed } = await import('../src/index.ts')
    const cfg = makeV2Config()
    for (let i = 0; i < 5; i++) {
      const teams = { A: randomDeck(cfg, `ma${i}`), B: randomDeck(cfg, `mb${i}`) }
      let s = createGame(teams)
      s = deploy(s, { A: planDeployment(s, 'A', teams.A, i), B: planDeployment(s, 'B', teams.B, i) })
      while (s.phase === 'plan') {
        const A = planTurnMixed(s, 'A', i)
        const B = planTurnMixed(s, 'B', i + 1)
        expect(validatePlan(s, 'A', A).ok && validatePlan(s, 'B', B).ok).toBe(true)
        s = resolveTurn(s, { A, B }).state
      }
      expect(s.result).not.toBeNull()
    }
  }, 120_000)
})
