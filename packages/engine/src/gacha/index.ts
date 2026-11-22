import { catalogById } from '../cards/catalog.ts'
import { BP, makeConfig, type GameConfig } from '../config.ts'
import { Rng, type RngState } from '../rng.ts'
import type { ChampTemplate, Special, SpecialKind, StatKey, StatRange, Stats, UnitInstance } from '../types.ts'
import { HEAL_SPECIALS, SPECIAL_KINDS, STAT_KEYS } from '../types.ts'
import { EngineError, validation, type Validation } from '../validate.ts'
import { DEFAULT_GACHA_TABLE, type Cost, type GachaTable, type StatTier } from './table.ts'

export * from './table.ts'

/**
 * 뽑기·리롤 순수 함수. (입력 + 난수 상태) → (결과 + 다음 난수 상태)
 * 시계를 읽지 않고(now 를 받음) 저장소에 접근하지 않는다 → 서버로 그대로 이동 가능.
 */
export interface GachaContext {
  table: GachaTable
  catalog: Readonly<Record<string, ChampTemplate>>
  config: GameConfig
}

export function makeGachaContext(
  opts: { table?: GachaTable; champs?: readonly ChampTemplate[]; config?: Partial<GameConfig> } = {},
): GachaContext {
  const ctx = { table: opts.table ?? DEFAULT_GACHA_TABLE, catalog: catalogById(opts.champs), config: makeConfig(opts.config) }
  const v = validateGachaContext(ctx)
  if (!v.ok) throw new EngineError('Invalid gacha table', v.errors)
  return ctx
}

// ───────────── 추첨 도구 ─────────────

export function pickWeighted<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0)
  if (items.length === 0 || total <= 0) throw new EngineError('pickWeighted: nothing to pick')
  let r = rng.int(total)
  for (const t of items) {
    r -= weight(t)
    if (r < 0) return t
  }
  return items[items.length - 1]!
}

const champWeight = (ctx: GachaContext, id: string) => ctx.table.champWeights[id] ?? 1
const champsOfRarity = (ctx: GachaContext, rarity: string) =>
  Object.values(ctx.catalog).filter((c) => c.rarity === rarity)

/** 구간 추첨 → 구간 안 균등. 정수 범위 [min, max] */
function rollRanged(ctx: GachaContext, rng: Rng, range: StatRange): number {
  const tier = pickWeighted(rng, ctx.table.statTiers, (t: StatTier) => t.weight)
  const u = rng.range(tier.fromBp, tier.toBp - 1)
  const span = range.max - range.min
  return Math.min(range.max, range.min + Math.floor((u * (span + 1)) / BP))
}

function rollStats(ctx: GachaContext, rng: Rng, champ: ChampTemplate): Stats {
  const s = {} as Stats
  for (const k of STAT_KEYS) s[k] = rollRanged(ctx, rng, champ.statRanges[k]) // 소비 순서 고정
  return s
}

function rollOverrides(ctx: GachaContext, rng: Rng, champ: ChampTemplate): Partial<UnitInstance> {
  if (!ctx.config.rerollMovementAndRange) return {}
  const out: Partial<UnitInstance> = {}
  if (champ.moveRangeRange) out.moveRangeOverride = rollRanged(ctx, rng, champ.moveRangeRange)
  if (champ.attackRangeRange) out.attackRangeOverride = rollRanged(ctx, rng, champ.attackRangeRange)
  return out
}

/** 슬롯별로: 이미 붙은 종류·회복 계열 제한에 걸리는 종류를 빼고 가중치 재분배 */
function rollSpecials(ctx: GachaContext, rng: Rng, champ: ChampTemplate, keep: (Special | null)[]): Special[] {
  const out = [...keep]
  for (let i = 0; i < champ.specialSlots; i++) {
    if (out[i]) continue
    const taken = out.filter((s): s is Special => !!s).map((s) => s.kind)
    const candidates = allowedSpecialKinds(ctx, taken)
    const kind = pickWeighted(rng, candidates, (k) => ctx.table.specials[k].weight)
    const rule = ctx.table.specials[kind]
    const steps = Math.floor((rule.max - rule.min) / rule.step)
    out[i] = { kind, value: rule.min + rng.int(steps + 1) * rule.step }
  }
  return out as Special[]
}

