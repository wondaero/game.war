import { ABILITIES, abilityValue } from './abilities.ts'
import { aliveOf, effMove, effRange, inZone, manhattan, opponent, posEq, reachable } from './board.ts'
import type { Action, GameState, Pos, Side, TurnPlan, UnitId, UnitState } from './types.ts'

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

/** 유닛 하나가 이번 턴에 할 수 있는 행동 수 (살아 있는 내 유닛 수로 정해짐) */
export function actionsPerUnit(state: GameState, side: Side): number {
  return state.config.actionsPerUnitByAlive[aliveOf(state.units, side).length] ?? 1
}

/** 유닛 하나가 이번 턴에 할 수 있는 액션(공격·행동형 능력) 수 */
export function actsPerUnit(state: GameState, side: Side): number {
  return state.config.actsPerUnitByAlive[aliveOf(state.units, side).length] ?? 1
}

/** 같은 유닛이 여러 번 행동할 수 있는지 */
export function canRepeat(state: GameState, side: Side): boolean {
  return actionsPerUnit(state, side) > 1
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
  const cap = actionsPerUnit(state, side)
  const actCap = actsPerUnit(state, side)
  const used = new Map<UnitId, number>()
  const unitActs = new Map<UnitId, number>()
  let moves = 0
  let acts = 0
  plan.forEach((a, i) => {
    if (a.type === 'wait') return
    if ((used.get(a.unit) ?? 0) >= cap) return void errors.push(`action ${i}: unit already acted`)
    const isAct = a.type === 'attack' || a.type === 'skill'
    if (isAct && acts >= cfg.maxActsPerTurn) return void errors.push(`action ${i}: too many acts`)
    if (isAct && (unitActs.get(a.unit) ?? 0) >= actCap) return void errors.push(`action ${i}: unit already acted`)
    const err = actionError(state, units, side, a)
    if (err) return void errors.push(`action ${i}: ${err}`)
    used.set(a.unit, (used.get(a.unit) ?? 0) + 1)
    if (isAct) {
      acts++
      unitActs.set(a.unit, (unitActs.get(a.unit) ?? 0) + 1)
    }
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

// ───────────── 화면·대전 진행용 ─────────────

/** 모자란 칸은 대기로 채움 (넘치면 자름) */
export function padPlan(plan: readonly Action[], n: number): Action[] {
  const out = plan.slice(0, n)
  while (out.length < n) out.push({ type: 'wait' })
  return out
}

/** 안전장치: 처음으로 이동할 수 있는 유닛을 첫 이동 가능 칸으로 + 나머지 대기 */
export function fallbackPlan(state: GameState, side: Side): TurnPlan {
  const out: Action[] = []
  for (const u of aliveOf(state.units, side)) {
    const r = reachable(state.config, state.units, u, effMove(u, state.turn))
    if (r.length) {
      out.push({ type: 'move', unit: u.id, to: r[0]! })
      break
    }
  }
  return padPlan(out, state.config.actionsPerTurn)
}

/**
 * 제출된 계획을 규칙에 맞게 정리 (앱·상대 기기·서버가 같은 결과를 내도록 결정적).
 * 1) 그대로 맞으면 그대로
 * 2) 이동이 하나도 없어서 틀린 거면, 빈 칸(대기) 하나를 가능한 첫 이동으로 바꿔 봄 (시간 초과 대비)
 * 3) 그래도 안 되면 안전장치 계획
 */
export function sanitizePlan(state: GameState, side: Side, raw: unknown): TurnPlan {
  const n = state.config.actionsPerTurn
  const plan = Array.isArray(raw) ? padPlan(raw as Action[], n) : padPlan([], n)
  try {
    if (validatePlan(state, side, plan).ok) return plan
    if (!plan.some((a) => a?.type === 'move')) {
      for (let i = 0; i < n; i++) {
        if (plan[i]!.type !== 'wait') continue
        const units = planUnits(state, side, plan.slice(0, i))
        for (const u of aliveOf(units, side))
          for (const to of reachable(state.config, units, u, effMove(u, state.turn))) {
            const cand = plan.map((a, k) => (k === i ? ({ type: 'move', unit: u.id, to } as Action) : a))
            if (validatePlan(state, side, cand).ok) return cand
          }
      }
    }
  } catch {
    // 형식이 깨진 입력
  }
  return fallbackPlan(state, side)
}

/**
 * 계획 단계에서 내 행동을 차례로 반영한 판 (행동 1에서 옮긴 유닛은 행동 2부터 옮긴 자리 기준).
 * 상대 행동은 모르므로 반영하지 않는다. 규칙에 안 맞는 행동은 건너뜀.
 */
export function planUnits(state: GameState, side: Side, actions: readonly Action[]): Record<UnitId, UnitState> {
  const units = cloneUnits(state.units)
  for (const a of actions) {
    if (a.type === 'wait' || actionError(state, units, side, a)) continue
    const u = units[a.unit]!
    if (a.type === 'move') u.pos = { ...a.to }
    if (a.type === 'skill') applySelfBuffForPlanning(state, u)
  }
  return units
}

/** 배치 검증: 내 진영 안, 칸 겹침 없음, 인원 수 일치 */
export function validateDeployment(state: GameState, side: Side, dep: unknown): Validation {
  const cfg = state.config
  const errors: string[] = []
  if (!Array.isArray(dep) || dep.length !== state.teams[side].length) return validation(['deployment size mismatch'])
  const seen = new Set<string>()
  dep.forEach((p: Pos, i) => {
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' || !inZone(cfg, side, p)) errors.push(`${i}: must be in own zone`)
    else if (seen.has(`${p.x},${p.y}`)) errors.push(`${i}: duplicate cell`)
    else seen.add(`${p.x},${p.y}`)
  })
  return validation(errors)
}
