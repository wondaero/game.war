import { abilityValue } from './abilities.ts'
import { BP, type V2Config } from './config.ts'
import type { Pos, Side, UnitId, UnitState } from './types.ts'

export const DIRS: readonly Pos[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
]

export const posEq = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y
export const posKey = (p: Pos) => `${p.x},${p.y}`
export const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
export const opponent = (s: Side): Side => (s === 'A' ? 'B' : 'A')

export function inBounds(cfg: V2Config, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < cfg.boardWidth && p.y < cfg.boardHeight
}

/** B = 위쪽 zoneRows 줄, A = 아래쪽 zoneRows 줄 */
export function inZone(cfg: V2Config, side: Side, p: Pos): boolean {
  if (!inBounds(cfg, p)) return false
  return side === 'B' ? p.y < cfg.zoneRows : p.y >= cfg.boardHeight - cfg.zoneRows
}

export function zoneCells(cfg: V2Config, side: Side): Pos[] {
  const out: Pos[] = []
  for (let y = 0; y < cfg.boardHeight; y++)
    for (let x = 0; x < cfg.boardWidth; x++) if (inZone(cfg, side, { x, y })) out.push({ x, y })
  return out
}

/** 중심 기준 3×3 (판 안만) */
export function square3(cfg: V2Config, c: Pos): Pos[] {
  const out: Pos[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const p = { x: c.x + dx, y: c.y + dy }
      if (inBounds(cfg, p)) out.push(p)
    }
  return out
}

export function unitAt(units: Record<UnitId, UnitState>, p: Pos, exceptId?: UnitId): UnitState | undefined {
  for (const u of Object.values(units)) if (u.alive && u.id !== exceptId && posEq(u.pos, p)) return u
  return undefined
}

export function aliveOf(units: Record<UnitId, UnitState>, side?: Side): UnitState[] {
  return Object.values(units)
    .filter((u) => u.alive && (side === undefined || u.owner === side))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ───────────── 실제 능력치 (버프·도핑·이동수 제어 반영) ─────────────

const buffSum = (u: UnitState, stat: 'atk' | 'armor' | 'move' | 'hp', turn: number) =>
  u.buffs.reduce((s, b) => s + (b.stat === stat && b.untilTurn >= turn ? b.amount : 0), 0)

export function effAtk(u: UnitState, turn: number): number {
  const raw = u.inst.stats.atk + buffSum(u, 'atk', turn)
  const dope = abilityValue(u.inst, 'doping')
  return dope ? Math.floor((raw * dope) / BP) : raw
}
export const effArmor = (u: UnitState, turn: number) => u.inst.stats.armor + buffSum(u, 'armor', turn)
export const maxHp = (u: UnitState, turn: number) => u.inst.stats.hp + buffSum(u, 'hp', turn)
export const effMove = (u: UnitState, turn: number) =>
  Math.max(0, u.inst.stats.move + buffSum(u, 'move', turn) - (u.slowTurn === turn ? 1 : 0))
export const effRange = (u: UnitState) => u.inst.stats.range

// ───────────── 이동 (아군 건너뛰기) ─────────────

/** 1칸 이동: 각 방향으로 아군을 건너뛴 첫 빈칸 (내 진영 안) */
export function stepTargets(cfg: V2Config, units: Record<UnitId, UnitState>, u: UnitState, from: Pos): Pos[] {
  const out: Pos[] = []
  for (const d of DIRS) {
    let p = { x: from.x + d.x, y: from.y + d.y }
    while (inZone(cfg, u.owner, p) && unitAt(units, p, u.id)) p = { x: p.x + d.x, y: p.y + d.y }
    if (inZone(cfg, u.owner, p)) out.push(p)
  }
  return out
}

/** 이동력 이하로 도착 가능한 칸 (제자리 제외) */
export function reachable(cfg: V2Config, units: Record<UnitId, UnitState>, u: UnitState, moveRange: number): Pos[] {
  const seen = new Map<string, Pos>()
  let frontier: Pos[] = [u.pos]
  for (let i = 0; i < moveRange; i++) {
    const next: Pos[] = []
    for (const f of frontier)
      for (const p of stepTargets(cfg, units, u, f)) {
        const k = posKey(p)
        if (!seen.has(k)) {
          seen.set(k, p)
          next.push(p)
        }
      }
    frontier = next
  }
  seen.delete(posKey(u.pos))
  return [...seen.values()]
}

// ───────────── 위험지대 ─────────────

export function dangerDepth(cfg: V2Config, turn: number): number {
  if (cfg.dangerZoneStartTurn <= 0 || turn < cfg.dangerZoneStartTurn) return 0
  const grown = 1 + Math.floor((turn - cfg.dangerZoneStartTurn) / cfg.dangerZoneGrowEveryTurns)
  return Math.min(cfg.dangerZoneMaxDepth, grown)
}

export function isDangerCell(cfg: V2Config, turn: number, side: Side, p: Pos): boolean {
  const d = dangerDepth(cfg, turn)
  if (d === 0) return false
  return side === 'A' ? p.y >= cfg.boardHeight - d : p.y < d
}
