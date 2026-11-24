import { Rng, type RngState } from '@war/engine'
import { ABILITIES, ABILITY_KINDS, abilityDesc } from './abilities.ts'
import type { V2Config } from './config.ts'
import { IMAGES, rollUnit } from './game.ts'
import type { AbilityKind, UnitInstance } from './types.ts'
import { STAT_KEYS } from './types.ts'

/**
 * 뽑기 (새 규칙): 캐릭터는 1종. 뽑을 때마다 그림·능력치·특수능력(20% 확률, 0~1개)이 정해진다.
 * 확률은 config(statRanges, abilityChanceBp)와 abilities.ts 표에서만 나온다.
 */
export type CurrencyId = 'gem'
export const CURRENCIES: readonly CurrencyId[] = ['gem']
export type Cost = Partial<Record<CurrencyId, number>>

export const PULL_COSTS: Readonly<Record<1 | 10, Cost>> = { 1: { gem: 100 }, 10: { gem: 1000 } }
export const pullCost = (count: 1 | 10): Cost => ({ ...PULL_COSTS[count] })

export function newUnitId(rng: Rng): string {
  const h = (n: number) => n.toString(16).padStart(8, '0')
  return `u-${h(rng.nextU32())}${h(rng.nextU32())}`
}

export function pullUnits(cfg: V2Config, rngState: RngState, count: number, now: number) {
  const rng = new Rng(rngState)
  const units: UnitInstance[] = []
  for (let i = 0; i < count; i++) units.push({ ...rollUnit(cfg, rng, newUnitId(rng)), createdAt: now })
  return { units, rng: rng.state() }
}

/** 개발용: 능력을 지정해서 지급 (null = 능력 없음, undefined = 무작위) */
export function grantUnit(cfg: V2Config, rngState: RngState, now: number, ability?: AbilityKind | null) {
  const rng = new Rng(rngState)
  const base = rollUnit(cfg, rng, newUnitId(rng))
  const unit: UnitInstance = { ...base, createdAt: now }
  if (ability === null) unit.ability = null
  else if (ability) unit.ability = { kind: ability, tier: rng.int(ABILITIES[ability].tiers.length) }
  return { unit, rng: rng.state() }
}

export interface RatesDescription {
  images: { image: string; probability: number }[]
  stats: { key: string; min: number; max: number }[]
  abilityChance: number
  abilities: { kind: AbilityKind; name: string; probability: number; tiers: { desc: string; probability: number }[] }[]
  rules: string[]
  costs: Readonly<Record<1 | 10, Cost>>
}

export function describeRates(cfg: V2Config): RatesDescription {
  const chance = cfg.abilityChanceBp / 10_000
  return {
    images: IMAGES.map((image) => ({ image, probability: 1 / IMAGES.length })),
    stats: STAT_KEYS.map((key) => ({ key, ...cfg.statRanges[key] })),
    abilityChance: chance,
    abilities: ABILITY_KINDS.map((kind) => {
      const tiers = ABILITIES[kind].tiers
      return {
        kind,
        name: ABILITIES[kind].name,
        probability: chance / ABILITY_KINDS.length,
        tiers: tiers.map((v) => ({ desc: abilityDesc(kind, v), probability: chance / ABILITY_KINDS.length / tiers.length })),
      }
    }),
    rules: [
      '캐릭터는 1종이고, 그림 8종은 성능과 상관없습니다 (그림은 바꿀 수 없음).',
      '능력치(공격력·방어력·체력·이동·사거리)는 각각 범위 안에서 균등하게 정합니다.',
      `특수능력은 ${Math.round(chance * 100)}% 확률로 1개 붙고, 붙으면 종류 균등 → 등급 균등으로 정합니다.`,
      '덱에는 같은 그림을 2명 넣을 수 없습니다.',
    ],
    costs: PULL_COSTS,
  }
}
