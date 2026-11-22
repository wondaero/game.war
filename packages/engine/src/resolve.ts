import { isDangerCell, posKey, unitAt } from './board.ts'
import { applyBp, computeHitParams } from './hit.ts'
import { computeAttack } from './trajectory.ts'
import type {
  Action,
  GameResult,
  GameState,
  HealSource,
  HitRecord,
  Pos,
  Side,
  StepEvent,
  StepLog,
  TurnLog,
  TurnPlan,
  UnitId,
  UnitState,
} from './types.ts'
import { SIDES } from './types.ts'
import { champOf, maxHpOf, specialValue, trajectoryOf } from './units.ts'
import { EngineError, isMoveGeometryValid, validatePlan } from './validate.ts'

export function cloneUnits(units: Record<UnitId, UnitState>): Record<UnitId, UnitState> {
  const out: Record<UnitId, UnitState> = {}
  for (const [id, u] of Object.entries(units)) out[id] = { ...u, pos: { ...u.pos } }
  return out
}

/**
 * 한 턴 처리. 순수·결정적 함수: (state, plans) → (state', log). 판 안에는 난수가 없다.
 *
 * 각 스텝 고정 순서:
 *   이동 (동시. 같은 칸 충돌 → 둘 다 실패, 스텝 시작 시 점유된 칸 → 실패)
 *   공격마다 맞은 카드마다:
 *     ① 공격력으로 피해 계산 ② 방어력만큼 감소(최소 1) ③ 보호막 흡수 ④ 체력 감소
 *     ⑤ 반사 (공격자 방어력 무시, 공격자 보호막은 흡수, 재반사 없음)
 *     ⑥ 공격 시 회복 (실제 체력 감소량 기준, 반사 피해 제외, 체력 > 0 인 공격자만)
 *   ⑦ 사망 동시 처리
 * 턴 끝: ⑧ 자체 회복 ⑨ 위험지대 피해 → 동시 사망
 *
 * 같은 스텝의 피해는 모두 모은 뒤 동시에 반영하므로 A/B 처리 순서가 결과를 바꾸지 않는다.
 */
export function resolveTurn(state: GameState, plans: Record<Side, TurnPlan>): { state: GameState; log: TurnLog } {
  for (const side of SIDES) {
    const v = validatePlan(state, side, plans[side])
    if (!v.ok) throw new EngineError(`Invalid plan for ${side}`, v.errors)
  }

  const cfg = state.config
  const units = cloneUnits(state.units)
  for (const u of Object.values(units)) u.healedThisTurn = 0
  const ctx: TurnCtx = { state, units }
  const steps: StepLog[] = []
  let result: GameResult | null = null

  for (let i = 0; i < cfg.actionsPerTurn; i++) {
    const events: StepEvent[] = []
    const actions = { A: plans.A[i]!, B: plans.B[i]! }

    movePhase(ctx, actions, events)
    attackPhase(ctx, actions, events)

    result = checkAnnihilation(units)
    if (result) events.push({ type: 'gameOver', result })

    steps.push({ step: i + 1, events, unitsAfter: cloneUnits(units) })
    if (result) break
  }

  const endEvents: StepEvent[] = []
  if (!result) {
    // ⑧ 턴 끝 자체 회복
    for (const u of sortedUnits(units)) {
      const v = specialValue(u.instance, 'regen')
      if (v > 0) heal(ctx, u, v, 'regen', endEvents)
    }
    // ⑨ 위험지대 피해 (방어력·보호막 무시) → 동시 사망
    for (const u of sortedUnits(units)) {
      if (!u.alive || !isDangerCell(cfg, state.turn, u.owner, u.pos)) continue
      const amount = Math.max(1, applyBp(maxHpOf(u), cfg.dangerZoneDamageBp))
      const hpBefore = u.hp
      u.hp -= amount
      endEvents.push({ type: 'zoneDamage', unit: u.id, amount, hpBefore, hpAfter: u.hp })
    }
    for (const u of sortedUnits(units)) {
      if (u.alive && u.hp <= 0) {
        u.alive = false
        endEvents.push({ type: 'death', unit: u.id })
      }
    }
    result = checkAnnihilation(units)
    if (result) endEvents.push({ type: 'gameOver', result })
    else if (state.turn >= cfg.maxTurns) {
      result = judgeByHp(units)
      endEvents.push({ type: 'gameOver', result })
    }
  }

  const next: GameState = {
    ...state,
    units,
    turn: state.turn + 1,
    phase: result ? 'over' : 'plan',
    result,
  }
  return {
    state: next,
    log: { turn: state.turn, plans, steps, endEvents, unitsAfter: cloneUnits(units) },
  }
}

