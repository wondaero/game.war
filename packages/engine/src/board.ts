import type { GameConfig } from './config.ts'
import type { Dir, GameState, Pos, Side, UnitState } from './types.ts'

export type Zone = Side | 'neutral'

export const DIR_VECTORS: Readonly<Record<Dir, Pos>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upLeft: { x: -1, y: -1 },
  upRight: { x: 1, y: -1 },
  downLeft: { x: -1, y: 1 },
  downRight: { x: 1, y: 1 },
}
export const ORTHO_DIRS = ['up', 'down', 'left', 'right'] as const
export const DIAG_DIRS = ['upLeft', 'upRight', 'downLeft', 'downRight'] as const

export const posEq = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y
export const posKey = (p: Pos) => `${p.x},${p.y}`
export const addPos = (a: Pos, b: Pos): Pos => ({ x: a.x + b.x, y: a.y + b.y })
export const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

export function inBounds(cfg: GameConfig, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < cfg.boardWidth && p.y < cfg.boardHeight
}

/** B = 위쪽 zoneRows 줄, A = 아래쪽 zoneRows 줄 */
export function zoneOf(cfg: GameConfig, p: Pos): Zone {
  if (p.y < cfg.zoneRows) return 'B'
  if (p.y >= cfg.boardHeight - cfg.zoneRows) return 'A'
  return 'neutral'
}

export function canStandOn(cfg: GameConfig, side: Side, p: Pos): boolean {
  if (!inBounds(cfg, p)) return false
  const z = zoneOf(cfg, p)
  if (z === side) return true
  if (z === 'neutral') return cfg.moveAllowNeutral
  return cfg.moveAllowEnemyZone
}

export function zoneCells(cfg: GameConfig, side: Side): Pos[] {
  const cells: Pos[] = []
  for (let y = 0; y < cfg.boardHeight; y++)
    for (let x = 0; x < cfg.boardWidth; x++) if (zoneOf(cfg, { x, y }) === side) cells.push({ x, y })
  return cells
}

export function opponent(side: Side): Side {
  return side === 'A' ? 'B' : 'A'
}

export function aliveUnits(state: GameState, side?: Side): UnitState[] {
  return Object.values(state.units)
    .filter((u) => u.alive && (side === undefined || u.owner === side))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function unitAt(units: Record<string, UnitState>, p: Pos): UnitState | undefined {
  for (const u of Object.values(units)) if (u.alive && posEq(u.pos, p)) return u
  return undefined
}

/**
 * 해당 턴 끝에 위험지대인 줄 수 (각 진영 맨 뒷줄부터). 0 = 없음
 */
export function dangerDepth(cfg: GameConfig, turn: number): number {
  if (cfg.dangerZoneStartTurn <= 0 || turn < cfg.dangerZoneStartTurn) return 0
  const grown = 1 + Math.floor((turn - cfg.dangerZoneStartTurn) / cfg.dangerZoneGrowEveryTurns)
  return Math.min(cfg.dangerZoneMaxDepth, grown)
}

/** side 유닛에게 p 가 해당 턴 끝에 위험지대인지 (자기 진영 뒷줄 기준) */
export function isDangerCell(cfg: GameConfig, turn: number, side: Side, p: Pos): boolean {
  const d = dangerDepth(cfg, turn)
  if (d === 0) return false
  return side === 'A' ? p.y >= cfg.boardHeight - d : p.y < d
}

/** 좌표 정렬 (결정적 처리 순서용): y → x */
export function comparePos(a: Pos, b: Pos): number {
  return a.y - b.y || a.x - b.x
}
