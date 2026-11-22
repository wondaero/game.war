import { opponent, unitAt } from './board.ts'
import { applyBp, computeHitParams } from './hit.ts'
import { allAims, computeAttack, type AttackGeometry } from './trajectory.ts'
import type { Aim, ChampTemplate, GameState, Pos, Side, UnitId, UnitState } from './types.ts'
import { champOf, specialValue, trajectoryOf } from './units.ts'
import { isMoveGeometryValid } from './validate.ts'

/**
 * 읽기 전용 질의 (UI 미리보기·AI 공용). 상태를 바꾸지 않는다.
 */

export function templateOf(state: GameState, unit: UnitState): ChampTemplate {
  return champOf(state, unit)
}

/** 현재 판 기준 이동 가능한 칸 (지금 비어 있는 칸) */
export function legalMoves(state: GameState, unitId: UnitId, units = state.units): Pos[] {
  const u = units[unitId]
  if (!u || !u.alive) return []
  const cfg = state.config
  const out: Pos[] = []
  for (let y = 0; y < cfg.boardHeight; y++)
    for (let x = 0; x < cfg.boardWidth; x++) {
      const p = { x, y }
      if (!unitAt(units, p) && isMoveGeometryValid(state, units, u, p)) out.push(p)
    }
  return out
}

export interface AttackPreview {
  aim: Aim
  geometry: AttackGeometry
}

/** 현재 판 기준 가능한 모든 조준과 그 궤적 */
export function attackPreviews(state: GameState, unitId: UnitId, units = state.units): AttackPreview[] {
  const u = units[unitId]
  if (!u || !u.alive) return []
  const traj = trajectoryOf(champOf(state, u), u.instance)
  const out: AttackPreview[] = []
  for (const aim of allAims(state.config, traj, u.pos)) {
    const geometry = computeAttack(state.config, units, u, traj, aim)
    if (geometry) out.push({ aim, geometry })
  }
  return out
}

export interface HitOdds {
  /** ② 방어력 감소 후 피해 */
  afterArmor: number
  /** ③ 현재 보호막이 흡수할 양 */
  absorbed: number
  /** ④ 예상 체력 피해 */
  hpDamage: number
  /** ⑤ 공격자가 받을 반사 피해 (공격자 보호막 흡수 전) */
  reflected: number
}

/** 화면 표시·AI 평가용 (실제 판정과 같은 공식, 판 안에 확률 없음) */
export function hitOdds(state: GameState, attacker: UnitState, target: UnitState, pierceIndex = 0): HitOdds {
  const { afterArmor } = computeHitParams(state, attacker, target, pierceIndex)
  const absorbed = Math.min(target.shield, afterArmor)
  return {
    afterArmor,
    absorbed,
    hpDamage: afterArmor - absorbed,
    reflected: applyBp(afterArmor, specialValue(target.instance, 'reflect')),
  }
}

/** side 의 유닛 중 현재 위치에서 상대가 맞힐 수 있는 유닛과 위협 피해 합 */
export function threatMap(state: GameState, side: Side, units = state.units): Map<UnitId, number> {
  const threat = new Map<UnitId, number>()
  for (const enemy of Object.values(units)) {
    if (!enemy.alive || enemy.owner !== opponent(side)) continue
    const best = new Map<UnitId, number>()
    for (const p of attackPreviews(state, enemy.id, units)) {
      for (const [i, t] of p.geometry.targets.entries()) {
        const e = hitOdds(state, enemy, units[t]!, i).hpDamage
        best.set(t, Math.max(best.get(t) ?? 0, e))
      }
    }
    for (const [t, e] of best) threat.set(t, (threat.get(t) ?? 0) + e)
  }
  return threat
}
