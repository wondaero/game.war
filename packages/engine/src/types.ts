import type { GameConfig } from './config.ts'

/** A = 아래 진영(플레이어 1), B = 위 진영(플레이어 2) */
export type Side = 'A' | 'B'
export const SIDES: readonly Side[] = ['A', 'B']

/** 절대 좌표. y = 0 이 맨 위(B 쪽). 화면 뒤집기는 UI 책임. */
export interface Pos {
  x: number
  y: number
}

/** 역할 = 특화. 지원은 특수능력 슬롯이 많고 일반 능력치가 낮은 쪽 */
export type Role = 'attack' | 'defense' | 'support'

/** 개체마다 랜덤 + 리롤 대상인 일반 능력치 */
export interface Stats {
  hp: number
  atk: number
  /** 받는 피해 고정 감소 */
  armor: number
}
export type StatKey = keyof Stats
export const STAT_KEYS: readonly StatKey[] = ['hp', 'atk', 'armor']

// ───────────── 특수능력 ─────────────

export type SpecialKind = 'regen' | 'shield' | 'reflect' | 'lifesteal'
export const SPECIAL_KINDS: readonly SpecialKind[] = ['regen', 'shield', 'reflect', 'lifesteal']
/** 회복 계열 (유닛당 개수 제한 대상) */
export const HEAL_SPECIALS: readonly SpecialKind[] = ['regen', 'lifesteal']

/**
 * 판 안에서는 확률 없이 확정 동작.
 * regen: 턴 종료 시 회복량(정수) / shield: 보호막량(정수, 매치당 1회)
 * reflect: 받은 피해의 비율(bp) / lifesteal: 준 피해의 비율(bp)
 */
export interface Special {
  kind: SpecialKind
  value: number
}

// ───────────── 궤적 ─────────────

export type OrthoDir = 'up' | 'down' | 'left' | 'right'
export type DiagDir = 'upLeft' | 'upRight' | 'downLeft' | 'downRight'
export type Dir = OrthoDir | DiagDir

/** 사거리·범위 모양은 챔프 고정 */
export type Trajectory =
  /** falloffBp: 관통 시 뒤 대상 피해 비율 (없으면 config.lineFalloffBp, 0 = 첫 적에서 멈춤) */
  | { kind: 'straight'; range: number; falloffBp?: number }
  | { kind: 'diagonal'; range: number; falloffBp?: number }
  | { kind: 'lob'; minRange: number; maxRange: number }
  /** shape: 중심 기준 상대 좌표. damageBp: 공격력 대비 피해 비율 */
  | { kind: 'area'; range: number; shape: readonly Pos[]; damageBp: number }

// ───────────── 챔프 고유 효과 (데이터 정의) ─────────────

/** 공격 판정 1건(공격자→피격자) 안에서 발동하는 시점 */
export type EffectTrigger = 'onAttack' | 'onDefend'

/** 조건은 항상 효과 소유자(self) 관점. other = 판정 상대 */
export type Condition =
  | { kind: 'always' }
  | { kind: 'otherRole'; role: Role }
  | { kind: 'otherTrajectory'; trajectory: Trajectory['kind'] }
  | { kind: 'selfHpBelowBp'; bp: number }
  | { kind: 'otherHpBelowBp'; bp: number }
  | { kind: 'distanceAtLeast'; distance: number }
  | { kind: 'and'; all: readonly Condition[] }
  | { kind: 'or'; any: readonly Condition[] }
  | { kind: 'not'; cond: Condition }

export type Effect =
  /** 이번 판정에서만 자신의 능력치에 더함 (공격력·방어력) */
  | { kind: 'modStat'; stat: Exclude<StatKey, 'hp'>; add: number }
  /** 이번 판정의 기본 피해에 비율 적용 (공격자 효과에서만 의미 있음) */
  | { kind: 'damageBp'; bp: number }

export interface EffectDef {
  id: string
  trigger: EffectTrigger
  condition: Condition
  effect: Effect
  description?: string
}

// ───────────── 챔프 · 유닛 개체 ─────────────

export type RarityId = string

export interface StatRange {
  min: number
  max: number
}

/** 챔프 원본 */
export interface ChampTemplate {
  id: string
  name: string
  role: Role
  rarity: RarityId
  trajectory: Trajectory
  /** 최대 이동거리 (챔프 고정) */
  moveRange: number
  /** 특수능력 슬롯 수 (챔프 고정) */
  specialSlots: number
  /** 일반 능력치 랜덤 범위 (정수, 양끝 포함) */
  statRanges: Record<StatKey, StatRange>
  /** config.rerollMovementAndRange 가 true 일 때만 쓰는 범위 */
  moveRangeRange?: StatRange
  /** 직사·대각·범위 = range, 곡사 = maxRange 를 대체 */
  attackRangeRange?: StatRange
  effects?: readonly EffectDef[]
}

