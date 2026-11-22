import { addPos, comparePos, DIAG_DIRS, DIR_VECTORS, inBounds, manhattan, ORTHO_DIRS, unitAt } from './board.ts'
import type { GameConfig } from './config.ts'
import type { Aim, Pos, Trajectory, UnitId, UnitState } from './types.ts'

export interface AttackGeometry {
  /** 궤적이 지나간 칸 (애니메이션용) */
  path: Pos[]
  /** 피해 판정 칸 */
  impactCells: Pos[]
  /** 맞는 적 유닛 (결정적 순서: 좌표 y → x) */
  targets: UnitId[]
  /** 직사·대각이 아군에게 막혔을 때 그 아군 */
  blockedBy: UnitId | null
}

/** 조준이 궤적 규칙상 유효한지 (판 상태와 무관한 기하 조건) */
export function isAimValid(cfg: GameConfig, traj: Trajectory, from: Pos, aim: Aim): boolean {
  switch (traj.kind) {
    case 'straight':
      return aim.kind === 'dir' && (ORTHO_DIRS as readonly string[]).includes(aim.dir)
    case 'diagonal':
      return aim.kind === 'dir' && (DIAG_DIRS as readonly string[]).includes(aim.dir)
    case 'lob': {
      if (aim.kind !== 'cell' || !inBounds(cfg, aim.pos)) return false
      const d = manhattan(from, aim.pos)
      return d >= traj.minRange && d <= traj.maxRange
    }
    case 'area':
      return aim.kind === 'cell' && inBounds(cfg, aim.pos) && manhattan(from, aim.pos) <= traj.range
  }
}

/** 해당 궤적으로 가능한 모든 조준 */
export function allAims(cfg: GameConfig, traj: Trajectory, from: Pos): Aim[] {
  switch (traj.kind) {
    case 'straight':
      return ORTHO_DIRS.map((dir) => ({ kind: 'dir', dir }))
    case 'diagonal':
      return DIAG_DIRS.map((dir) => ({ kind: 'dir', dir }))
    case 'lob':
    case 'area': {
      const aims: Aim[] = []
      for (let y = 0; y < cfg.boardHeight; y++)
        for (let x = 0; x < cfg.boardWidth; x++) {
          const aim: Aim = { kind: 'cell', pos: { x, y } }
          if (isAimValid(cfg, traj, from, aim)) aims.push(aim)
        }
      return aims
    }
  }
}

/**
 * 현재 판 상태에서 공격이 어디에 맞는지 계산. 조준이 무효면 null.
 * - 직사·대각: 사선의 적을 순서대로 맞힘 (관통). 관통 감쇠가 0이면 첫 적에서 멈춤.
 *   아군을 만나면 거기서 멈춤 (아군 피해 없음)
 * - 곡사: 사이 칸 무시, 목표 칸의 적에게 명중
 * - 범위: 중심 + 모양 칸 안의 모든 적에게 명중 (아군 피해 없음)
 */
export function computeAttack(
  cfg: GameConfig,
  units: Record<UnitId, UnitState>,
  attacker: UnitState,
  traj: Trajectory,
  aim: Aim,
): AttackGeometry | null {
  if (!isAimValid(cfg, traj, attacker.pos, aim)) return null
  const isEnemy = (u: UnitState) => u.owner !== attacker.owner

  switch (traj.kind) {
    case 'straight':
    case 'diagonal': {
      if (aim.kind !== 'dir') return null
      const v = DIR_VECTORS[aim.dir]
      const pierce = lineFalloffBp(cfg, traj) > 0
      const path: Pos[] = []
      const impactCells: Pos[] = []
      const targets: UnitId[] = []
      let cur = attacker.pos
      for (let i = 0; i < traj.range; i++) {
        cur = addPos(cur, v)
        if (!inBounds(cfg, cur)) break
        path.push(cur)
        const u = unitAt(units, cur)
        if (!u) continue
        if (!isEnemy(u)) return { path, impactCells, targets, blockedBy: u.id }
        targets.push(u.id)
        impactCells.push(cur)
        if (!pierce) break
      }
      return { path, impactCells, targets, blockedBy: null }
    }
    case 'lob': {
      if (aim.kind !== 'cell') return null
      const u = unitAt(units, aim.pos)
      return {
        path: [aim.pos],
        impactCells: [aim.pos],
        targets: u && isEnemy(u) ? [u.id] : [],
        blockedBy: null,
      }
    }
    case 'area': {
      if (aim.kind !== 'cell') return null
      const cells = traj.shape
        .map((o) => addPos(aim.pos, o))
        .filter((p) => inBounds(cfg, p))
        .sort(comparePos)
      const targets: UnitId[] = []
      for (const c of cells) {
        const u = unitAt(units, c)
        if (u && isEnemy(u)) targets.push(u.id)
      }
      return { path: [aim.pos], impactCells: cells, targets, blockedBy: null }
    }
  }
}

/** 직사·대각 관통 시 뒤 대상마다 곱해지는 피해 비율 (0 = 관통 없음). 챔프 값 > config 기본값 */
export function lineFalloffBp(cfg: GameConfig, traj: Trajectory): number {
  if (traj.kind !== 'straight' && traj.kind !== 'diagonal') return 0
  return traj.falloffBp ?? cfg.lineFalloffBp
}
