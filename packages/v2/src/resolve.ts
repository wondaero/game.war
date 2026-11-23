import { ABILITIES, abilityValue } from './abilities.ts'
import { aliveOf, effAtk, inZone, isDangerCell, maxHp, square3, unitAt } from './board.ts'
import { attackTargets, hitDamage, skillHealAmount } from './combat.ts'
import { applyBp } from './config.ts'
import type { Action, GameEvent, GameResult, GameState, Side, TurnLog, TurnPlan, UnitId, UnitState } from './types.ts'
import { SIDES } from './types.ts'
import { actionError, cloneUnits, EngineError, validatePlan } from './validate.ts'

type HealSource = 'heal' | 'areaHeal' | 'moveRegen' | 'lifesteal'

/**
 * 한 턴 처리. 순수·결정적: (state, plans) → (state', log). 판 안에 난수 없음.
 *
 * N번째 행동 (양쪽 동시):
 *   ⓪ 무효 상태인 유닛의 행동은 취소 (같은 행동에 걸린 무효는 다음 행동부터)
 *   ① 이동 (도착 칸 고정. 비어 있지 않으면 실패) → 이동 시 자가 회복
 *   ② 행동형 능력: 버프 즉시 적용, 회복량 계산
 *   ③ 공격: 이동 후 위치 기준으로 맞는 적·피해 계산
 *   ④ 회복 먼저 반영 → 피해·반사 동시 반영 → 흡혈 → 상태(무효·이동수 제어·맹독) 부여
 *   ⑤ 사망 동시 처리
 * 턴 끝: 맹독 → 위험지대 → 사망 → 승패 → 버프 만료
 */
