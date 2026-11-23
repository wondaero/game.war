import { ABILITIES, abilityValue } from './abilities.ts'
import { aliveOf, effMove, effRange, inZone, manhattan, opponent, posEq, reachable } from './board.ts'
import type { Action, GameState, Side, TurnPlan, UnitId, UnitState } from './types.ts'

export type Validation = { ok: true } | { ok: false; errors: string[] }
const validation = (errors: string[]): Validation => (errors.length ? { ok: false, errors } : { ok: true })

export class EngineError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(errors.length ? `${message}: ${errors.join('; ')}` : message)
    this.name = 'EngineError'
  }
}

export function cloneUnits(units: Record<UnitId, UnitState>): Record<UnitId, UnitState> {
  const out: Record<UnitId, UnitState> = {}
  for (const [id, u] of Object.entries(units))
    out[id] = { ...u, pos: { ...u.pos }, buffs: u.buffs.map((b) => ({ ...b })), poison: u.poison.map((p) => ({ ...p })) }
  return out
}

export function canRepeat(state: GameState, side: Side): boolean {
  const n = state.config.multiActionWhenCardsAtMost
  return n > 0 && aliveOf(state.units, side).length <= n
}

/** 턴 시작 시점에 이동할 수 있는 유닛이 하나라도 있는지 (최소 이동 규칙 면제 판단) */
export function anyMovePossible(state: GameState, side: Side): boolean {
  return aliveOf(state.units, side).some(
    (u) => reachable(state.config, state.units, u, effMove(u, state.turn)).length > 0,
  )
}

/**
 * 행동 1개의 유효성 (units = 그 시점 판). 문제 없으면 null.
 * 계획 검증(내 이동을 차례로 반영한 판)과 실행 시점 재검사에서 같이 쓴다.
 */
export function actionError(
  state: GameState,
  units: Record<UnitId, UnitState>,
  side: Side,
  a: Action,
  /** 실행 시점: 유도탄은 사거리와 무관하게 명중 */
  atResolve = false,
): string | null {
  if (a.type === 'wait') return null
  const cfg = state.config
  const u = units[a.unit]
  if (!u) return `unknown unit ${a.unit}`
  if (u.owner !== side) return 'not your unit'
  if (!u.alive) return 'unit is dead'

  if (a.type === 'move') {
    const ok = reachable(cfg, units, u, effMove(u, state.turn)).some((p) => posEq(p, a.to))
    return ok ? null : 'unreachable cell'
  }

  if (a.type === 'attack') {
    const homing = abilityValue(u.inst, 'homing') !== null
    if (homing) {
      if (a.aim.kind !== 'unit') return 'homing must target a unit'
      const t = units[a.aim.id]
      if (!t || !t.alive || t.owner !== opponent(side)) return 'bad homing target'
      if (!atResolve && manhattan(u.pos, t.pos) > effRange(u)) return 'out of range'
      return null
    }
    if (a.aim.kind !== 'cell') return 'attack must target a cell'
    if (!inZone(cfg, opponent(side), a.aim.pos)) return 'must aim at enemy zone'
    if (manhattan(u.pos, a.aim.pos) > effRange(u)) return 'out of range'
    return null
  }

  // skill
  const ab = u.inst.ability
  if (!ab || ABILITIES[ab.kind].use !== 'skill') return 'unit has no skill'
  if (ABILITIES[ab.kind].buff && u.readyTurn > state.turn) return 'skill on cooldown'
  if (ab.kind === 'heal') {
    if (a.aim?.kind !== 'unit') return 'heal must target an ally'
    const t = units[a.aim.id]
    if (!t || !t.alive || t.owner !== side) return 'bad heal target'
    if (manhattan(u.pos, t.pos) > effRange(u)) return 'out of range'
  }
  if (ab.kind === 'areaHeal') {
    if (a.aim?.kind !== 'cell') return 'area heal must target a cell'
    if (!inZone(cfg, side, a.aim.pos)) return 'must aim at own zone'
    if (manhattan(u.pos, a.aim.pos) > effRange(u)) return 'out of range'
  }
  return null
}

/**
 * 턴 입력 검증 (사람·AI·서버 공통).
 * 내 행동은 결정적이므로 이동·버프를 차례로 반영한 판에서 각 행동을 검사한다.
 * 상대 행동(사망·무효)은 실행 시점에 처리.
 */
export function validatePlan(state: GameState, side: Side, plan: TurnPlan): Validation {
  const cfg = state.config
  const errors: string[] = []
  if (state.phase !== 'plan') errors.push(`phase is ${state.phase}`)
  if (plan.length !== cfg.actionsPerTurn) errors.push(`plan must have ${cfg.actionsPerTurn} actions`)

  const units = cloneUnits(state.units)
  const repeatOk = canRepeat(state, side)
  const used = new Set<UnitId>()
  let moves = 0
  plan.forEach((a, i) => {
    if (a.type === 'wait') return
    if (used.has(a.unit) && !repeatOk) return void errors.push(`action ${i}: unit already acted`)
    const err = actionError(state, units, side, a)
    if (err) return void errors.push(`action ${i}: ${err}`)
    used.add(a.unit)
    const u = units[a.unit]!
    if (a.type === 'move') {
      u.pos = { ...a.to }
      moves++
    }
    if (a.type === 'skill') applySelfBuffForPlanning(state, u)
  })
  if (moves < cfg.minMovesPerTurn && anyMovePossible(state, side))
    errors.push(`at least ${cfg.minMovesPerTurn} move(s) per turn`)
  return validation(errors)
}

/** 계획 단계에서 이동력에 영향을 주는 자기 버프만 반영 (같은 유닛 반복 행동용) */
function applySelfBuffForPlanning(state: GameState, u: UnitState) {
  const ab = u.inst.ability
  if (!ab) return
  const v = ABILITIES[ab.kind].tiers[ab.tier] ?? 0
  if (ab.kind === 'moveUp' || ab.kind === 'allUp')
    u.buffs.push({ stat: 'move', amount: v, untilTurn: state.turn + state.config.buffTurns - 1 })
  if (ABILITIES[ab.kind].buff) u.readyTurn = state.turn + state.config.buffCooldownTurns
}
