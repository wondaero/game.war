import { catalogById } from './cards/catalog.ts'
import { makeConfig, type GameConfig } from './config.ts'
import type { ChampTemplate, Deployment, GameState, Side, UnitId, UnitInstance, UnitState } from './types.ts'
import { SIDES } from './types.ts'
import { spawnUnit } from './units.ts'
import { EngineError, validateDeployment, validateTeam } from './validate.ts'

export interface CreateGameInput {
  /** 실제 보유 개체 능력치 그대로 투입 */
  teams: Record<Side, readonly UnitInstance[]>
  config?: Partial<GameConfig>
  catalog?: readonly ChampTemplate[]
}

export function createGame(input: CreateGameInput): GameState {
  const config = makeConfig(input.config)
  const catalog = catalogById(input.catalog)
  for (const side of SIDES) {
    const v = validateTeam(config, catalog, input.teams[side])
    if (!v.ok) throw new EngineError(`Invalid team ${side}`, v.errors)
  }
  return {
    config,
    catalog,
    phase: 'deploy',
    turn: 1,
    teams: { A: [...input.teams.A], B: [...input.teams.B] },
    units: {},
    result: null,
  }
}

export const unitIdFor = (side: Side, index: number): UnitId => `${side}${index}`

/** 동시 배치: 양쪽 배치를 함께 받아 공개 */
export function deploy(state: GameState, deployments: Record<Side, Deployment>): GameState {
  if (state.phase !== 'deploy') throw new EngineError(`Cannot deploy in phase ${state.phase}`)
  const units: Record<UnitId, UnitState> = {}
  for (const side of SIDES) {
    const dep = deployments[side]
    const v = validateDeployment(state, side, dep)
    if (!v.ok) throw new EngineError(`Invalid deployment ${side}`, v.errors)
    state.teams[side].forEach((inst, i) => {
      const id = unitIdFor(side, i)
      units[id] = spawnUnit(id, side, inst, dep[i]!)
    })
  }
  return { ...state, units, phase: 'plan' }
}