export function allowedSpecialKinds(ctx: GachaContext, taken: readonly SpecialKind[]): SpecialKind[] {
  const heals = taken.filter((k) => HEAL_SPECIALS.includes(k)).length
  return SPECIAL_KINDS.filter(
    (k) =>
      !taken.includes(k) &&
      ctx.table.specials[k].weight > 0 &&
      !(HEAL_SPECIALS.includes(k) && heals >= ctx.config.maxHealSpecialsPerUnit),
  )
}

function newUnitId(rng: Rng): string {
  const h = (n: number) => n.toString(16).padStart(8, '0')
  return `u-${h(rng.nextU32())}${h(rng.nextU32())}`
}

// ───────────── 개체 생성 · 뽑기 ─────────────

/** 특정 챔프의 새 개체 (개발용 지급, AI 덱 생성에도 사용) */
export function createUnit(ctx: GachaContext, champId: string, rngState: RngState, now: number) {
  const rng = new Rng(rngState)
  const unit = createUnitWith(ctx, rng, champId, now)
  return { unit, rng: rng.state() }
}

function createUnitWith(ctx: GachaContext, rng: Rng, champId: string, now: number): UnitInstance {
  const champ = ctx.catalog[champId]
  if (!champ) throw new EngineError(`Unknown champ ${champId}`)
  const id = newUnitId(rng)
  const stats = rollStats(ctx, rng, champ)
  const overrides = rollOverrides(ctx, rng, champ)
  const specials = rollSpecials(ctx, rng, champ, Array(champ.specialSlots).fill(null))
  return { id, champId, stats, specials, createdAt: now, rerollCount: 0, ...overrides }
}

/** 뽑기: 등급 → 등급 안 챔프 → 개체 생성 */
export function pull(ctx: GachaContext, rngState: RngState, count: number, now: number) {
  if (!Number.isInteger(count) || count < 1) throw new EngineError('pull count must be >= 1')
  const rng = new Rng(rngState)
  const units: UnitInstance[] = []
  for (let i = 0; i < count; i++) {
    const rarity = pickWeighted(
      rng,
      ctx.table.rarities.filter((r) => champsOfRarity(ctx, r.id).length > 0),
      (r) => r.weight,
    )
    const champ = pickWeighted(rng, champsOfRarity(ctx, rarity.id), (c) => champWeight(ctx, c.id))
    units.push(createUnitWith(ctx, rng, champ.id, now))
  }
  return { units, rng: rng.state() }
}

export function pullCost(ctx: GachaContext, count: 1 | 10): Cost {
  return count === 10 ? { ...ctx.table.costs.pull10 } : { ...ctx.table.costs.pull1 }
}

// ───────────── 리롤 ─────────────

export interface RerollLocks {
  stats: StatKey[]
  /** 특수능력 슬롯 잠금 — 구조만 열어둠 (config.maxSpecialLocks = 0 이면 거부) */
  specialSlots?: number[]
}

export function validateLocks(ctx: GachaContext, unit: UnitInstance, locks: RerollLocks): Validation {
  const errors: string[] = []
  const champ = ctx.catalog[unit.champId]
  if (!champ) errors.push(`unknown champ ${unit.champId}`)
  if (new Set(locks.stats).size !== locks.stats.length) errors.push('duplicate stat lock')
  if (locks.stats.some((k) => !STAT_KEYS.includes(k))) errors.push('unknown stat lock')
  if (locks.stats.length > ctx.config.maxStatLocks) errors.push(`at most ${ctx.config.maxStatLocks} stat locks`)
  const slots = locks.specialSlots ?? []
  if (slots.length > ctx.config.maxSpecialLocks) errors.push(`at most ${ctx.config.maxSpecialLocks} special locks`)
  if (champ && slots.some((i) => !Number.isInteger(i) || i < 0 || i >= champ.specialSlots)) errors.push('bad special slot')
  return validation(errors)
}

