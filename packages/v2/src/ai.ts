import { Rng, createRngState } from '@war/engine'
import { ABILITIES, abilityValue } from './abilities.ts'
import {
  aliveOf,
  effMove,
  effRange,
  inZone,
  isDangerCell,
  manhattan,
  maxHp,
  opponent,
  posEq,
  posKey,
  reachable,
  square3,
  unitAt,
  zoneCells,
} from './board.ts'
import { hitDamage, skillHealAmount } from './combat.ts'
import { applyBp } from './config.ts'
import type { Action, GameState, Pos, Side, TurnPlan, UnitId, UnitInstance, UnitState } from './types.ts'
import { actionError, actionsPerUnit, actsPerUnit, anyMovePossible, cloneUnits, fallbackPlan, validatePlan } from './validate.ts'
import { resolveTurn } from './resolve.ts'
import { asA } from './mirror.ts'

/**
 * 규칙 기반 AI (밸런스 시뮬레이션용).
 * - 상대 위치 예측: 각 적이 제자리 stay 확률, 나머지는 이동 가능한 칸에 균등
 * - 공격: 칸마다 (명중 확률 × 피해 가치) 합이 큰 곳. 처치·저체력·상태이상 가산
 * - 회복·버프: 회복량/버프량을 피해 가치와 같은 단위로 환산
 * - 이동: 지금 칸의 위협을 피하는 가치 + 사거리 안 적 수 변화 + 위험지대 회피
 * - 행동 칸마다 탐욕적으로 최고 점수. 최소 이동 규칙은 마지막에 강제
 */
export interface AiWeights {
  stay: number
  killBonus: number
  lowHpBias: number
  dodge: number
  approach: number
  zone: number
  nullify: number
  slow: number
  heal: number
  buff: number
  /** 이동을 앞쪽 행동으로 재배치 */
  moveFirst: boolean
}

export const DEFAULT_AI: AiWeights = {
  stay: 0.75,
  killBonus: 10,
  lowHpBias: 1,
  dodge: 0.35,
  approach: 0.4,
  zone: 1.5,
  nullify: 6,
  slow: 2,
  heal: 1,
  buff: 0.9,
  moveFirst: true,
}

interface Cand {
  action: Action
  score: number
  expected?: Map<UnitId, number>
}

export interface PlanOptions {
  /** 앞쪽 행동을 고정 (후보 계획 생성용) */
  prefix?: readonly Action[]
  /** 이 적은 노리지 않음 (후보 다양화) */
  avoid?: UnitId
}

