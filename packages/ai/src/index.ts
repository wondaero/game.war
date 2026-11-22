import {
  aliveUnits,
  attackPreviews,
  cloneUnits,
  applyBp,
  canRepeatActions,
  isDangerCell,
  champOf,
  computeAttack,
  trajectoryOf,
  createRngState,
  hitOdds,
  legalMoves,
  opponent,
  padPlan,
  posEq,
  Rng,
  threatMap,
  validatePlan,
  zoneCells,
  type Action,
  type UnitInstance,
  type GachaContext,
  type RngState,
  createUnit,
  type Deployment,
  type GameState,
  type PlayerController,
  type Pos,
  type Side,
  type TurnPlan,
  type UnitId,
  type UnitState,
} from '@war/engine'

/**
 * 규칙 기반 AI.
 * - 공격: 기대 피해가 크고 체력이 낮은 카드 우선, 처치 가능하면 큰 가산점.
 *   상대의 회피 이동 가능성을 확률로 반영 (hitProbability)
 * - 이동: 위치 가치(공격 가치 − 받는 위협)가 오르는 칸으로. 위협받는 카드는 회피, 대상 없는 카드는 접근
 * - 행동 칸마다 탐욕적으로 최고 점수 선택 (내 이동은 다음 칸 평가에 반영)
 */
export interface AiWeights {
  killBonus: number
  lowHpBias: number
  reflectPenalty: number
  dodge: number
  approach: number
  /** 상대가 제자리에 있을 확률 가정 */
  stayProb: number
  /** 위험지대 회피 가중치 */
  zone: number
}

export const DEFAULT_WEIGHTS: AiWeights = {
  killBonus: 8,
  lowHpBias: 1,
  reflectPenalty: 1,
  dodge: 0.25,
  approach: 1,
  stayProb: 0.7,
  zone: 1.5,
}

interface Candidate {
  action: Action
  score: number
  /** 공격 시 대상별 기대 피해 (중복 집중 방지용) */
  expected?: Map<UnitId, number>
  moveTo?: Pos
}

export function planTurn(state: GameState, side: Side, seed: number | string = 0, w = DEFAULT_WEIGHTS): TurnPlan {
  const cfg = state.config
  const rng = new Rng(createRngState(`${seed}:${state.turn}:${side}`))
  const jitter = () => rng.int(1000) / 100000 // 동점 깨기 (결정적)

  // 시뮬레이션용 사본: 내 이동은 반영, 기대 피해는 가상 체력으로 차감
  const units = cloneUnits(state.units)
  const sim: GameState = { ...state, units }
  const virtualHp = new Map<UnitId, number>(Object.values(units).map((u) => [u.id, u.hp]))
  const used = new Set<UnitId>()
  let attacksLeft = cfg.maxAttacksPerTurn
  const actions: Action[] = []
  const repeatOk = canRepeatActions(state, side)

  for (let slot = 0; slot < cfg.actionsPerTurn; slot++) {
    const threat = threatMap(sim, side, units)
    const candidates: Candidate[] = []

    for (const u of aliveUnits(sim, side)) {
      if (used.has(u.id) && !repeatOk) continue
      if (attacksLeft > 0) candidates.push(...attackCandidates(sim, u, virtualHp, w))
      candidates.push(...moveCandidates(sim, side, u, threat, w))
    }

    for (const c of candidates) c.score += jitter()
    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0]
    if (!best || best.score <= 0.05) {
      actions.push({ type: 'wait' })
      continue
    }

    actions.push(best.action)
    if (best.action.type !== 'wait') used.add(best.action.unit)
    if (best.action.type === 'attack') {
      attacksLeft--
      for (const [id, e] of best.expected ?? []) virtualHp.set(id, (virtualHp.get(id) ?? 0) - e)
    } else if (best.action.type === 'move' && best.moveTo) {
      units[best.action.unit]!.pos = { ...best.moveTo }
    }
  }

  const out = padPlan(actions, cfg.actionsPerTurn)
  // 안전장치: 시뮬레이션 오차로 무효 입력이 나오면 전부 대기
  return validatePlan(state, side, out).ok ? out : padPlan([], cfg.actionsPerTurn)
}

/**
 * 상대가 이번 스텝 전에 움직일 수 있으므로, 조준마다 각 적의 "예상 위치 분포"에 대해 명중 확률을 구한다.
 * 분포: 제자리 stayProb, 나머지는 이동 가능한 칸에 균등.
 * → 회피하는 적에게는 범위·곡사(빈 칸 조준 포함)가 자연스럽게 높게 평가된다.
 */
function hitProbability(sim: GameState, u: UnitState, aim: Action & { type: 'attack' }, enemy: UnitState, w: AiWeights): number {
  const traj = trajectoryOf(champOf(sim, u), u.instance)
  const origin = enemy.pos
  const moves = legalMoves(sim, enemy.id)
  const options: Array<[Pos, number]> = [[origin, moves.length ? w.stayProb : 1]]
  for (const m of moves) options.push([m, (1 - w.stayProb) / moves.length])
  let p = 0
  for (const [pos, weight] of options) {
    enemy.pos = pos
    const g = computeAttack(sim.config, sim.units, u, traj, aim.aim)
    if (g?.targets.includes(enemy.id)) p += weight
  }
  enemy.pos = origin
  return p
}

