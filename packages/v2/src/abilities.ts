import type { AbilityKind, UnitInstance } from './types.ts'

/**
 * 특수능력 표 (docs/spec 그대로). 발동은 항상 100%, 등급(tier)마다 수치만 다름.
 * - attack: 공격할 때 항상 적용
 * - skill: 행동 1개를 써서 사용 (공격 대신)
 * - passive: 저절로 발동
 * 수치 단위: *Bp 는 basis point (50% = 5000), 그 외는 정수 가산치
 */
export type AbilityUse = 'attack' | 'skill' | 'passive'

export interface AbilityDef {
  name: string
  use: AbilityUse
  tiers: readonly number[]
  /** 버프형: 재사용 대기 적용 */
  buff?: boolean
}

export const ABILITIES: Readonly<Record<AbilityKind, AbilityDef>> = {
  armorPierce: { name: '방어력 무시', use: 'attack', tiers: [5000, 10000] },
  splash: { name: '광역딜', use: 'attack', tiers: [2000, 3000, 4000, 5000] },
  heal: { name: '아군 회복', use: 'skill', tiers: [4000, 5000, 6000] },
  areaHeal: { name: '아군 광역 회복', use: 'skill', tiers: [1000, 2000, 3000] },
  moveRegen: { name: '이동 시 자가 회복', use: 'passive', tiers: [1000, 2000] },
  nullify: { name: '다음 행동 무효', use: 'attack', tiers: [0] },
  reflect: { name: '반사', use: 'passive', tiers: [2000, 3000] },
  lifesteal: { name: '흡혈', use: 'attack', tiers: [1000, 2000, 3000] },
  slow: { name: '이동수 제어', use: 'attack', tiers: [1] },
  homing: { name: '유도탄', use: 'attack', tiers: [3000, 4000, 5000, 6000] },
  poison: { name: '맹독', use: 'attack', tiers: [500, 1000] },
  percentDmg: { name: '퍼센트딜', use: 'attack', tiers: [500, 1000, 1500] },
  teamArmorUp: { name: '아군 전체 방어력 업', use: 'skill', tiers: [1, 2], buff: true },
  teamAtkUp: { name: '아군 전체 공격력 업', use: 'skill', tiers: [1, 2, 3], buff: true },
  moveUp: { name: '이동수 증가', use: 'skill', tiers: [1, 2], buff: true },
  allUp: { name: '모두 레벨업', use: 'skill', tiers: [1, 2], buff: true },
  doping: { name: '도핑', use: 'passive', tiers: [11000, 12000] },
}

export const ABILITY_KINDS = Object.keys(ABILITIES) as AbilityKind[]

/** 개체가 해당 능력을 가졌으면 그 등급 수치, 아니면 null */
export function abilityValue(inst: UnitInstance, kind: AbilityKind): number | null {
  const a = inst.ability
  if (!a || a.kind !== kind) return null
  return ABILITIES[kind].tiers[a.tier] ?? null
}

export const isSkillUnit = (inst: UnitInstance) => !!inst.ability && ABILITIES[inst.ability.kind].use === 'skill'