export function resolveTurn(
  state: GameState,
  plans: Record<Side, TurnPlan>,
  /** 이미 검증한 계획 (AI 탐색용) */
  opts: { trusted?: boolean } = {},
): { state: GameState; log: TurnLog } {
  if (!opts.trusted) for (const side of SIDES) {
    const v = validatePlan(state, side, plans[side])
    if (!v.ok) throw new EngineError(`Invalid plan for ${side}`, v.errors)
  }
  const cfg = state.config
  const turn = state.turn
  const units = cloneUnits(state.units)
  const ctx: Ctx = { state, units, turn }
  const steps: GameEvent[][] = []
  let result: GameResult | null = null

  for (let i = 0; i < cfg.actionsPerTurn; i++) {
    const ev: GameEvent[] = []
    const acts: Partial<Record<Side, Action>> = {}

    // ⓪ 사망·무효·실행 시점 재검사
    for (const side of SIDES) {
      const a = plans[side][i]!
      if (a.type === 'wait') continue
      const u = units[a.unit]!
      if (!u.alive) {
        ev.push({ type: 'fizzle', side, action: a, reason: 'dead' })
        continue
      }
      if (u.nullified) {
        u.nullified = false
        ev.push({ type: 'fizzle', side, action: a, reason: 'nullified' })
        continue
      }
      // 이동은 도착 칸 고정(M6)이라 실행 시점엔 빈칸 여부만 본다
      if (a.type !== 'move' && actionError(state, units, side, a, true)) {
        ev.push({ type: 'fizzle', side, action: a, reason: 'invalid' })
        continue
      }
      acts[side] = a
    }

    // ① 이동
    for (const side of SIDES) {
      const a = acts[side]
      if (a?.type !== 'move') continue
      const u = units[a.unit]!
      if (unitAt(units, a.to, u.id) || !inZone(cfg, side, a.to)) {
        ev.push({ type: 'moveBlocked', unit: u.id, to: a.to })
        continue
      }
      ev.push({ type: 'move', unit: u.id, from: { ...u.pos }, to: { ...a.to } })
      u.pos = { ...a.to }
      const regen = abilityValue(u.inst, 'moveRegen')
      if (regen && u.moveRegenTurn !== turn) {
        u.moveRegenTurn = turn
        heal(ctx, u, Math.max(1, applyBp(effAtk(u, turn), regen)), 'moveRegen', true, ev)
      }
    }

    // ② 행동형 능력
    const pendingHeals: { unit: UnitState; amount: number; source: HealSource }[] = []
    for (const side of SIDES) {
      const a = acts[side]
      if (a?.type !== 'skill') continue
      const u = units[a.unit]!
      const ab = u.inst.ability!
      const v = ABILITIES[ab.kind].tiers[ab.tier] ?? 0
      if (ab.kind === 'heal' && a.aim?.kind === 'unit') {
        const t = units[a.aim.id]!
        pendingHeals.push({ unit: t, amount: skillHealAmount(t, v, turn), source: 'heal' })
      } else if (ab.kind === 'areaHeal' && a.aim?.kind === 'cell') {
        for (const c of square3(cfg, a.aim.pos)) {
          const t = unitAt(units, c)
          if (t && t.owner === side) pendingHeals.push({ unit: t, amount: skillHealAmount(t, v, turn), source: 'areaHeal' })
        }
      } else {
        const until = turn + cfg.buffTurns - 1
        const team = aliveOf(units, side)
        const targets =
          ab.kind === 'teamArmorUp' || ab.kind === 'teamAtkUp' ? team : [u]
        for (const t of targets) {
          if (ab.kind === 'teamArmorUp') t.buffs.push({ stat: 'armor', amount: v, untilTurn: until })
          if (ab.kind === 'teamAtkUp') t.buffs.push({ stat: 'atk', amount: v, untilTurn: until })
          if (ab.kind === 'moveUp') t.buffs.push({ stat: 'move', amount: v, untilTurn: until })
          if (ab.kind === 'allUp') {
            for (const stat of ['atk', 'armor', 'move', 'hp'] as const) t.buffs.push({ stat, amount: v, untilTurn: until })
            t.hp += v
          }
        }
        u.readyTurn = turn + cfg.buffCooldownTurns
        ev.push({ type: 'buff', unit: u.id, kind: ab.kind, targets: targets.map((t) => t.id) })
      }
    }

    // ③ 공격
    type Hit = { att: UnitState; tgt: UnitState; dmg: number }
    const hits: Hit[] = []
    for (const side of SIDES) {
      const a = acts[side]
      if (a?.type !== 'attack') continue
      const att = units[a.unit]!
      const { cells, targets } = attackTargets(cfg, units, att, a.aim)
      const hs = targets.map((tgt) => ({ att, tgt, dmg: hitDamage(att, tgt, turn) }))
      hits.push(...hs)
      ev.push({ type: 'attack', unit: att.id, aim: a.aim, cells, hits: hs.map((h) => ({ target: h.tgt.id, damage: h.dmg })) })
    }

    // ④ 회복 → 피해·반사 → 흡혈 → 상태
    for (const h of pendingHeals) heal(ctx, h.unit, h.amount, h.source, false, ev)
    const dmg = new Map<UnitId, number>()
    const add = (id: UnitId, n: number) => n > 0 && dmg.set(id, (dmg.get(id) ?? 0) + n)
    for (const h of hits) {
      add(h.tgt.id, h.dmg)
      const r = abilityValue(h.tgt.inst, 'reflect')
      if (r) {
        const back = applyBp(h.dmg, r)
        if (back > 0) {
          add(h.att.id, back)
          ev.push({ type: 'reflect', from: h.tgt.id, to: h.att.id, damage: back })
        }
      }
    }
    for (const [id, n] of [...dmg].sort()) units[id]!.hp -= n
    for (const h of hits) {
      const ls = abilityValue(h.att.inst, 'lifesteal')
      if (ls && h.att.hp > 0) heal(ctx, h.att, applyBp(h.dmg, ls), 'lifesteal', true, ev)
      if (abilityValue(h.att.inst, 'nullify') !== null) {
        h.tgt.nullified = true
        ev.push({ type: 'status', unit: h.tgt.id, status: 'nullified' })
      }
      if (abilityValue(h.att.inst, 'slow') !== null) {
        h.tgt.slowTurn = turn + 1
        ev.push({ type: 'status', unit: h.tgt.id, status: 'slowed' })
      }
      const psn = abilityValue(h.att.inst, 'poison')
      if (psn) {
        h.tgt.poison.push({ damage: Math.max(1, applyBp(effAtk(h.att, turn), psn)), untilTurn: turn + cfg.poisonTurns - 1 })
        ev.push({ type: 'status', unit: h.tgt.id, status: 'poisoned' })
      }
    }

    // ⑤ 사망
    killDead(units, ev)
    result = annihilation(units)
    if (result) ev.push({ type: 'gameOver', result })
    steps.push(ev)
    if (result) break
  }

  const endEvents: GameEvent[] = []
  if (!result) {
    for (const u of aliveOf(units)) {
      const active = u.poison.filter((p) => p.untilTurn >= turn)
      const n = active.reduce((s, p) => s + p.damage, 0)
      if (n > 0) {
        u.hp -= n
        endEvents.push({ type: 'poisonTick', unit: u.id, damage: n })
      }
      u.poison = active.filter((p) => p.untilTurn > turn)
    }
    for (const u of aliveOf(units)) {
      if (!isDangerCell(cfg, turn, u.owner, u.pos)) continue
      const n = Math.max(1, applyBp(maxHp(u, turn), cfg.dangerZoneDamageBp))
      u.hp -= n
      endEvents.push({ type: 'zoneDamage', unit: u.id, damage: n })
    }
    killDead(units, endEvents)
    result = annihilation(units)
    if (!result && turn >= cfg.maxTurns) result = judgeByHp(units, cfg.judgeBy)
    if (result) endEvents.push({ type: 'gameOver', result })
  }
  // 버프 만료 (체력 버프가 빠지면 최대 체력에 맞춤)
  for (const u of Object.values(units)) {
    u.buffs = u.buffs.filter((b) => b.untilTurn > turn)
    if (u.alive) u.hp = Math.max(1, Math.min(u.hp, maxHp(u, turn + 1)))
  }

  return {
    state: { ...state, units, turn: turn + 1, phase: result ? 'over' : 'plan', result },
    log: { turn, plans, steps, endEvents },
  }
}