/** 탐욕 계획: 행동 칸마다 최고 점수 하나 (혼합 전략 AI의 후보 생성기로도 사용) */
function planTurnImpl(
  state: GameState,
  side: Side,
  seed: number | string = 0,
  w: AiWeights = DEFAULT_AI,
  opts: PlanOptions = {},
): TurnPlan {
  const cfg = state.config
  const turn = state.turn
  const rng = new Rng(createRngState(`${seed}:${turn}:${side}`))
  const jitter = () => rng.int(1000) / 100000
  const units = cloneUnits(state.units)
  const enemySide = opponent(side)

  // 적 위치 분포 (턴 시작 기준)
  const where = new Map<UnitId, Map<string, number>>()
  for (const e of aliveOf(units, enemySide)) {
    const reach = reachable(cfg, units, e, effMove(e, turn))
    const m = new Map<string, number>()
    m.set(posKey(e.pos), reach.length ? w.stay : 1)
    for (const p of reach) m.set(posKey(p), (m.get(posKey(p)) ?? 0) + (1 - w.stay) / reach.length)
    where.set(e.id, m)
  }
  const pAt = (e: UnitId, cells: Pos[]) => cells.reduce((s, c) => s + (where.get(e)?.get(posKey(c)) ?? 0), 0)
  const virtualHp = new Map<UnitId, number>(Object.values(units).map((u) => [u.id, u.hp]))

  const cap = actionsPerUnit(state, side)
  const actCap = actsPerUnit(state, side)
  const unitActs = new Map<UnitId, number>()
  const mustMove = anyMovePossible(state, side)
  const used = new Map<UnitId, number>()
  let moves = 0
  let acts = 0
  const plan: Action[] = []

  for (let slot = 0; slot < cfg.actionsPerTurn; slot++) {
    const remaining = cfg.actionsPerTurn - slot
    const needMove = mustMove && moves < cfg.minMovesPerTurn && remaining <= cfg.minMovesPerTurn - moves
    const cands: Cand[] = []
    const fixed = opts.prefix?.[slot]
    if (fixed) cands.push({ action: fixed, score: 1e9 })
    else for (const u of aliveOf(units, side)) {
      if ((used.get(u.id) ?? 0) >= cap) continue
      if (!needMove) {
        if (acts < cfg.maxActsPerTurn && (unitActs.get(u.id) ?? 0) < actCap) {
          cands.push(...attackCands(state, units, u, w, pAt, virtualHp, opts.avoid))
          cands.push(...skillCands(state, units, u, w))
        }
      }
      cands.push(...moveCands(state, units, u, w, remaining))
    }
    for (const c of cands) c.score += jitter()
    cands.sort((a, b) => b.score - a.score)
    const best = cands.find((c) => c.action.type === 'wait' || !actionError(state, units, side, c.action))
    if (!best || best.action.type === 'wait' || (!needMove && best.score <= 0.05)) {
      plan.push({ type: 'wait' })
      continue
    }
    const a = best.action
    plan.push(a)
    used.set(a.unit, (used.get(a.unit) ?? 0) + 1)
    if (a.type === 'attack' || a.type === 'skill') {
      acts++
      unitActs.set(a.unit, (unitActs.get(a.unit) ?? 0) + 1)
    }
    const u = units[a.unit]!
    if (a.type === 'move') {
      u.pos = { ...a.to }
      moves++
    } else if (a.type === 'attack') {
      for (const [id, e] of best.expected ?? []) virtualHp.set(id, (virtualHp.get(id) ?? 0) - e)
    } else if (a.type === 'skill') {
      applySkillToSim(state, units, u, a)
    }
  }

  // 이동은 앞쪽 행동으로: 같은 행동 안에서 이동이 공격보다 먼저 처리되므로 일찍 움직일수록 많이 피한다
  // (시뮬레이션: 이동을 1번째로 76% vs 맨 뒤로 25%)
  if (w.moveFirst) {
    const rank = (a: Action) => (a.type === 'move' ? 0 : a.type === 'wait' ? 2 : 1)
    const reordered = [...plan].sort((a, b) => rank(a) - rank(b))
    if (validatePlan(state, side, reordered).ok) return reordered
  }
  if (validatePlan(state, side, plan).ok) return plan
  return fallbackPlan(state, side)
}

function hitValue(state: GameState, units: Record<UnitId, UnitState>, u: UnitState, e: UnitState, hp: number, w: AiWeights) {
  const turn = state.turn
  const d = hitDamage(u, e, turn)
  const max = maxHp(e, turn)
  let v = Math.min(d, hp) * (1 + w.lowHpBias * (1 - hp / max))
  if (d >= hp) v += w.killBonus
  if (abilityValue(u.inst, 'nullify') !== null && d < hp) v += w.nullify
  if (abilityValue(u.inst, 'slow') !== null && d < hp) v += w.slow
  const psn = abilityValue(u.inst, 'poison')
  if (psn && d < hp) v += Math.max(1, applyBp(u.inst.stats.atk, psn)) * state.config.poisonTurns * 0.8
  const r = abilityValue(e.inst, 'reflect')
  if (r) v -= applyBp(d, r)
  void units
  return { v, d }
}

