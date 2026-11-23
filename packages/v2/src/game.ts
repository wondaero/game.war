import { Rng, createRngState, type RngState } from '@war/engine'
import { ABILITIES, ABILITY_KINDS } from './abilities.ts'
import { inZone, posEq } from './board.ts'
import { makeV2Config, type V2Config } from './config.ts'
import type { Ability, GameState, Pos, Side, Stats, UnitId, UnitInstance, UnitState } from './types.ts'
import { SIDES, STAT_KEYS } from './types.ts'
import { EngineError } from './validate.ts'

/** 그림 8종 (성능 무관). 이름은 임시 */
export const IMAGES = ['img1', 'img2', 'img3', 'img4', 'img5', 'img6', 'img7', 'img8'] as const

export function validateTeam(cfg: V2Config, team: readonly UnitInstance[]): string[] {
  const errors: string[] = []
  if (team.length !== cfg.cardsPerSide) errors.push(`team must have ${cfg.cardsPerSide} units`)
  const images = new Set<string>()
  for (const u of team) {
    if (images.has(u.image)) errors.push(`duplicate image ${u.image}`)
    images.add(u.image)
    for (const k of STAT_KEYS) {
      const r = cfg.statRanges[k]
      if (u.stats[k] < r.min || u.stats[k] > r.max) errors.push(`${u.id}: ${k} out of range`)
    }
    if (u.ability && ABILITIES[u.ability.kind].tiers[u.ability.tier] === undefined) errors.push(`${u.id}: bad ability tier`)
  }
  return errors
}

export function createGame(teams: Record<Side, readonly UnitInstance[]>, config: Partial<V2Config> = {}): GameState {
  const cfg = makeV2Config(config)
  for (const side of SIDES) {
    const errors = validateTeam(cfg, teams[side])
    if (errors.length) throw new EngineError(`Invalid team ${side}`, errors)
  }
  return { config: cfg, phase: 'deploy', turn: 1, teams: { A: [...teams.A], B: [...teams.B] }, units: {}, result: null }
}

export const unitIdFor = (side: Side, i: number): UnitId => `${side}${i}`

export function spawnUnit(id: UnitId, owner: Side, inst: UnitInstance, pos: Pos): UnitState {
  return {
    id,
    owner,
    inst,
    pos: { ...pos },
    hp: inst.stats.hp,
    alive: true,
    buffs: [],
    poison: [],
    nullified: false,
    slowTurn: 0,
    readyTurn: 0,
    moveRegenTurn: 0,
    passiveHealTurn: 0,
    passiveHealed: 0,
  }
}

/** 동시 배치 */
export function deploy(state: GameState, deployments: Record<Side, readonly Pos[]>): GameState {
  if (state.phase !== 'deploy') throw new EngineError(`Cannot deploy in phase ${state.phase}`)
  const units: Record<UnitId, UnitState> = {}
  for (const side of SIDES) {
    const dep = deployments[side]
    if (dep.length !== state.teams[side].length) throw new EngineError(`deployment size mismatch ${side}`)
    dep.forEach((p, i) => {
      if (!inZone(state.config, side, p)) throw new EngineError(`${side}${i}: must be in own zone`)
      if (dep.findIndex((q) => posEq(p, q)) !== i) throw new EngineError(`${side}${i}: duplicate cell`)
      units[unitIdFor(side, i)] = spawnUnit(unitIdFor(side, i), side, state.teams[side][i]!, p)
    })
  }
  return { ...state, units, phase: 'plan' }
}

// ───────────── 뽑기 (개체 생성) ─────────────

/**
 * 능력치는 범위 안 균등, 특수능력은 abilityChanceBp 확률로 1개 (종류 균등 → 등급 균등).
 * 그림은 8종 균등.
 */
export function rollUnit(cfg: V2Config, rng: Rng, id: string, image?: string): UnitInstance {
  const stats = {} as Stats
  for (const k of STAT_KEYS) stats[k] = rng.range(cfg.statRanges[k].min, cfg.statRanges[k].max)
  let ability: Ability | null = null
  if (rng.int(10_000) < cfg.abilityChanceBp) {
    const kind = ABILITY_KINDS[rng.int(ABILITY_KINDS.length)]!
    ability = { kind, tier: rng.int(ABILITIES[kind].tiers.length) }
  }
  return { id, image: image ?? IMAGES[rng.int(IMAGES.length)]!, stats, ability }
}

/** 그림이 겹치지 않는 무작위 덱 */
export function randomDeck(cfg: V2Config, seed: number | string | RngState): UnitInstance[] {
  const rng = new Rng(typeof seed === 'object' ? seed : createRngState(seed))
  const pool: string[] = [...IMAGES]
  const out: UnitInstance[] = []
  for (let i = 0; i < cfg.cardsPerSide; i++) {
    const img = pool.splice(rng.int(pool.length), 1)[0]!
    out.push(rollUnit(cfg, rng, `u${i}`, img))
  }
  return out
}
