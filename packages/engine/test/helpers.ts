import { makeConfig, type GameConfig } from '../src/config.ts'
import { catalogById } from '../src/cards/catalog.ts'
import type {
  Action,
  ChampTemplate,
  Dir,
  GameState,
  Pos,
  Role,
  Side,
  Special,
  Stats,
  Trajectory,
  TurnPlan,
  UnitId,
  UnitInstance,
  UnitState,
} from '../src/types.ts'
import { spawnUnit } from '../src/units.ts'

export interface TmplOpts {
  role?: Role
  base?: Partial<Stats>
  trajectory?: Trajectory
  moveRange?: number
  slots?: number
  rarity?: string
}

/** 테스트용 챔프: 능력치 범위 = base 고정값 */
export function tmpl(id: string, opts: TmplOpts = {}): ChampTemplate {
  const s: Stats = { hp: 10, atk: 3, armor: 0, ...opts.base }
  return {
    id,
    name: id,
    role: opts.role ?? 'attack',
    rarity: opts.rarity ?? 'R',
    trajectory: opts.trajectory ?? { kind: 'straight', range: 4 },
    moveRange: opts.moveRange ?? 1,
    specialSlots: opts.slots ?? 0,
    statRanges: {
      hp: { min: s.hp, max: s.hp },
      atk: { min: s.atk, max: s.atk },
      armor: { min: s.armor, max: s.armor },
    },
  }
}

export interface Placement {
  side: Side
  pos: Pos
  t: ChampTemplate
  specials?: Special[]
}

/**
 * 배치까지 끝난 'plan' 상태를 직접 구성.
 * 유닛 id = side + 해당 side 내 순번 (A0, A1, B0 ...)
 */
export function scenario(placements: Placement[], opts: { config?: Partial<GameConfig> } = {}): GameState {
  // 규칙 단위 테스트는 5×5(진영 2줄 + 중립 1줄) 좌표로 작성됨. 판 크기 자체는 board.test 에서 검증
  const config = makeConfig({ boardWidth: 5, boardHeight: 5, zoneRows: 2, allowDuplicateChamps: true, ...opts.config })
  const templates = new Map<string, ChampTemplate>()
  for (const p of placements) templates.set(p.t.id, p.t)
  const units: Record<UnitId, UnitState> = {}
  const teams: Record<Side, UnitInstance[]> = { A: [], B: [] }
  for (const p of placements) {
    const i = teams[p.side].length
    const r = p.t.statRanges
    const inst: UnitInstance = {
      id: `${p.side}-${i}`,
      champId: p.t.id,
      stats: { hp: r.hp.min, atk: r.atk.min, armor: r.armor.min },
      specials: p.specials ?? [],
      createdAt: 0,
      rerollCount: 0,
    }
    teams[p.side].push(inst)
    const id = `${p.side}${i}`
    units[id] = spawnUnit(id, p.side, inst, p.pos)
  }
  return {
    config,
    catalog: catalogById([...templates.values()]),
    phase: 'plan',
    turn: 1,
    teams,
    units,
    result: null,
  }
}

export const P = (x: number, y: number): Pos => ({ x, y })

export const move = (unit: UnitId, x: number, y: number): Action => ({ type: 'move', unit, to: { x, y } })
export const shoot = (unit: UnitId, dir: Dir): Action => ({ type: 'attack', unit, aim: { kind: 'dir', dir } })
export const lob = (unit: UnitId, x: number, y: number): Action => ({
  type: 'attack',
  unit,
  aim: { kind: 'cell', pos: { x, y } },
})
export const wait = (): Action => ({ type: 'wait' })

/** 길이가 모자라면 wait 으로 채움 */
export function plan(...actions: Action[]): TurnPlan {
  const out = [...actions]
  while (out.length < 3) out.push(wait())
  return out
}

export const idle = () => plan()

export const sp = (kind: Special['kind'], value: number): Special => ({ kind, value })