interface TurnCtx {
  state: GameState
  units: Record<UnitId, UnitState>
}

const sortedUnits = (units: Record<UnitId, UnitState>) =>
  Object.values(units).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

// ───────────── 회복 ─────────────

/**
 * 회복 공통 처리: 서든데스 배율 → 턴당 상한(최대 HP 비율) → 최대 HP 초과 불가.
 * 체력 0 이하(이번 스텝에 쓰러질) 유닛은 회복하지 않는다.
 */
function heal(ctx: TurnCtx, u: UnitState, raw: number, source: HealSource, events: StepEvent[]): number {
  const cfg = ctx.state.config
  if (!u.alive || u.hp <= 0 || raw <= 0) return 0
  let amount = raw
  if (ctx.state.turn >= cfg.suddenDeathTurn) amount = applyBp(amount, cfg.suddenDeathHealBp)
  const cap = applyBp(maxHpOf(u), cfg.healCapBp)
  amount = Math.min(amount, Math.max(0, cap - u.healedThisTurn), maxHpOf(u) - u.hp)
  if (amount <= 0) return 0
  const hpBefore = u.hp
  u.hp += amount
  u.healedThisTurn += amount
  events.push({ type: 'heal', unit: u.id, source, amount, hpBefore, hpAfter: u.hp })
  return amount
}

// ───────────── 이동 ─────────────

function movePhase(ctx: TurnCtx, actions: Record<Side, Action>, events: StepEvent[]): void {
  const { units } = ctx
  type Intent = { side: Side; unit: UnitState; from: Pos; to: Pos }
  const intents: Intent[] = []

  for (const side of SIDES) {
    const a = actions[side]
    if (a.type === 'wait') {
      events.push({ type: 'wait', side })
      continue
    }
    if (a.type !== 'move') continue
    const u = units[a.unit]
    if (!u || !u.alive) {
      events.push({ type: 'fizzle', side, action: a, reason: 'unitDead' })
      continue
    }
    if (!isMoveGeometryValid(ctx.state, units, u, a.to)) {
      events.push({ type: 'fizzle', side, action: a, reason: 'invalidMove' })
      continue
    }
    intents.push({ side, unit: u, from: { ...u.pos }, to: a.to })
  }

  // 목표 칸은 스텝 시작 시점에 비어 있어야 함 (떠나는 칸으로 들어가기·맞바꾸기 불가)
  const targetCount = new Map<string, number>()
  for (const it of intents) targetCount.set(posKey(it.to), (targetCount.get(posKey(it.to)) ?? 0) + 1)

  const succeeded: Intent[] = []
  for (const it of intents) {
    const base = { side: it.side, unit: it.unit.id, from: it.from, to: it.to }
    if (unitAt(units, it.to)) events.push({ type: 'moveBlocked', ...base, reason: 'occupied' })
    else if ((targetCount.get(posKey(it.to)) ?? 0) > 1)
      events.push({ type: 'moveBlocked', ...base, reason: 'collision' })
    else succeeded.push(it)
  }

  for (const it of succeeded) {
    it.unit.pos = { ...it.to }
    events.push({ type: 'move', side: it.side, unit: it.unit.id, from: it.from, to: it.to })
  }
}

// ───────────── 공격 ~ 사망 ─────────────

