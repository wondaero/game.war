import { abilityValue } from './abilities.ts'
import { effArmor, effAtk, inZone, maxHp, opponent, square3 } from './board.ts'
import { applyBp, BP, type V2Config } from './config.ts'
import type { Aim, Pos, UnitId, UnitState } from './types.ts'

/**
 * 공격 1건(공격자 → 대상)의 피해. 판정·AI·화면이 같은 함수를 쓴다.
 * 순서: 방어력(방어력 무시 반영) 먼저 빼고 → 비율(광역딜·유도탄) → 퍼센트딜 추가 → 최소 1
 */
export function hitDamage(att: UnitState, tgt: UnitState, turn: number): number {
  let armor = effArmor(tgt, turn)
  const pierce = abilityValue(att.inst, 'armorPierce')
  if (pierce) armor -= applyBp(armor, pierce)
  let dmg = Math.max(0, effAtk(att, turn) - armor)
  const ratio = abilityValue(att.inst, 'splash') ?? abilityValue(att.inst, 'homing')
  if (ratio !== null) dmg = applyBp(dmg, ratio)
  const pct = abilityValue(att.inst, 'percentDmg')
  if (pct) dmg += applyBp(maxHp(tgt, turn), pct)
  return Math.max(1, dmg)
}

/** 조준 → 피해 칸·맞는 적 (positions = 이동 처리 후 판) */
export function attackTargets(
  cfg: V2Config,
  units: Record<UnitId, UnitState>,
  att: UnitState,
  aim: Aim,
): { cells: Pos[]; targets: UnitState[] } {
  const enemy = opponent(att.owner)
  if (aim.kind === 'unit') {
    const t = units[aim.id]
    return t && t.alive ? { cells: [{ ...t.pos }], targets: [t] } : { cells: [], targets: [] }
  }
  const cells = abilityValue(att.inst, 'splash') !== null ? square3(cfg, aim.pos) : [aim.pos]
  const targets = Object.values(units)
    .filter((u) => u.alive && u.owner === enemy && cells.some((c) => c.x === u.pos.x && c.y === u.pos.y))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  return { cells: cells.filter((c) => inZone(cfg, enemy, c)), targets }
}

/** 행동형 회복량: 받는 쪽 공격력 × 비율 (최소 1) */
export const skillHealAmount = (recipient: UnitState, bp: number, turn: number) =>
  Math.max(1, applyBp(effAtk(recipient, turn), bp))

export { BP }
