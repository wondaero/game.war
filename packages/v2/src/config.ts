import type { Stats } from './types.ts'

/** 비율 단위 basis point (1% = 100, 100% = 10000) */
export const BP = 10_000

export interface Range {
  min: number
  max: number
}

export interface V2Config {
  boardWidth: number
  boardHeight: number
  zoneRows: number
  cardsPerSide: number

  actionsPerTurn: number
  /** 턴마다 최소 이동 횟수 (이동할 수 있는 유닛이 하나도 없으면 면제) */
  minMovesPerTurn: number
  /** 살아 있는 유닛이 이 수 이하이면 같은 유닛 여러 행동 허용 */
  multiActionWhenCardsAtMost: number

  maxTurns: number
  /** 최대 턴 판정: 남은 체력 비율(남은/최대) 또는 남은 체력 합 */
  judgeBy: 'hpRatio' | 'hpTotal'

  /** 행동 없이 회복(자가 회복·흡혈)의 턴당 상한 (최대 체력 대비) */
  passiveHealCapBp: number
  /** 이 턴부터 모든 회복에 배율 */
  suddenDeathTurn: number
  suddenDeathHealBp: number

  dangerZoneStartTurn: number
  dangerZoneGrowEveryTurns: number
  dangerZoneMaxDepth: number
  dangerZoneDamageBp: number

  /** 버프 유지 턴 수 (사용한 턴 포함) */
  buffTurns: number
  /** 버프 능력 재사용 간격 (사용한 턴부터 셈) */
  buffCooldownTurns: number
  /** 맹독 틱 횟수 (맞은 턴 포함) */
  poisonTurns: number

  statRanges: Record<keyof Stats, Range>
  /** 특수능력이 붙을 확률 */
  abilityChanceBp: number
}

export const DEFAULT_V2_CONFIG: Readonly<V2Config> = Object.freeze({
  boardWidth: 6,
  boardHeight: 6,
  zoneRows: 3,
  cardsPerSide: 4,

  actionsPerTurn: 3,
  minMovesPerTurn: 1,
  multiActionWhenCardsAtMost: 2,

  maxTurns: 20,
  judgeBy: 'hpRatio',

  passiveHealCapBp: 1000,
  suddenDeathTurn: 10,
  suddenDeathHealBp: 5000,

  dangerZoneStartTurn: 5,
  dangerZoneGrowEveryTurns: 3,
  dangerZoneMaxDepth: 2,
  dangerZoneDamageBp: 2500,

  buffTurns: 2,
  buffCooldownTurns: 3,
  poisonTurns: 2,

  statRanges: {
    atk: { min: 15, max: 20 },
    armor: { min: 1, max: 5 },
    hp: { min: 30, max: 50 },
    move: { min: 1, max: 2 },
    range: { min: 5, max: 10 },
  },
  abilityChanceBp: 2000,
})

export function makeV2Config(overrides: Partial<V2Config> = {}): V2Config {
  return { ...DEFAULT_V2_CONFIG, ...overrides }
}

export const applyBp = (amount: number, bp: number) => Math.floor((amount * bp) / BP)