export function rerollCost(ctx: GachaContext, locks: RerollLocks): Cost {
  const n = locks.stats.length + (locks.specialSlots?.length ?? 0)
  const mult = ctx.table.lockMultiplier[n]
  if (mult === undefined) throw new EngineError(`no lock multiplier for ${n} locks`)
  const out: Cost = {}
  for (const [k, v] of Object.entries(ctx.table.costs.reroll)) out[k as keyof Cost] = v * mult
  return out
}

/**
 * 리롤: 일반 능력치 + 특수능력을 다시 돌려 덮어씀. 잠근 능력치는 유지.
 * id·챔프·생성일은 유지, 이동거리·사거리·슬롯 수는 챔프 고정이라 변하지 않음.
 * 잠금 여부와 무관하게 능력치 난수는 항상 같은 개수를 소비 (잠금이 이후 결과를 흔들지 않게).
 */
export function reroll(ctx: GachaContext, unit: UnitInstance, locks: RerollLocks, rngState: RngState) {
  const v = validateLocks(ctx, unit, locks)
  if (!v.ok) throw new EngineError('Invalid reroll locks', v.errors)
  const champ = ctx.catalog[unit.champId]!
  const rng = new Rng(rngState)

  const rolled = rollStats(ctx, rng, champ)
  const stats = { ...rolled }
  for (const k of locks.stats) stats[k] = unit.stats[k]
  const overrides = rollOverrides(ctx, rng, champ)

  const keep = Array.from({ length: champ.specialSlots }, (_, i) =>
    locks.specialSlots?.includes(i) ? (unit.specials[i] ?? null) : null,
  )
  const specials = rollSpecials(ctx, rng, champ, keep)

  const after: UnitInstance = {
    ...unit,
    stats,
    specials,
    rerollCount: unit.rerollCount + 1,
    ...overrides,
  }
  return { before: unit, after, rng: rng.state() }
}

// ───────────── 검증 ─────────────

const inRange = (v: number, r: StatRange) => Number.isInteger(v) && v >= r.min && v <= r.max

/** 개체가 규칙상 가능한 값인지 (불러오기·서버 수신 시 사용) */
export function validateUnit(ctx: GachaContext, unit: UnitInstance): Validation {
  const errors: string[] = []
  const champ = ctx.catalog[unit.champId]
  if (!champ) return validation([`unknown champ ${unit.champId}`])
  for (const k of STAT_KEYS) if (!inRange(unit.stats[k], champ.statRanges[k])) errors.push(`${k} out of range`)
  if (unit.specials.length !== champ.specialSlots) errors.push('special slot count mismatch')
  const kinds = unit.specials.map((s) => s.kind)
  if (new Set(kinds).size !== kinds.length) errors.push('duplicate special')
  if (kinds.filter((k) => HEAL_SPECIALS.includes(k)).length > ctx.config.maxHealSpecialsPerUnit)
    errors.push('too many heal specials')
  for (const s of unit.specials) {
    const r = ctx.table.specials[s.kind]
    if (!r) errors.push(`unknown special ${s.kind}`)
    else if (s.value < r.min || s.value > r.max || (s.value - r.min) % r.step !== 0) errors.push(`${s.kind} value out of range`)
  }
  const hasOverride = unit.moveRangeOverride !== undefined || unit.attackRangeOverride !== undefined
  if (hasOverride && !ctx.config.rerollMovementAndRange) errors.push('range override not allowed')
  return validation(errors)
}

export function validateGachaContext(ctx: GachaContext): Validation {
  const errors: string[] = []
  const t = ctx.table
  if (t.rarities.every((r) => r.weight <= 0)) errors.push('no rarity weight')
  for (const c of Object.values(ctx.catalog)) {
    if (!t.rarities.some((r) => r.id === c.rarity)) errors.push(`${c.id}: rarity ${c.rarity} not in table`)
    if (allowedSpecialKindsMax(ctx) < c.specialSlots) errors.push(`${c.id}: too many special slots`)
    for (const k of STAT_KEYS) if (c.statRanges[k].min > c.statRanges[k].max) errors.push(`${c.id}: bad ${k} range`)
  }
  // 구간은 0..10000 을 빈틈없이 덮어야 함
  const tiers = [...t.statTiers].sort((a, b) => a.fromBp - b.fromBp)
  let cur = 0
  for (const tier of tiers) {
    if (tier.fromBp !== cur || tier.toBp <= tier.fromBp) errors.push(`stat tier ${tier.label} gap/overlap`)
    cur = tier.toBp
  }
  if (cur !== BP) errors.push('stat tiers must end at 10000')
  if (t.lockMultiplier.length < ctx.config.maxStatLocks + ctx.config.maxSpecialLocks + 1)
    errors.push('lockMultiplier too short')
  return validation(errors)
}