function attackCandidates(
  sim: GameState,
  u: UnitState,
  virtualHp: Map<UnitId, number>,
  w: AiWeights,
): Candidate[] {
  const out: Candidate[] = []
  const enemies = aliveUnits(sim, opponent(u.owner))
  for (const p of attackPreviews(sim, u.id, sim.units)) {
    const action = { type: 'attack' as const, unit: u.id, aim: p.aim }
    let score = 0
    const expected = new Map<UnitId, number>()
    for (const t of enemies) {
      const hp = Math.max(0, virtualHp.get(t.id) ?? t.hp)
      if (hp <= 0) continue // 이미 처치 예상 → 낭비
      const ph = hitProbability(sim, u, action, t, w)
      if (ph <= 0) continue
      const odds = hitOdds(sim, u, t, Math.max(0, p.geometry.targets.indexOf(t.id)))
      const eff = Math.min(odds.hpDamage, hp) * ph
      score += eff * (1 + w.lowHpBias * (1 - hp / t.instance.stats.hp))
      if (odds.hpDamage >= hp) score += w.killBonus * ph
      score -= odds.reflected * ph * w.reflectPenalty
      expected.set(t.id, odds.hpDamage * ph)
    }
    if (score > 0) out.push({ action, score, expected })
  }
  return out
}

/** 해당 위치에서 낼 수 있는 최선의 공격 가치 (다음 행동·다음 턴 기준) */
function offenseAt(sim: GameState, u: UnitState, w: AiWeights): number {
  let best = 0
  for (const p of attackPreviews(sim, u.id, sim.units)) {
    let v = 0
    for (const [i, tid] of p.geometry.targets.entries()) {
      const t = sim.units[tid]!
      const odds = hitOdds(sim, u, t, i)
      v += odds.hpDamage * (1 + w.lowHpBias * (1 - t.hp / t.instance.stats.hp)) - odds.reflected
    }
    best = Math.max(best, v)
  }
  return best
}

/**
 * 위치 가치 = 공격 가치 × approach − 받는 위협 × dodge × (체력 낮을수록 가중)
 * 이동 점수 = 새 위치 가치 − 현재 위치 가치
 */
function moveCandidates(
  sim: GameState,
  side: Side,
  u: UnitState,
  threat: Map<UnitId, number>,
  w: AiWeights,
): Candidate[] {
  const out: Candidate[] = []
  const fragility = 1 + (1 - u.hp / u.instance.stats.hp)
  // 위험지대: 이번 턴 끝 피해는 전액, 다음 턴에 위험해질 칸은 절반으로 미리 피함
  const cfg = sim.config
  const zoneHit = Math.max(1, applyBp(u.instance.stats.hp, cfg.dangerZoneDamageBp))
  const zonePenalty = () =>
    (isDangerCell(cfg, sim.turn, u.owner, u.pos) ? zoneHit : isDangerCell(cfg, sim.turn + 1, u.owner, u.pos) ? zoneHit / 2 : 0) *
    w.zone *
    fragility
  const value = (th: number) => offenseAt(sim, u, w) * w.approach - th * w.dodge * fragility - zonePenalty()
  const here = value(threat.get(u.id) ?? 0)
  const origin = { ...u.pos }

  for (const to of legalMoves(sim, u.id)) {
    u.pos = to // 임시 이동 후 평가
    const score = value(threatMap(sim, side, sim.units).get(u.id) ?? 0) - here
    u.pos = origin
    if (score > 0) out.push({ action: { type: 'move', unit: u.id, to }, score, moveTo: to })
  }
  return out
}

/** 배치: 방어 특화는 앞줄(중립 쪽), 나머지는 뒷줄. 칸 선택은 시드 기반 */
export function planDeployment(state: GameState, side: Side, team: readonly UnitInstance[], seed: number | string = 0): Deployment {
  const cfg = state.config
  const rng = new Rng(createRngState(`${seed}:deploy:${side}`))
  const cells = zoneCells(cfg, side)
  const frontY = side === 'A' ? cfg.boardHeight - cfg.zoneRows : cfg.zoneRows - 1
  const front = cells.filter((c) => c.y === frontY)
  const back = cells.filter((c) => c.y !== frontY)
  const taken: Pos[] = []
  const pick = (pool: Pos[]): Pos => {
    const free = pool.filter((p) => !taken.some((t) => posEq(t, p)))
    const all = free.length ? free : cells.filter((p) => !taken.some((t) => posEq(t, p)))
    const p = all[rng.int(all.length)]!
    taken.push(p)
    return p
  }
  return team.map((inst) => {
    const role = state.catalog[inst.champId]!.role
    return pick(role === 'defense' ? front : back)
  })
}

export class RuleAIController implements PlayerController {
  constructor(
    readonly side: Side,
    private readonly seed: number | string = 0,
    private readonly weights: AiWeights = DEFAULT_WEIGHTS,
  ) {}

  async chooseDeployment(state: GameState, team: readonly UnitInstance[]): Promise<Deployment> {
    return planDeployment(state, this.side, team, this.seed)
  }

  async chooseTurnPlan(state: GameState): Promise<TurnPlan> {
    return planTurn(state, this.side, this.seed, this.weights)
  }
}


/**
 * AI 덱: 플레이어와 같은 개체 생성 로직(createUnit)으로 만든다.
 * 서로 다른 챔프 cardsPerSide 장을 시드로 고른다.
 */
export function buildAiDeck(ctx: GachaContext, seed: number | string, now = 0): UnitInstance[] {
  const pickRng = new Rng(createRngState(`${seed}:aideck`))
  const pool = Object.keys(ctx.catalog).sort()
  const ids: string[] = []
  while (ids.length < ctx.config.cardsPerSide && pool.length) ids.push(pool.splice(pickRng.int(pool.length), 1)[0]!)
  let rng: RngState = createRngState(`${seed}:aiunits`)
  return ids.map((id) => {
    const r = createUnit(ctx, id, rng, now)
    rng = r.rng
    return r.unit
  })
}
