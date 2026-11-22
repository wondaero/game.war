import type { ChampTemplate, GameState, Side, SpecialKind, Trajectory, UnitInstance, UnitState } from './types.ts'

/**
 * 챔프 원본 + 개체값 → 실제로 판에서 쓰는 값.
 * 이동거리·사거리는 기본적으로 챔프 고정이고, rerollMovementAndRange 일 때만 개체 덮어쓰기 값을 쓴다.
 */
export function champOf(state: Pick<GameState, 'catalog'>, unit: UnitState | UnitInstance): ChampTemplate {
  const inst = 'instance' in unit ? unit.instance : unit
  const c = state.catalog[inst.champId]
  if (!c) throw new Error(`Unknown champ ${inst.champId}`)
  return c
}

export function moveRangeOf(champ: ChampTemplate, inst: UnitInstance): number {
  return inst.moveRangeOverride ?? champ.moveRange
}

export function trajectoryOf(champ: ChampTemplate, inst: UnitInstance): Trajectory {
  const r = inst.attackRangeOverride
  if (r === undefined) return champ.trajectory
  const t = champ.trajectory
  return t.kind === 'lob' ? { ...t, maxRange: Math.max(t.minRange, r) } : { ...t, range: r }
}

/** 해당 특수능력 수치 (없으면 0). 같은 종류 중복은 생성 단계에서 금지됨 */
export function specialValue(inst: UnitInstance, kind: SpecialKind): number {
  return inst.specials.find((s) => s.kind === kind)?.value ?? 0
}

export const maxHpOf = (u: UnitState) => u.instance.stats.hp

/** 이번 턴 같은 카드가 여러 행동을 할 수 있는지 */
export function canRepeatActions(state: GameState, side: Side): boolean {
  const cfg = state.config
  if (cfg.allowSameCardMultiAction) return true
  if (cfg.multiActionWhenCardsAtMost <= 0) return false
  const alive = Object.values(state.units).filter((u) => u.owner === side && u.alive).length
  return alive <= cfg.multiActionWhenCardsAtMost
}

/** 판 위 유닛 상태 초기화 */
export function spawnUnit(id: string, owner: Side, inst: UnitInstance, pos: { x: number; y: number }): UnitState {
  return {
    id,
    owner,
    instance: inst,
    pos: { ...pos },
    hp: inst.stats.hp,
    shield: specialValue(inst, 'shield'),
    healedThisTurn: 0,
    alive: true,
  }
}