function attackCands(
  state: GameState,
  units: Record<UnitId, UnitState>,
  u: UnitState,
  w: AiWeights,
  pAt: (e: UnitId, cells: Pos[]) => number,
  virtualHp: Map<UnitId, number>,
  avoid?: UnitId,
): Cand[] {
  const cfg = state.config
  const enemySide = opponent(u.owner)
  const enemies = aliveOf(units, enemySide).filter((e) => (virtualHp.get(e.id) ?? 0) > 0 && e.id !== avoid)
  const out: Cand[] = []
  if (abilityValue(u.inst, 'homing') !== null) {
    for (const e of enemies) {
      if (manhattan(u.pos, e.pos) > effRange(u)) continue
      const { v, d } = hitValue(state, units, u, e, virtualHp.get(e.id)!, w)
      out.push({ action: { type: 'attack', unit: u.id, aim: { kind: 'unit', id: e.id } }, score: v, expected: new Map([[e.id, d]]) })
    }
    return out
  }
  const splash = abilityValue(u.inst, 'splash') !== null
  for (const c of zoneCells(cfg, enemySide)) {
    if (manhattan(u.pos, c) > effRange(u)) continue
    const cells = splash ? square3(cfg, c).filter((p) => inZone(cfg, enemySide, p)) : [c]
    let score = 0
    const expected = new Map<UnitId, number>()
    for (const e of enemies) {
      const p = pAt(e.id, cells)
      if (p <= 0) continue
      const { v, d } = hitValue(state, units, u, e, virtualHp.get(e.id)!, w)
      score += p * v
      expected.set(e.id, p * d)
    }
    if (score > 0) out.push({ action: { type: 'attack', unit: u.id, aim: { kind: 'cell', pos: c } }, score, expected })
  }
  return out
}

function skillCands(state: GameState, units: Record<UnitId, UnitState>, u: UnitState, w: AiWeights): Cand[] {
  const ab = u.inst.ability
  if (!ab || ABILITIES[ab.kind].use !== 'skill') return []
  const def = ABILITIES[ab.kind]
  const turn = state.turn
  if (def.buff && u.readyTurn > turn) return []
  const v = def.tiers[ab.tier] ?? 0
  const allies = aliveOf(units, u.owner)
  const healValue = (t: UnitState) => {
    const max = maxHp(t, turn)
    const amt = Math.min(skillHealAmount(t, v, turn), max - t.hp)
    return amt * w.heal * (1 + (1 - t.hp / max))
  }
  const out: Cand[] = []
  if (ab.kind === 'heal') {
    for (const t of allies)
      if (manhattan(u.pos, t.pos) <= effRange(u))
        out.push({ action: { type: 'skill', unit: u.id, aim: { kind: 'unit', id: t.id } }, score: healValue(t) })
  } else if (ab.kind === 'areaHeal') {
    for (const c of zoneCells(state.config, u.owner)) {
      if (manhattan(u.pos, c) > effRange(u)) continue
      let s = 0
      for (const p of square3(state.config, c)) {
        const t = unitAt(units, p)
        if (t && t.owner === u.owner) s += healValue(t)
      }
      if (s > 0) out.push({ action: { type: 'skill', unit: u.id, aim: { kind: 'cell', pos: c } }, score: s })
    }
  } else {
    const n = allies.length
    const score =
      ab.kind === 'teamAtkUp' || ab.kind === 'teamArmorUp'
        ? v * n * w.buff
        : ab.kind === 'moveUp'
          ? v * 1.0
          : v * 2.8 * w.buff
    out.push({ action: { type: 'skill', unit: u.id }, score })
  }
  return out
}

function threatAt(state: GameState, units: Record<UnitId, UnitState>, u: UnitState, p: Pos): number {
  let t = 0
  for (const e of aliveOf(units, opponent(u.owner))) {
    if (abilityValue(e.inst, 'homing') !== null) continue // 피할 수 없음
    if (manhattan(e.pos, p) <= effRange(e)) t += hitDamage(e, u, state.turn)
  }
  return t
}

