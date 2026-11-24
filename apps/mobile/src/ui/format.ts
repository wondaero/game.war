import { ABILITIES, dangerDepth } from '@war/v2'
import type { Action, Cost, CurrencyId, GameEvent, GameState, StatKey, UnitId, UnitInstance, V2Config } from '@war/v2'

export const pct = (bp: number) => `${Math.round(bp / 100)}%`

/** 그림 8종 (성능 무관, 임시 그림) */
export const IMAGE_INFO: Record<string, { emoji: string; name: string; color: string }> = {
  img1: { emoji: '🐺', name: '늑대', color: '#90a4ae' },
  img2: { emoji: '🦊', name: '여우', color: '#ff8a65' },
  img3: { emoji: '🐻', name: '곰', color: '#a1887f' },
  img4: { emoji: '🦅', name: '매', color: '#ffd54f' },
  img5: { emoji: '🐍', name: '뱀', color: '#81c784' },
  img6: { emoji: '🦁', name: '사자', color: '#ffb74d' },
  img7: { emoji: '🐢', name: '거북', color: '#4db6ac' },
  img8: { emoji: '🐰', name: '토끼', color: '#f48fb1' },
}
export const imageOf = (image: string) => IMAGE_INFO[image] ?? { emoji: '❔', name: image, color: '#888' }

export const STAT_LABEL: Record<StatKey, string> = { atk: '공격력', armor: '방어력', hp: '체력', move: '이동', range: '사거리' }
export const CURRENCY_LABEL: Record<CurrencyId, string> = { gem: '보석', rerollStone: '리롤석' }

export function costText(c: Cost): string {
  return (
    Object.entries(c)
      .map(([k, v]) => `${CURRENCY_LABEL[k as CurrencyId] ?? k} ${v}`)
      .join(' · ') || '무료'
  )
}

/** 능력 짧은 이름 (없으면 null) */
export const abilityName = (u: UnitInstance) => (u.ability ? ABILITIES[u.ability.kind].name : null)

/** 판 좌표 → a1 형식 (열 a~f, 행 1~6 = 위에서부터) */
export const cellName = (p: { x: number; y: number }) => `${String.fromCharCode(97 + p.x)}${p.y + 1}`

export function unitName(state: GameState, id: UnitId): string {
  const u = state.units[id]
  if (!u) return id
  return `${u.owner === 'A' ? '내' : '적'} ${imageOf(u.inst.image).name}`
}

export function actionLabel(state: GameState, a: Action): string {
  switch (a.type) {
    case 'wait':
      return '대기'
    case 'move':
      return `${unitName(state, a.unit)} → ${cellName(a.to)}`
    case 'attack':
      return `${unitName(state, a.unit)} 공격 ${a.aim.kind === 'cell' ? cellName(a.aim.pos) : unitName(state, a.aim.id)}`
    case 'skill': {
      const u = state.units[a.unit]
      const name = u?.inst.ability ? ABILITIES[u.inst.ability.kind].name : '능력'
      const target = a.aim ? (a.aim.kind === 'cell' ? ` ${cellName(a.aim.pos)}` : ` ${unitName(state, a.aim.id)}`) : ''
      return `${unitName(state, a.unit)} ${name}${target}`
    }
  }
}

const HEAL_SOURCE = { heal: '회복', areaHeal: '광역 회복', moveRegen: '이동 회복', lifesteal: '흡혈' } as const
const STATUS = { nullified: '다음 행동 무효', slowed: '다음 턴 이동 −1', poisoned: '맹독' } as const
const FIZZLE = { dead: '이미 쓰러짐', nullified: '무효 상태', invalid: '할 수 없는 행동' } as const

export function eventLines(state: GameState, e: GameEvent): string[] {
  const n = (id: UnitId) => unitName(state, id)
  switch (e.type) {
    case 'fizzle':
      return e.action.type === 'wait' ? [] : [`${n(e.action.unit)} 행동 취소 (${FIZZLE[e.reason]})`]
    case 'move':
      return [`${n(e.unit)} 이동 ${cellName(e.from)} → ${cellName(e.to)}`]
    case 'moveBlocked':
      return [`${n(e.unit)} 이동 실패 (${cellName(e.to)} 칸이 막힘)`]
    case 'attack':
      if (e.hits.length === 0) return [`${n(e.unit)} 공격 — 빗나감`]
      return e.hits.map((h) => `${n(e.unit)} → ${n(h.target)} ${h.damage} 피해`)
    case 'heal':
      return [`${n(e.unit)} ${HEAL_SOURCE[e.source]} +${e.amount}`]
    case 'buff':
      return [`${n(e.unit)} ${ABILITIES[e.kind].name} 사용`]
    case 'reflect':
      return [`  ↩ ${n(e.from)} 반사 ${e.damage} → ${n(e.to)}`]
    case 'status':
      return [`  ${n(e.unit)}: ${STATUS[e.status]}`]
    case 'poisonTick':
      return [`${n(e.unit)} 맹독 −${e.damage}`]
    case 'zoneDamage':
      return [`${n(e.unit)} 위험지대 −${e.damage}`]
    case 'death':
      return [`${n(e.unit)} 쓰러짐`]
    case 'gameOver':
      return [e.result.winner === 'draw' ? '무승부' : e.result.winner === 'A' ? '승리!' : '패배']
  }
}

/** 위험지대 안내 문구 */
export function dangerNotice(cfg: V2Config, turn: number): string | null {
  if (cfg.dangerZoneStartTurn <= 0) return null
  const d = dangerDepth(cfg, turn)
  const pctText = pct(cfg.dangerZoneDamageBp)
  if (d === 0) {
    const left = cfg.dangerZoneStartTurn - turn
    return left <= 3 ? `⚠ ${left}턴 뒤부터 맨 뒷줄이 위험지대 (턴 끝 최대 체력 ${pctText} 피해)` : null
  }
  const next = d < cfg.dangerZoneMaxDepth ? ` · ${cfg.dangerZoneStartTurn + d * cfg.dangerZoneGrowEveryTurns}턴부터 ${d + 1}줄` : ''
  return `⚠ 위험지대 뒷줄 ${d}줄: 턴 끝 최대 체력 ${pctText} 피해${next}`
}
