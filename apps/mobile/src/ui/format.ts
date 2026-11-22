import { dangerDepth } from '@war/engine'
import type {
  Action,
  GameConfig,
  ChampTemplate,
  Cost,
  CurrencyId,
  Dir,
  GameState,
  Role,
  Special,
  SpecialKind,
  StatKey,
  StepEvent,
  Trajectory,
  UnitId,
} from '@war/engine'

export const pct = (bp: number) => `${Math.round(bp / 100)}%`

export const ROLE_LABEL: Record<Role, string> = { attack: '공격', defense: '방어', support: '지원' }
export const STAT_LABEL: Record<StatKey, string> = { hp: '체력', atk: '공격력', armor: '방어력' }
export const SPECIAL_LABEL: Record<SpecialKind, string> = {
  regen: '자체 회복',
  shield: '데미지 흡수',
  reflect: '데미지 반사',
  lifesteal: '공격 시 회복',
}
export const CURRENCY_LABEL: Record<CurrencyId, string> = { gem: '보석', rerollStone: '리롤석' }

export function specialText(s: Special): string {
  switch (s.kind) {
    case 'regen':
      return `턴 끝 체력 +${s.value}`
    case 'shield':
      return `보호막 ${s.value}`
    case 'reflect':
      return `받은 피해 ${pct(s.value)} 반사`
    case 'lifesteal':
      return `준 피해 ${pct(s.value)} 회복`
  }
}

export function costText(c: Cost): string {
  return (
    Object.entries(c)
      .map(([k, v]) => `${CURRENCY_LABEL[k as CurrencyId]} ${v}`)
      .join(' · ') || '무료'
  )
}

export function trajectoryLabel(t: Trajectory): string {
  switch (t.kind) {
    case 'straight':
      return `직사 · 사거리 ${t.range}`
    case 'diagonal':
      return `대각 · 사거리 ${t.range}`
    case 'lob':
      return `곡사 · 사거리 ${t.minRange}~${t.maxRange}`
    case 'area':
      return `범위 · 사거리 ${t.range} · 피해 ${pct(t.damageBp)}`
  }
}

export const DIR_LABEL: Record<Dir, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  upLeft: '↖',
  upRight: '↗',
  downLeft: '↙',
  downRight: '↘',
}

export function champOfUnit(state: GameState, id: UnitId): ChampTemplate | undefined {
  const u = state.units[id]
  return u ? state.catalog[u.instance.champId] : undefined
}

export function unitName(state: GameState, id: UnitId): string {
  const u = state.units[id]
  if (!u) return id
  return `${u.owner === 'A' ? '내' : '적'} ${champOfUnit(state, id)?.name ?? id}`
}

export function actionLabel(state: GameState, a: Action): string {
  switch (a.type) {
    case 'wait':
      return '대기'
    case 'move':
      return `${unitName(state, a.unit)} 이동 (${a.to.x + 1},${a.to.y + 1})`
    case 'attack':
      return `${unitName(state, a.unit)} 공격 ${
        a.aim.kind === 'dir' ? DIR_LABEL[a.aim.dir] : `(${a.aim.pos.x + 1},${a.aim.pos.y + 1})`
      }`
  }
}

export function eventLines(state: GameState, e: StepEvent): string[] {
  const n = (id: UnitId) => unitName(state, id)
  switch (e.type) {
    case 'wait':
    case 'damage':
      return []
    case 'fizzle':
      return [
        `${e.action.type !== 'wait' ? n(e.action.unit) : e.side} 행동 무효 (${
          e.reason === 'unitDead' ? '이미 쓰러짐' : '불가능한 행동'
        })`,
      ]
    case 'move':
      return [`${n(e.unit)} 이동`]
    case 'moveBlocked':
      return [`${n(e.unit)} 이동 실패 (${e.reason === 'collision' ? '같은 칸 충돌' : '칸이 막힘'})`]
    case 'attack': {
      if (e.hits.length === 0) return [`${n(e.unit)} 공격 — ${e.blockedBy ? '아군에 막힘' : '빗나감'}`]
      return e.hits.flatMap((h) => {
        const parts = [`${n(h.attacker)} → ${n(h.target)} ${h.afterArmor} 피해`]
        if (h.base !== h.afterArmor) parts.push(`(방어력 −${h.base - h.afterArmor})`)
        if (h.absorbed) parts.push(`보호막 흡수 ${h.absorbed}`)
        const lines = [parts.join(' ')]
        if (h.reflect) lines.push(`  ↩ 반사 ${h.reflect.amount} → ${n(h.attacker)}`)
        return lines
      })
    }
    case 'heal':
      return [`${n(e.unit)} ${e.source === 'regen' ? '자체 회복' : '흡혈'} +${e.amount}`]
    case 'zoneDamage':
      return [`${n(e.unit)} 위험지대 피해 −${e.amount}`]
    case 'death':
      return [`${n(e.unit)} 쓰러짐`]
    case 'gameOver':
      return [e.result.winner === 'draw' ? '무승부' : e.result.winner === 'A' ? '승리!' : '패배']
  }
}

/** 위험지대 안내 문구 */
export function dangerNotice(cfg: GameConfig, turn: number): string | null {
  if (cfg.dangerZoneStartTurn <= 0) return null
  const d = dangerDepth(cfg, turn)
  const pctText = pct(cfg.dangerZoneDamageBp)
  if (d === 0) {
    const left = cfg.dangerZoneStartTurn - turn
    return left <= 3 ? `⚠ ${left}턴 뒤부터 뒷줄이 위험지대 (턴 끝 최대 체력 ${pctText})` : null
  }
  const next = d < cfg.dangerZoneMaxDepth ? ` · ${cfg.dangerZoneStartTurn + d * cfg.dangerZoneGrowEveryTurns}턴부터 ${d + 1}줄` : ''
  return `⚠ 위험지대 ${d}줄: 턴 끝 최대 체력 ${pctText} 피해${next}`
}