interface Ctx {
  state: GameState
  units: Record<UnitId, UnitState>
  turn: number
}

/** 회복 공통: 서든데스 배율 → (행동 없는 회복만) 턴당 상한 → 최대 체력 초과 불가 */
function heal(ctx: Ctx, u: UnitState, raw: number, source: HealSource, passive: boolean, ev: GameEvent[]) {
  const cfg = ctx.state.config
  if (!u.alive || u.hp <= 0 || raw <= 0) return
  let amount = raw
  if (ctx.turn >= cfg.suddenDeathTurn) amount = Math.max(1, applyBp(amount, cfg.suddenDeathHealBp))
  if (passive) {
    if (u.passiveHealTurn !== ctx.turn) {
      u.passiveHealTurn = ctx.turn
      u.passiveHealed = 0
    }
    const cap = applyBp(maxHp(u, ctx.turn), cfg.passiveHealCapBp)
    amount = Math.min(amount, Math.max(0, cap - u.passiveHealed))
  }
  amount = Math.min(amount, maxHp(u, ctx.turn) - u.hp)
  if (amount <= 0) return
  u.hp += amount
  if (passive) u.passiveHealed += amount
  ev.push({ type: 'heal', unit: u.id, amount, source })
}

function killDead(units: Record<UnitId, UnitState>, ev: GameEvent[]) {
  for (const u of aliveOf(units))
    if (u.hp <= 0) {
      u.alive = false
      ev.push({ type: 'death', unit: u.id })
    }
}

function annihilation(units: Record<UnitId, UnitState>): GameResult | null {
  const a = aliveOf(units, 'A').length > 0
  const b = aliveOf(units, 'B').length > 0
  if (a && b) return null
  return { winner: a ? 'A' : b ? 'B' : 'draw', reason: 'annihilation' }
}

function judgeByHp(units: Record<UnitId, UnitState>, by: 'hpRatio' | 'hpTotal'): GameResult {
  const r = (s: Side) => {
    let hp = 0
    let max = 0
    for (const u of Object.values(units)) {
      if (u.owner !== s) continue
      max += u.inst.stats.hp
      if (u.alive) hp += Math.max(0, u.hp)
    }
    return { hp, max }
  }
  const a = r('A')
  const b = r('B')
  const l = by === 'hpTotal' ? a.hp : a.hp * b.max
  const rr = by === 'hpTotal' ? b.hp : b.hp * a.max
  return { winner: l > rr ? 'A' : rr > l ? 'B' : 'draw', reason: 'maxTurns' }
}
