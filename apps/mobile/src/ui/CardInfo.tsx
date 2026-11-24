import { abilityInfo, effArmor, effAtk, effMove, maxHp, type UnitInstance, type UnitState } from '@war/v2'
import { imageOf, STAT_LABEL } from './format.ts'

const USE_LABEL = { attack: '공격 시', skill: '액션', passive: '자동' } as const

/** 유닛 정보. 판 안이면(state) 현재 체력·버프 반영 수치·상태도 표시 */
export function CardInfo({ unit, state, turn }: { unit: UnitInstance; state?: UnitState; turn?: number }) {
  const img = imageOf(unit.image)
  const ab = abilityInfo(unit)
  const t = turn ?? 0
  const val = (base: number, eff: number) => (eff !== base ? `${eff} (${eff > base ? '+' : ''}${eff - base})` : `${base}`)
  return (
    <div className="card-info" style={{ borderLeft: `3px solid ${img.color}` }}>
      <div className="ci-head">
        <span className="ci-emoji">{img.emoji}</span> <b>{img.name}</b>
        {state && <span className="tag">{state.owner === 'A' ? '내 유닛' : '상대 유닛'}</span>}
      </div>
      <div className="ci-stats">
        <span>
          {STAT_LABEL.hp} {state ? `${Math.max(0, state.hp)}/${maxHp(state, t)}` : unit.stats.hp}
        </span>
        <span>
          {STAT_LABEL.atk} {state ? val(unit.stats.atk, effAtk(state, t)) : unit.stats.atk}
        </span>
        <span>
          {STAT_LABEL.armor} {state ? val(unit.stats.armor, effArmor(state, t)) : unit.stats.armor}
        </span>
        <span>
          {STAT_LABEL.move} {state ? val(unit.stats.move, effMove(state, t)) : unit.stats.move}
        </span>
        <span>
          {STAT_LABEL.range} {unit.stats.range}
        </span>
      </div>
      {ab ? (
        <div className="ci-effect">
          ✦ {ab.name} <span className="tag">{USE_LABEL[ab.use]}</span> — {ab.desc}
          {state && ab.use === 'skill' && state.readyTurn > t && <span className="tag"> {state.readyTurn - t}턴 뒤 사용 가능</span>}
        </div>
      ) : (
        <div className="hint">특수능력 없음</div>
      )}
      {state && <StatusLine u={state} turn={t} />}
    </div>
  )
}

function StatusLine({ u, turn }: { u: UnitState; turn: number }) {
  const s: string[] = []
  if (u.nullified) s.push('⛔ 다음 행동 무효')
  if (u.slowTurn === turn) s.push('🐌 이번 턴 이동 −1')
  const psn = u.poison.filter((p) => p.untilTurn >= turn).reduce((a, p) => a + p.damage, 0)
  if (psn) s.push(`☠ 맹독 턴 끝 −${psn}`)
  for (const b of u.buffs) if (b.untilTurn >= turn) s.push(`⬆ ${STAT_LABEL[b.stat]} +${b.amount} (${b.untilTurn}턴까지)`)
  return s.length ? <div className="ci-status">{s.join(' · ')}</div> : null
}
