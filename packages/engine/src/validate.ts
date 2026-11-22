import { canStandOn, inBounds, posEq, unitAt, zoneOf } from './board.ts'
import type { GameConfig } from './config.ts'
import { isAimValid } from './trajectory.ts'
import type { Deployment, GameState, Pos, Side, TurnPlan, UnitId, UnitInstance, UnitState } from './types.ts'
import { canRepeatActions, champOf, moveRangeOf, trajectoryOf } from './units.ts'

export type Validation = { ok: true } | { ok: false; errors: string[] }

export const validation = (errors: string[]): Validation => (errors.length ? { ok: false, errors } : { ok: true })

export class EngineError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(errors.length ? `${message}: ${errors.join('; ')}` : message)
    this.name = 'EngineError'
  }
}

/**
 * 이동의 기하 조건 (목표 칸 점유 여부 제외 — 점유는 실행 시점에 판정).
 * 상하좌우 직선 1..이동거리 칸, 서 있을 수 있는 칸, 경로 중간 칸은 비어 있어야 함.
 */
export function isMoveGeometryValid(
  state: Pick<GameState, 'config' | 'catalog'>,
  units: Record<UnitId, UnitState>,
  unit: UnitState,
  to: Pos,
): boolean {
  const cfg = state.config
  if (!inBounds(cfg, to) || !canStandOn(cfg, unit.owner, to)) return false
  const dx = to.x - unit.pos.x
  const dy = to.y - unit.pos.y
  if (dx !== 0 && dy !== 0) return false
  const dist = Math.abs(dx) + Math.abs(dy)
  if (dist < 1 || dist > moveRangeOf(champOf(state, unit), unit.instance)) return false
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  for (let i = 1; i < dist; i++) {
    const mid = { x: unit.pos.x + sx * i, y: unit.pos.y + sy * i }
    if (!canStandOn(cfg, unit.owner, mid) || unitAt(units, mid)) return false
  }
  return true
}

/** 덱 구조 검증. 능력치 범위 검증은 gacha/validateUnit 담당 */
export function validateTeam(
  cfg: GameConfig,
  catalog: GameState['catalog'],
  team: readonly UnitInstance[],
): Validation {
  const errors: string[] = []
  if (team.length !== cfg.cardsPerSide) errors.push(`team must have ${cfg.cardsPerSide} cards`)
  const ids = new Set<string>()
  const champs = new Set<string>()
  for (const u of team) {
    const c = catalog[u.champId]
    if (!c) errors.push(`unknown champ ${u.champId}`)
    else if (u.specials.length !== c.specialSlots) errors.push(`${u.id}: special slot count mismatch`)
    if (u.stats.hp < 1) errors.push(`${u.id}: hp must be >= 1`)
    if (ids.has(u.id)) errors.push(`duplicate unit ${u.id}`)
    ids.add(u.id)
    if (!cfg.allowDuplicateChamps && champs.has(u.champId)) errors.push(`duplicate champ ${u.champId}`)
    champs.add(u.champId)
  }
  return validation(errors)
}

export function validateDeployment(state: GameState, side: Side, dep: Deployment): Validation {
  const cfg = state.config
  const errors: string[] = []
  if (dep.length !== state.teams[side].length) errors.push('deployment size mismatch')
  dep.forEach((p, i) => {
    if (!inBounds(cfg, p) || zoneOf(cfg, p) !== side) errors.push(`card ${i}: must be in own zone`)
    if (dep.findIndex((q) => posEq(p, q)) !== i) errors.push(`card ${i}: duplicate cell`)
  })
  return validation(errors)
}

/**
 * 턴 입력 검증 (사람·AI·서버 공통).
 * 구조 조건 + 턴 시작 시점 위치 기준 기하 조건을 검사한다.
 * 실행 중 상황 변화(사망, 점유 등)는 resolve 단계에서 fizzle/blocked 로 처리.
 */
export function validatePlan(state: GameState, side: Side, plan: TurnPlan): Validation {
  const cfg = state.config
  const errors: string[] = []
  if (state.phase !== 'plan') errors.push(`phase is ${state.phase}`)
  if (plan.length !== cfg.actionsPerTurn) errors.push(`plan must have ${cfg.actionsPerTurn} actions`)

  const attacks = plan.filter((a) => a.type === 'attack').length
  if (attacks > cfg.maxAttacksPerTurn) errors.push(`at most ${cfg.maxAttacksPerTurn} attacks per turn`)

  const repeatOk = canRepeatActions(state, side)
  const used = new Set<UnitId>()
  plan.forEach((a, i) => {
    if (a.type === 'wait') return
    const u = state.units[a.unit]
    if (!u) return void errors.push(`action ${i}: unknown unit ${a.unit}`)
    if (u.owner !== side) return void errors.push(`action ${i}: not your unit`)
    if (!u.alive) return void errors.push(`action ${i}: unit is dead`)
    const repeat = used.has(a.unit)
    if (repeat && !repeatOk) return void errors.push(`action ${i}: unit already acted`)
    used.add(a.unit)
    // 같은 카드 반복 행동 시 위치가 바뀌었을 수 있으므로 기하 검사는 첫 행동만
    if (repeat) return
    if (a.type === 'move') {
      if (!isMoveGeometryValid(state, state.units, u, a.to)) errors.push(`action ${i}: invalid move`)
    } else {
      const traj = trajectoryOf(champOf(state, u), u.instance)
      if (!isAimValid(cfg, traj, u.pos, a.aim)) errors.push(`action ${i}: invalid aim`)
    }
  })
  return validation(errors)
}
