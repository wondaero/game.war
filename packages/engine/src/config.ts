/**
 * 밸런스·규칙 수치. 엔진 코드에는 매직 넘버를 두지 않고 전부 여기서 읽는다.
 * 비율 단위는 basis point (1% = 100, 100% = 10000).
 * 뽑기 확률·비용은 gacha/table.ts 에서 따로 관리.
 */
export interface GameConfig {
  boardWidth: number
  boardHeight: number
  /** 각 진영의 줄 수. 나머지 가운데 줄은 중립. */
  zoneRows: number
  cardsPerSide: number

  actionsPerTurn: number
  maxAttacksPerTurn: number
  /** 같은 카드가 한 턴에 여러 행동을 할 수 있는지 (항상) */
  allowSameCardMultiAction: boolean
  /** 살아 있는 카드가 이 수 이하이면 같은 카드 여러 행동 허용 (막판 교착 방지). 0 = 사용 안 함 */
  multiActionWhenCardsAtMost: number

  /** 직사·대각 관통: 뒤 대상마다 피해에 곱하는 비율 (5000 = 50%씩 감소). 0 = 첫 적에서 멈춤 */
  lineFalloffBp: number

  /** 중립 줄까지 이동 가능 여부 */
  moveAllowNeutral: boolean
  /** 상대 진영까지 이동 가능 여부 */
  moveAllowEnemyZone: boolean

  turnTimeLimitMs: number

  /** 이 턴 수를 넘기면 남은 체력 비율로 판정 */
  maxTurns: number

  /** 덱에 같은 챔프 중복 허용 */
  allowDuplicateChamps: boolean

  // ── 회복 ──
  /** 유닛별 턴당 회복 상한 (최대 HP 대비) */
  healCapBp: number
  /** 이 턴부터 모든 회복량에 suddenDeathHealBp 배율 적용 */
  suddenDeathTurn: number
  suddenDeathHealBp: number

  // ── 위험지대 (교착 방지) ──
  /** 이 턴부터 자기 진영 뒷줄이 위험지대. 0 = 사용 안 함 */
  dangerZoneStartTurn: number
  /** 위험지대 깊이가 1줄씩 늘어나는 간격(턴) */
  dangerZoneGrowEveryTurns: number
  /** 위험지대 최대 깊이(줄). zoneRows 이하 */
  dangerZoneMaxDepth: number
  /** 턴 끝 위험지대 피해: 최대 HP 대비 (방어력·보호막 무시, 최소 1) */
  dangerZoneDamageBp: number

  // ── 유닛 개체 ──
  /** 회복 계열(자체 회복·공격 시 회복) 특수능력 최대 개수 */
  maxHealSpecialsPerUnit: number
  /** 이동거리·사거리도 개체 랜덤/리롤 대상인지 */
  rerollMovementAndRange: boolean
  /** 리롤 시 잠글 수 있는 일반 능력치 수 */
  maxStatLocks: number
  /** 리롤 시 잠글 수 있는 특수능력 슬롯 수 (구조만 존재, 현재 0) */
  maxSpecialLocks: number
}

export const DEFAULT_CONFIG: Readonly<GameConfig> = Object.freeze({
  // 6×6, 각 진영 3줄(18칸), 중립 줄 없음 → 양쪽 앞줄이 맞닿음
  boardWidth: 6,
  boardHeight: 6,
  zoneRows: 3,
  cardsPerSide: 4,

  actionsPerTurn: 3,
  maxAttacksPerTurn: 2,
  allowSameCardMultiAction: false,
  multiActionWhenCardsAtMost: 2,

  lineFalloffBp: 5000,

  moveAllowNeutral: true,
  moveAllowEnemyZone: false,

  turnTimeLimitMs: 30_000,

  maxTurns: 20,

  allowDuplicateChamps: false,

  healCapBp: 1000,
  suddenDeathTurn: 10,
  suddenDeathHealBp: 5000,

  // 시뮬레이션 기준 (balance.sim 12번, 6×6): 후방 고수끼리 무승부 55% → 5%. 3줄 전부는 동시 전멸 무승부가 늘어 2줄까지
  dangerZoneStartTurn: 5,
  dangerZoneGrowEveryTurns: 3,
  dangerZoneMaxDepth: 2,
  dangerZoneDamageBp: 2500,

  maxHealSpecialsPerUnit: 1,
  rerollMovementAndRange: false,
  maxStatLocks: 2,
  maxSpecialLocks: 0,
})

export const BP = 10_000

export function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  const cfg = { ...DEFAULT_CONFIG, ...overrides }
  validateConfig(cfg)
  return cfg
}

export function validateConfig(cfg: GameConfig): void {
  const fail = (msg: string) => {
    throw new Error(`Invalid config: ${msg}`)
  }
  if (cfg.zoneRows * 2 > cfg.boardHeight) fail('zones overlap')
  if (cfg.cardsPerSide > cfg.zoneRows * cfg.boardWidth) fail('not enough cells for cards')
  if (cfg.actionsPerTurn < 1) fail('actionsPerTurn must be >= 1')
  if (cfg.maxAttacksPerTurn < 0) fail('maxAttacksPerTurn must be >= 0')
  if (cfg.maxTurns < 1) fail('maxTurns must be >= 1')
  if (cfg.healCapBp < 0 || cfg.healCapBp > BP) fail('healCapBp must be within 0..10000')
  if (cfg.suddenDeathHealBp < 0 || cfg.suddenDeathHealBp > BP) fail('suddenDeathHealBp must be within 0..10000')
  if (cfg.lineFalloffBp < 0 || cfg.lineFalloffBp > BP) fail('lineFalloffBp must be within 0..10000')
  if (cfg.dangerZoneMaxDepth < 0 || cfg.dangerZoneMaxDepth > cfg.zoneRows) fail('dangerZoneMaxDepth must be within 0..zoneRows')
  if (cfg.dangerZoneGrowEveryTurns < 1) fail('dangerZoneGrowEveryTurns must be >= 1')
  if (cfg.dangerZoneDamageBp < 0 || cfg.dangerZoneDamageBp > BP) fail('dangerZoneDamageBp must be within 0..10000')
  if (cfg.maxStatLocks < 0 || cfg.maxSpecialLocks < 0) fail('locks must be >= 0')
}
