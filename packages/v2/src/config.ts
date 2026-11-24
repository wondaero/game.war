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
  /** 유닛 하나가 한 턴에 할 수 있는 행동 수. index = 내 살아 있는 유닛 수 (없으면 1) */
  actionsPerUnitByAlive: readonly number[]
  /** 한 턴 액션(공격·행동형 능력) 최대 횟수 (팀 전체). 이동·대기는 액션이 아님 */
  maxActsPerTurn: number
  /** 유닛 하나의 한 턴 액션 횟수. index = 내 살아 있는 유닛 수 (없으면 1) */
  actsPerUnitByAlive: readonly number[]

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
  // 이동 의무 없음 (2026-11-24): 아무것도 안 하면 대기 3번. 시뮬레이션 비교용으로 설정은 남겨 둠
  minMovesPerTurn: 0,
  // 규칙 ② (시뮬레이션 비교로 결정): 행동은 같은 캐릭이 여러 번 가능, 액션(공격·마법·회복)은 턴당 2번·캐릭당 1번
  actionsPerUnitByAlive: [0, 3, 3, 3, 3],
  maxActsPerTurn: 2,
  actsPerUnitByAlive: [0, 1, 1, 1, 1],

  maxTurns: 20,
  judgeBy: 'hpRatio',

  passiveHealCapBp: 1000,
  suddenDeathTurn: 10,
  suddenDeathHealBp: 5000,

  // 오리지날 맵: 위험지대 없음 (0 = 끔). 이벤트 맵에서 켤 수 있게 나머지 설정은 남겨 둠 (예: 5턴부터)
  dangerZoneStartTurn: 0,
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