function attackPhase(ctx: TurnCtx, actions: Record<Side, Action>, events: StepEvent[]): void {
  const { state, units } = ctx
  const hpAtStepStart = new Map(Object.values(units).map((u) => [u.id, u.hp]))
  const pending = new Map<UnitId, number>()
  const addDamage = (id: UnitId, dmg: number) => {
    if (dmg > 0) pending.set(id, (pending.get(id) ?? 0) + dmg)
  }
  const records: HitRecord[] = []

  // ①② 공격 수집 (A → B 순서는 기록 순서일 뿐, 피해는 동시 반영)
  for (const side of SIDES) {
    const a = actions[side]
    if (a.type !== 'attack') continue
    const attacker = units[a.unit]
    if (!attacker || !attacker.alive) {
      events.push({ type: 'fizzle', side, action: a, reason: 'unitDead' })
      continue
    }
    const traj = trajectoryOf(champOf(state, attacker), attacker.instance)
    const geom = computeAttack(state.config, units, attacker, traj, a.aim)
    if (!geom) {
      events.push({ type: 'fizzle', side, action: a, reason: 'invalidAim' })
      continue
    }
    const hits: HitRecord[] = geom.targets.map((tid, idx) => {
      const pierceIndex = traj.kind === 'straight' || traj.kind === 'diagonal' ? idx : 0
      const p = computeHitParams(state, attacker, units[tid]!, pierceIndex)
      return {
        attacker: attacker.id,
        target: tid,
        pierceIndex,
        base: p.base,
        afterArmor: p.afterArmor,
        absorbed: 0,
        hpDamage: 0,
        reflect: null,
        lifesteal: 0,
        effects: p.effects,
      }
    })
    records.push(...hits)
    events.push({
      type: 'attack',
      side,
      unit: attacker.id,
      aim: a.aim,
      path: geom.path,
      impactCells: geom.impactCells,
      blockedBy: geom.blockedBy,
      hits,
    })
  }

  // ③④ 직접 피해: 보호막 먼저, 나머지 체력 피해 누적
  // (각 유닛은 한 스텝에 상대 공격을 최대 1번만 받으므로 순서 무관)
  for (const r of records) {
    const t = units[r.target]!
    r.absorbed = Math.min(t.shield, r.afterArmor)
    t.shield -= r.absorbed
    r.hpDamage = r.afterArmor - r.absorbed
    addDamage(t.id, r.hpDamage)
  }

  // ⑤ 반사: 받은 피해(방어력 감소 후, 보호막 흡수분 포함)의 비율. 직접 피해 다음에 공격자 보호막이 흡수
  for (const r of records) {
    const bp = specialValue(units[r.target]!.instance, 'reflect')
    const amount = applyBp(r.afterArmor, bp)
    if (amount <= 0) continue
    const atk = units[r.attacker]!
    const absorbed = Math.min(atk.shield, amount)
    atk.shield -= absorbed
    r.reflect = { amount, absorbed, hpDamage: amount - absorbed }
    addDamage(atk.id, amount - absorbed)
  }

  // ④ 체력 감소 동시 반영
  for (const id of [...pending.keys()].sort()) {
    const u = units[id]!
    const amount = pending.get(id)!
    const hpBefore = u.hp
    u.hp -= amount
    events.push({ type: 'damage', unit: id, amount, hpBefore, hpAfter: u.hp })
  }

  // ⑥ 공격 시 회복: 초과 피해 제외(스텝 시작 체력까지), 반사 피해 제외, 체력 > 0 인 공격자만
  for (const r of records) {
    const atk = units[r.attacker]!
    const bp = specialValue(atk.instance, 'lifesteal')
    if (bp <= 0) continue
    const dealt = Math.min(r.hpDamage, Math.max(0, hpAtStepStart.get(r.target) ?? 0))
    r.lifesteal = heal(ctx, atk, applyBp(dealt, bp), 'lifesteal', events)
  }

  // ⑦ 사망 동시 처리
  for (const u of sortedUnits(units)) {
    if (u.alive && u.hp <= 0) {
      u.alive = false
      events.push({ type: 'death', unit: u.id })
    }
  }
}

// ───────────── 승패 ─────────────

function checkAnnihilation(units: Record<UnitId, UnitState>): GameResult | null {
  const alive = (s: Side) => Object.values(units).some((u) => u.owner === s && u.alive)
  const a = alive('A')
  const b = alive('B')
  if (a && b) return null
  return { winner: a ? 'A' : b ? 'B' : 'draw', reason: 'annihilation' }
}

/** 최대 턴 초과: 남은 체력 합 / 최대 체력 합 비율 비교 (정수 교차곱) */
function judgeByHp(units: Record<UnitId, UnitState>): GameResult {
  const ratio = (s: Side) => {
    let hp = 0
    let max = 0
    for (const u of Object.values(units)) {
      if (u.owner !== s) continue
      max += u.instance.stats.hp
      if (u.alive) hp += u.hp
    }
    return { hp, max }
  }
  const a = ratio('A')
  const b = ratio('B')
  const lhs = a.hp * b.max
  const rhs = b.hp * a.max
  return { winner: lhs > rhs ? 'A' : rhs > lhs ? 'B' : 'draw', reason: 'maxTurns' }
}
