import type { V2Config } from './config.ts'

/** A = 아래 진영, B = 위 진영. y = 0 이 맨 위(B 쪽) */
export type Side = 'A' | 'B'
export const SIDES: readonly Side[] = ['A', 'B']

export interface Pos {
  x: number
  y: number
}

/** 개체마다 뽑기로 정해지는 능력치 */
export interface Stats {
  atk: number
  armor: number
  hp: number
  move: number
  range: number
}
export type StatKey = keyof Stats
export const STAT_KEYS: readonly StatKey[] = ['atk', 'armor', 'hp', 'move', 'range']

// ───────────── 특수능력 (docs/spec) ─────────────

export type AbilityKind =
  | 'armorPierce' // 1. 방어력 무시
  | 'splash' // 2. 광역딜 3×3
  | 'heal' // 3. 아군 회복 (행동)
  | 'areaHeal' // 4. 아군 광역 회복 3×3 (행동)
  | 'moveRegen' // 5. 이동 시 자가 회복
  | 'nullify' // 6. 상대 다음 행동 무효
  | 'reflect' // 8. 반사
  | 'lifesteal' // 9. 흡혈
  | 'slow' // 10. 이동수 제어
  | 'homing' // 11. 유도탄
  | 'poison' // 12. 맹독
  | 'percentDmg' // 13. 퍼센트딜
  | 'teamArmorUp' // 14. 아군 전체 방어력 업 (행동)
  | 'teamAtkUp' // 15. 아군 전체 공격력 업 (행동)
  | 'moveUp' // 16. 이동수 증가 (행동)
  | 'allUp' // 17. 모두 레벨업 (행동)
  | 'doping' // 18. 도핑
// 7. 투명 이동은 이번 구현에서 제외 (docs/design.md 참고)

export interface Ability {
  kind: AbilityKind
  /** 0부터. 수치는 abilities.ts 의 tiers[tier] */
  tier: number
}

/** 보유 개체. image = 그림(성능 무관) */
export interface UnitInstance {
  id: string
  image: string
  stats: Stats
  ability: Ability | null
  /** 획득 시각 (보관함 정렬용, 성능 무관) */
  createdAt?: number
}

export type UnitId = string

export interface Buff {
  stat: 'atk' | 'armor' | 'move' | 'hp'
  amount: number
  /** 이 턴 끝까지 유지 */
  untilTurn: number
}

export interface PoisonStack {
  damage: number
  /** 이 턴 끝까지 틱 */
  untilTurn: number
}

export interface UnitState {
  id: UnitId
  owner: Side
  inst: UnitInstance
  pos: Pos
  hp: number
  alive: boolean
  buffs: Buff[]
  poison: PoisonStack[]
  /** 다음 행동 1회 무효 대기 */
  nullified: boolean
  /** 이 턴에 이동력 −1 (0 = 없음) */
  slowTurn: number
  /** 이 턴부터 능력(버프) 다시 사용 가능 */
  readyTurn: number
  /** 이동 시 자가 회복을 이미 쓴 턴 (턴당 1번) */
  moveRegenTurn: number
  /** 행동 없이 회복된 양 (턴당 상한용) */
  passiveHealTurn: number
  passiveHealed: number
}

// ───────────── 행동 ─────────────

export type Aim = { kind: 'cell'; pos: Pos } | { kind: 'unit'; id: UnitId }

export type Action =
  /** 도착 칸 고정 (M6) */
  | { type: 'move'; unit: UnitId; to: Pos }
  /** 일반 = 칸 조준, 유도탄 = 유닛 지정 */
  | { type: 'attack'; unit: UnitId; aim: Aim }
  /** 행동형 능력. 회복 = 아군 유닛, 광역 회복 = 칸, 버프 = 대상 없음 */
  | { type: 'skill'; unit: UnitId; aim?: Aim }
  | { type: 'wait' }

export type TurnPlan = readonly Action[]

// ───────────── 상태 ─────────────

export type Phase = 'deploy' | 'plan' | 'over'
/** annihilation = 전멸, oneOnOne = 1대1 판정, maxTurns = 최대 턴 판정 */
export type GameResult = { winner: Side | 'draw'; reason: 'annihilation' | 'oneOnOne' | 'maxTurns' }

export interface GameState {
  config: V2Config
  phase: Phase
  /** 1부터 */
  turn: number
  teams: Record<Side, readonly UnitInstance[]>
  units: Record<UnitId, UnitState>
  result: GameResult | null
}

// ───────────── 로그 ─────────────

export type FizzleReason = 'dead' | 'nullified' | 'invalid'

export type GameEvent =
  | { type: 'fizzle'; side: Side; action: Action; reason: FizzleReason }
  | { type: 'move'; unit: UnitId; from: Pos; to: Pos }
  | { type: 'moveBlocked'; unit: UnitId; to: Pos }
  | { type: 'attack'; unit: UnitId; aim: Aim; cells: Pos[]; hits: { target: UnitId; damage: number }[] }
  | { type: 'heal'; unit: UnitId; amount: number; source: 'heal' | 'areaHeal' | 'moveRegen' | 'lifesteal' }
  | { type: 'buff'; unit: UnitId; kind: AbilityKind; targets: UnitId[] }
  | { type: 'reflect'; from: UnitId; to: UnitId; damage: number }
  | { type: 'status'; unit: UnitId; status: 'nullified' | 'slowed' | 'poisoned' }
  | { type: 'poisonTick'; unit: UnitId; damage: number }
  | { type: 'zoneDamage'; unit: UnitId; damage: number }
  | { type: 'death'; unit: UnitId }
  | { type: 'gameOver'; result: GameResult }

export interface TurnLog {
  turn: number
  plans: Record<Side, TurnPlan>
  steps: GameEvent[][]
  endEvents: GameEvent[]
}