function moveCands(state: GameState, units: Record<UnitId, UnitState>, u: UnitState, w: AiWeights, remaining: number): Cand[] {
  const cfg = state.config
  const turn = state.turn
  const zoneHit = Math.max(1, applyBp(maxHp(u, turn), cfg.dangerZoneDamageBp))
  const zonePen = (p: Pos) =>
    (isDangerCell(cfg, turn, u.owner, p) ? zoneHit : isDangerCell(cfg, turn + 1, u.owner, p) ? zoneHit / 2 : 0) * w.zone
  const inRange = (p: Pos) =>
    aliveOf(units, opponent(u.owner)).filter((e) => manhattan(p, e.pos) <= effRange(u)).length
  const fragility = 1 + (1 - u.hp / maxHp(u, turn))
  const here = u.pos
  const threatHere = threatAt(state, units, u, here)
  const out: Cand[] = []
  for (const to of reachable(cfg, units, u, effMove(u, turn))) {
    if (posEq(to, here)) continue
    const dodge = (threatHere - 0.3 * threatAt(state, units, u, to)) * w.dodge * fragility * (remaining / cfg.actionsPerTurn)
    const approach = (inRange(to) - inRange(here)) * w.approach * 3
    const zone = zonePen(here) - zonePen(to)
    out.push({ action: { type: 'move', unit: u.id, to }, score: dodge + approach + zone - 0.5 })
  }
  return out
}

function applySkillToSim(state: GameState, units: Record<UnitId, UnitState>, u: UnitState, a: Action & { type: 'skill' }) {
  const ab = u.inst.ability!
  const def = ABILITIES[ab.kind]
  const v = def.tiers[ab.tier] ?? 0
  const turn = state.turn
  const until = turn + state.config.buffTurns - 1
  if (def.buff) u.readyTurn = turn + state.config.buffCooldownTurns
  if (ab.kind === 'heal' && a.aim?.kind === 'unit') {
    const t = units[a.aim.id]!
    t.hp = Math.min(maxHp(t, turn), t.hp + skillHealAmount(t, v, turn))
  } else if (ab.kind === 'areaHeal' && a.aim?.kind === 'cell') {
    for (const p of square3(state.config, a.aim.pos)) {
      const t = unitAt(units, p)
      if (t && t.owner === u.owner) t.hp = Math.min(maxHp(t, turn), t.hp + skillHealAmount(t, v, turn))
    }
  } else if (ab.kind === 'moveUp' || ab.kind === 'allUp') {
    u.buffs.push({ stat: 'move', amount: v, untilTurn: until })
  }
}

