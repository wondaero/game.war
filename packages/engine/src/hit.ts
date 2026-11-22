import { BP } from './config.ts'
import { applyEffects } from './effects.ts'
import { lineFalloffBp } from './trajectory.ts'
import { champOf, trajectoryOf } from './units.ts'
import type { GameState, UnitState } from './types.ts'

export interface HitParams {
  /** ① 공격력 기반 피해 (범위 비율·관통 감쇠·효과 반영) */
  base: number
  /** ② 대상 방어력 감소 후, 최소 1 */
  afterArmor: number
  effects: string[]
}

/**
 * 공격자 → 피격자 1건의 피해 ①②.
 * 실제 판정(resolve)과 화면 표시·AI(query)가 같은 함수를 써서 어긋나지 않게 한다.
 */
export function computeHitParams(
  state: GameState,
  attacker: UnitState,
  target: UnitState,
  /** 직사·대각 관통 순번 (0 = 첫 대상) */
  pierceIndex = 0,
): HitParams {
  const atkC = champOf(state, attacker)
  const defC = champOf(state, target)
  const atkMod = applyEffects('onAttack', { self: attacker, selfChamp: atkC, other: target, otherChamp: defC })
  const defMod = applyEffects('onDefend', { self: target, selfChamp: defC, other: attacker, otherChamp: atkC })

  let base = Math.max(0, atkMod.stats.atk)
  const traj = trajectoryOf(atkC, attacker.instance)
  if (traj.kind === 'area') base = Math.floor((base * traj.damageBp) / BP)
  const falloff = lineFalloffBp(state.config, traj)
  for (let i = 0; i < pierceIndex; i++) base = Math.floor((base * falloff) / BP)
  base = Math.floor((base * atkMod.damageBp) / BP)

  const afterArmor = Math.max(1, base - Math.max(0, defMod.stats.armor))
  return { base, afterArmor, effects: [...atkMod.applied, ...defMod.applied] }
}

/** 비율 적용 (내림) */
export const applyBp = (amount: number, bp: number) => Math.floor((amount * bp) / BP)