/** 보유 유닛 개체 (나중에 DB 행 하나) */
export interface UnitInstance {
  id: string
  champId: string
  stats: Stats
  /** 길이 = 챔프 specialSlots */
  specials: Special[]
  /** epoch ms. 엔진은 시계를 읽지 않으며 호출부가 넘겨줌 */
  createdAt: number
  rerollCount: number
  /** rerollMovementAndRange 일 때만 존재 */
  moveRangeOverride?: number
  attackRangeOverride?: number
}

export type UnitId = string

/** 판 위의 유닛 상태 */
export interface UnitState {
  id: UnitId
  owner: Side
  instance: UnitInstance
  pos: Pos
  hp: number
  /** 남은 보호막 (매치 시작 시 채우고 다시 차지 않음) */
  shield: number
  /** 이번 턴 회복한 양 (턴당 상한 계산용, 턴 시작 시 0) */
  healedThisTurn: number
  alive: boolean
}

// ───────────── 행동 ─────────────

export type Aim = { kind: 'dir'; dir: Dir } | { kind: 'cell'; pos: Pos }

export type Action =
  | { type: 'move'; unit: UnitId; to: Pos }
  | { type: 'attack'; unit: UnitId; aim: Aim }
  | { type: 'wait' }

/** 길이 = config.actionsPerTurn */
export type TurnPlan = readonly Action[]

export type Deployment = readonly Pos[] // team 인덱스 순서대로 위치

// ───────────── 상태 ─────────────

export type Phase = 'deploy' | 'plan' | 'over'

export type GameResult = { winner: Side | 'draw'; reason: 'annihilation' | 'maxTurns' }

export interface GameState {
  config: GameConfig
  /** 엔진이 참조할 챔프 원본 (서버에서도 같은 데이터로 판정) */
  catalog: Readonly<Record<string, ChampTemplate>>
  phase: Phase
  /** 1부터 시작. resolveTurn 이 끝날 때 증가 */
  turn: number
  teams: Record<Side, readonly UnitInstance[]>
  units: Record<UnitId, UnitState>
  result: GameResult | null
}

// ───────────── 이벤트 로그 ─────────────

export type FizzleReason = 'unitDead' | 'invalidMove' | 'invalidAim' | 'notOwner'

export type MoveBlockReason = 'occupied' | 'collision'

/** 피해 처리 ①~⑥ 각 단계 결과 */
export interface HitRecord {
  attacker: UnitId
  target: UnitId
  /** 직사·대각 관통 순번 (0 = 첫 대상) */
  pierceIndex: number
  /** ① 공격력 기반 피해 (범위 비율·관통 감쇠·효과 반영) */
  base: number
  /** ② 방어력 감소 후 (최소 1) */
  afterArmor: number
  /** ③ 보호막 흡수량 */
  absorbed: number
  /** ④ 체력 감소량 */
  hpDamage: number
  /** ⑤ 반사 (없으면 null). 공격자 방어력 무시, 공격자 보호막은 흡수 */
  reflect: { amount: number; absorbed: number; hpDamage: number } | null
  /** ⑥ 공격 시 회복으로 실제 회복한 양 (상한·서든데스 적용 후) */
  lifesteal: number
  effects: string[]
}

export type HealSource = 'lifesteal' | 'regen'

export type StepEvent =
  | { type: 'fizzle'; side: Side; action: Action; reason: FizzleReason }
  | { type: 'wait'; side: Side }
  | { type: 'move'; side: Side; unit: UnitId; from: Pos; to: Pos }
  | { type: 'moveBlocked'; side: Side; unit: UnitId; from: Pos; to: Pos; reason: MoveBlockReason }
  | {
      type: 'attack'
      side: Side
      unit: UnitId
      aim: Aim
      /** 궤적이 지나간 칸 (애니메이션용) */
      path: Pos[]
      /** 피해 판정 대상 칸 */
      impactCells: Pos[]
      /** 직사·대각이 아군에게 막힌 경우 */
      blockedBy: UnitId | null
      hits: HitRecord[]
    }
  | { type: 'damage'; unit: UnitId; amount: number; hpBefore: number; hpAfter: number }
  | { type: 'heal'; unit: UnitId; source: HealSource; amount: number; hpBefore: number; hpAfter: number }
  | { type: 'zoneDamage'; unit: UnitId; amount: number; hpBefore: number; hpAfter: number }
  | { type: 'death'; unit: UnitId }
  | { type: 'gameOver'; result: GameResult }

export interface StepLog {
  /** 1부터 */
  step: number
  events: StepEvent[]
  /** 스텝 종료 후 유닛 스냅샷 (재생용) */
  unitsAfter: Record<UnitId, UnitState>
}

export interface TurnLog {
  turn: number
  plans: Record<Side, TurnPlan>
  steps: StepLog[]
  /** 턴 끝 이벤트 (자체 회복, 위험지대 피해, 사망, 승패) */
  endEvents: StepEvent[]
  /** 턴 끝 처리 후 유닛 스냅샷 */
  unitsAfter: Record<UnitId, UnitState>
}