/** 배치: 사거리 짧은 유닛부터 앞줄. 같은 줄 안에서는 시드로 섞음 */
function planDeploymentImpl(state: GameState, side: Side, team: readonly UnitInstance[], seed: number | string = 0): Pos[] {
  const cfg = state.config
  const rng = new Rng(createRngState(`${seed}:deploy:${side}`))
  const front = (p: Pos) => (side === 'A' ? p.y - (cfg.boardHeight - cfg.zoneRows) : cfg.zoneRows - 1 - p.y)
  const cells = zoneCells(cfg, side)
    .map((p) => ({ p, k: front(p) * 100 + rng.int(100) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.p)
  const order = team.map((u, i) => ({ i, r: u.stats.range * 100 + rng.int(100) })).sort((a, b) => a.r - b.r)
  const out: Pos[] = Array(team.length)
  order.forEach((o, k) => (out[o.i] = cells[k]!))
  return out
}

// ───────────── 혼합 전략 AI (동시 턴 = 가위바위보 계산) ─────────────

/**
 * 1) 내 후보 계획 K개, 상대 후보 계획 K개를 판 상황에서 새로 뽑는다
 * 2) K×K 조합을 엔진으로 실제 처리해 결과표를 만든다 (내 관점 평가 점수)
 * 3) 결과표로 "상대가 뭘 해도 손해가 적은 섞는 비율"을 구한다 (regret matching)
 * 4) 그 비율대로 하나를 고른다 → 뻔하지 않고, 상대의 읽기에도 대비
 * 상대 입력은 보지 않는다 (공정).
 */
export interface MixedOptions {
  candidates: number
  iterations: number
  weights: AiWeights
}

export const DEFAULT_MIXED: MixedOptions = { candidates: 14, iterations: 400, weights: DEFAULT_AI }

function candidatePlansImpl(state: GameState, side: Side, seed: number | string, w: AiWeights, max: number): TurnPlan[] {
  const cfg = state.config
  const out = new Map<string, TurnPlan>()
  const add = (p: TurnPlan) => {
    if (out.size >= max) return
    const k = JSON.stringify(p)
    if (!out.has(k) && validatePlan(state, side, p).ok) out.set(k, p)
  }
  add(planTurn(state, side, seed, w))
  // 누구를 먼저 움직이나: 유닛마다 좋은 도착 칸 2곳을 1번째 행동으로 고정
  const units = cloneUnits(state.units)
  for (const u of aliveOf(units, side)) {
    const moves = moveCands(state, units, u, w, cfg.actionsPerTurn).sort((a, b) => b.score - a.score).slice(0, 2)
    for (const m of moves) add(planTurn(state, side, seed, w, { prefix: [m.action] }))
  }
  // 노리는 적 바꾸기
  for (const e of aliveOf(units, opponent(side))) add(planTurn(state, side, seed, w, { avoid: e.id }))
  // 행동형 능력 먼저 쓰기
  for (const u of aliveOf(units, side)) {
    const sk = skillCands(state, units, u, w).sort((a, b) => b.score - a.score)[0]
    if (sk) add(planTurn(state, side, seed, w, { prefix: [sk.action] }))
  }
  // 성향 바꾸기: 공격 먼저 / 상대가 더 움직인다고 봄 / 덜 움직인다고 봄
  add(planTurn(state, side, seed, { ...w, moveFirst: false }))
  add(planTurn(state, side, seed, { ...w, stay: 0.5 }))
  add(planTurn(state, side, seed, { ...w, stay: 0.95 }))
  if (out.size === 0) add(fallbackPlan(state, side))
  return [...out.values()]
}

/** 처리 후 판을 side 관점 점수로 (전멸 승패가 가장 큼) */
export function evaluate(s: GameState, side: Side): number {
  if (s.result) {
    const hp = (sd: Side) => aliveOf(s.units, sd).reduce((a, u) => a + u.hp, 0)
    const margin = (hp(side) - hp(opponent(side))) * 0.1
    return s.result.winner === side ? 1000 + margin : s.result.winner === 'draw' ? margin : -1000 + margin
  }
  const cfg = s.config
  let v = 0
  for (const u of Object.values(s.units)) {
    if (!u.alive) continue
    const sign = u.owner === side ? 1 : -1
    let x = 25 + u.hp
    x -= u.poison.reduce((a, p) => a + p.damage * (p.untilTurn - s.turn + 1), 0)
    if (u.nullified) x -= 6
    if (u.slowTurn === s.turn) x -= 2
    if (isDangerCell(cfg, s.turn, u.owner, u.pos)) x -= 0.8 * Math.max(1, applyBp(maxHp(u, s.turn), cfg.dangerZoneDamageBp))
    for (const b of u.buffs) if (b.untilTurn >= s.turn && (b.stat === 'atk' || b.stat === 'armor')) x += b.amount * 2
    v += sign * x
  }
  return v
}

/** 영합 행렬 게임의 행(나) 혼합 전략 (regret matching+) */
export function solveMatrix(M: number[][], iterations: number): number[] {
  const n = M.length
  const m = M[0]!.length
  const rR = new Array<number>(n).fill(0)
  const rC = new Array<number>(m).fill(0)
  const avg = new Array<number>(n).fill(0)
  const strat = (r: number[]) => {
    const pos = r.map((x) => Math.max(0, x))
    const sum = pos.reduce((a, b) => a + b, 0)
    return sum > 0 ? pos.map((x) => x / sum) : r.map(() => 1 / r.length)
  }
  for (let t = 1; t <= iterations; t++) {
    const sR = strat(rR)
    const sC = strat(rC)
    const uR = M.map((row) => row.reduce((a, x, j) => a + x * sC[j]!, 0))
    const vR = uR.reduce((a, x, i) => a + x * sR[i]!, 0)
    const uC = sC.map((_, j) => -M.reduce((a, row, i) => a + row[j]! * sR[i]!, 0))
    const vC = uC.reduce((a, x, j) => a + x * sC[j]!, 0)
    for (let i = 0; i < n; i++) rR[i] = Math.max(0, rR[i]! + uR[i]! - vR)
    for (let j = 0; j < m; j++) rC[j] = Math.max(0, rC[j]! + uC[j]! - vC)
    for (let i = 0; i < n; i++) avg[i]! += sR[i]! * t // 뒤쪽 반복에 가중
  }
  const sum = avg.reduce((a, b) => a + b, 0)
  return avg.map((x) => x / sum)
}

function planTurnMixedImpl(state: GameState, side: Side, seed: number | string = 0, o: MixedOptions = DEFAULT_MIXED): TurnPlan {
  const mine = candidatePlans(state, side, seed, o.weights, o.candidates)
  if (mine.length === 1) return mine[0]!
  const theirs = candidatePlans(state, opponent(side), `${seed}:opp`, o.weights, o.candidates)
  const M = mine.map((p) =>
    theirs.map((q) => {
      const plans = side === 'A' ? { A: p, B: q } : { A: q, B: p }
      return evaluate(resolveTurn(state, plans, { trusted: true }).state, side)
    }),
  )
  const probs = solveMatrix(M, o.iterations).map((x) => (x < 0.02 ? 0 : x))
  const total = probs.reduce((a, b) => a + b, 0)
  const rng = new Rng(createRngState(`${seed}:${state.turn}:${side}:mix`))
  let r = (rng.int(1_000_000) / 1_000_000) * total
  for (let i = 0; i < mine.length; i++) {
    r -= probs[i]!
    if (r < 0) return mine[i]!
  }
  return mine[0]!
}

// ───────────── 진영 대칭 ─────────────
// AI 는 항상 "내가 A(아래)" 인 판에서 생각한다. B 는 판을 뒤집어 A 로 계획하고 결과만 다시 뒤집는다.
// → 방향 고르는 순서·동점 처리 같은 사소한 차이로 진영마다 다르게 두는 일이 없다.

/** 탐욕 계획: 행동마다 최고 점수 하나 (혼합 전략 AI의 후보 생성기로도 사용) */
export function planTurn(state: GameState, side: Side, seed: number | string = 0, w: AiWeights = DEFAULT_AI, opts: PlanOptions = {}): TurnPlan {
  if (side === 'A') return planTurnImpl(state, 'A', seed, w, opts)
  return asA('B', planTurnImpl(asA('B', state, state), 'A', seed, w, asA('B', opts, state)), state)
}

/** 배치: 사거리 짧은 유닛부터 앞줄. 같은 줄 안에서는 시드로 섞음 */
export function planDeployment(state: GameState, side: Side, team: readonly UnitInstance[], seed: number | string = 0): Pos[] {
  if (side === 'A') return planDeploymentImpl(state, 'A', team, seed)
  return asA('B', planDeploymentImpl(asA('B', state, state), 'A', team, seed), state)
}

export function candidatePlans(state: GameState, side: Side, seed: number | string, w: AiWeights, max: number): TurnPlan[] {
  if (side === 'A') return candidatePlansImpl(state, 'A', seed, w, max)
  return asA('B', candidatePlansImpl(asA('B', state, state), 'A', seed, w, max), state)
}

export function planTurnMixed(state: GameState, side: Side, seed: number | string = 0, o: MixedOptions = DEFAULT_MIXED): TurnPlan {
  if (side === 'A') return planTurnMixedImpl(state, 'A', seed, o)
  return asA('B', planTurnMixedImpl(asA('B', state, state), 'A', seed, o), state)
}
