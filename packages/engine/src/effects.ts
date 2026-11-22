import { BP } from './config.ts'
import { manhattan } from './board.ts'
import type { ChampTemplate, Condition, EffectTrigger, Stats, UnitState } from './types.ts'

/**
 * 챔프 고유 효과(데이터 정의)의 인터프리터.
 * 공격 판정 1건 안에서만 평가되며 이번 판정에만 쓰는 임시 수치를 만든다.
 * (MVP 챔프는 고유 효과 없음 — 확장 지점으로 유지)
 */
export interface EffectContext {
  self: UnitState
  selfChamp: ChampTemplate
  other: UnitState
  otherChamp: ChampTemplate
}

export function evalCondition(c: Condition, ctx: EffectContext): boolean {
  switch (c.kind) {
    case 'always':
      return true
    case 'otherRole':
      return ctx.otherChamp.role === c.role
    case 'otherTrajectory':
      return ctx.otherChamp.trajectory.kind === c.trajectory
    case 'selfHpBelowBp':
      return ctx.self.hp * BP < ctx.self.instance.stats.hp * c.bp
    case 'otherHpBelowBp':
      return ctx.other.hp * BP < ctx.other.instance.stats.hp * c.bp
    case 'distanceAtLeast':
      return manhattan(ctx.self.pos, ctx.other.pos) >= c.distance
    case 'and':
      return c.all.every((x) => evalCondition(x, ctx))
    case 'or':
      return c.any.some((x) => evalCondition(x, ctx))
    case 'not':
      return !evalCondition(c.cond, ctx)
  }
}

export interface ModifiedStats {
  stats: Stats
  /** 기본 피해 배율 (bp, 곱연산 누적) */
  damageBp: number
  applied: string[]
}

export function applyEffects(trigger: EffectTrigger, ctx: EffectContext): ModifiedStats {
  const stats: Stats = { ...ctx.self.instance.stats }
  let damageBp = BP
  const applied: string[] = []
  for (const def of ctx.selfChamp.effects ?? []) {
    if (def.trigger !== trigger || !evalCondition(def.condition, ctx)) continue
    const e = def.effect
    switch (e.kind) {
      case 'modStat':
        stats[e.stat] += e.add
        break
      case 'damageBp':
        damageBp = Math.floor((damageBp * e.bp) / BP)
        break
    }
    applied.push(def.id)
  }
  return { stats, damageBp, applied }
}