/** 한 유닛에 붙을 수 있는 서로 다른 특수능력 최대 수 */
function allowedSpecialKindsMax(ctx: GachaContext): number {
  const nonHeal = SPECIAL_KINDS.filter((k) => !HEAL_SPECIALS.includes(k) && ctx.table.specials[k].weight > 0).length
  const heal = SPECIAL_KINDS.filter((k) => HEAL_SPECIALS.includes(k) && ctx.table.specials[k].weight > 0).length
  return nonHeal + Math.min(heal, ctx.config.maxHealSpecialsPerUnit)
}

// ───────────── 확률 공개 (확률표에서 자동 생성) ─────────────

export interface TableDescription {
  rarities: { id: string; label: string; probability: number }[]
  champs: { id: string; name: string; rarity: string; probability: number }[]
  statTiers: { label: string; range: string; probability: number }[]
  specials: { kind: SpecialKind; probability: number; min: number; max: number; step: number }[]
  rules: string[]
  costs: GachaTable['costs']
  lockMultiplier: readonly number[]
}

/** 확률 정보 화면 데이터. 실제 추첨과 같은 표·같은 필터(빈 등급 제외)를 사용한다 */
export function describeTable(ctx: GachaContext): TableDescription {
  const t = ctx.table
  const rar = t.rarities.filter((r) => r.weight > 0 && champsOfRarity(ctx, r.id).length > 0)
  const rTotal = rar.reduce((s, r) => s + r.weight, 0)
  const champs = rar.flatMap((r) => {
    const cs = champsOfRarity(ctx, r.id)
    const cTotal = cs.reduce((s, c) => s + champWeight(ctx, c.id), 0)
    return cs.map((c) => ({
      id: c.id,
      name: c.name,
      rarity: r.id,
      probability: (r.weight / rTotal) * (champWeight(ctx, c.id) / cTotal),
    }))
  })
  const tTotal = t.statTiers.reduce((s, x) => s + x.weight, 0)
  const sTotal = SPECIAL_KINDS.reduce((s, k) => s + t.specials[k].weight, 0)
  return {
    rarities: rar.map((r) => ({ id: r.id, label: r.label, probability: r.weight / rTotal })),
    champs,
    statTiers: t.statTiers.map((x) => ({
      label: x.label,
      range: `챔프 범위의 ${x.fromBp / 100}% ~ ${x.toBp / 100}%`,
      probability: x.weight / tTotal,
    })),
    specials: SPECIAL_KINDS.map((k) => ({
      kind: k,
      probability: t.specials[k].weight / sTotal,
      min: t.specials[k].min,
      max: t.specials[k].max,
      step: t.specials[k].step,
    })),
    rules: [
      '뽑기: 등급을 먼저 정한 뒤, 그 등급 챔프 중에서 정합니다.',
      '일반 능력치(체력·공격력·방어력)는 각각 구간을 먼저 정한 뒤, 구간 안에서 균등하게 정합니다.',
      '특수능력은 슬롯마다 정하며, 이미 붙은 능력과 제한에 걸리는 능력을 빼고 남은 능력의 비중대로 다시 나눕니다.',
      `회복 계열(자체 회복·공격 시 회복)은 한 유닛에 최대 ${ctx.config.maxHealSpecialsPerUnit}개입니다.`,
      '특수능력 수치는 범위 안에서 균등하게 정합니다.',
      '이동거리·사거리·특수능력 슬롯 수는 챔프마다 고정이며 리롤해도 변하지 않습니다.',
    ],
    costs: t.costs,
    lockMultiplier: t.lockMultiplier,
  }
}
