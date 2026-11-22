import { moveRangeOf, trajectoryOf, type ChampTemplate, type UnitInstance } from '@war/engine'
import { ROLE_LABEL, SPECIAL_LABEL, specialText, trajectoryLabel } from './format.ts'

/** 유닛 개체 정보 (판 안에서는 현재 체력·보호막도 표시) */
export function CardInfo({
  champ,
  unit,
  hp,
  shield,
}: {
  champ: ChampTemplate
  unit: UnitInstance
  hp?: number
  shield?: number
}) {
  return (
    <div className={`card-info role-${champ.role}`}>
      <div className="ci-head">
        <b>{champ.name}</b> <span className="tag">{ROLE_LABEL[champ.role]} 특화 · {champ.rarity}</span>
      </div>
      <div className="ci-stats">
        <span>
          체력 {hp !== undefined ? `${Math.max(0, hp)}/` : ''}
          {unit.stats.hp}
        </span>
        <span>공격력 {unit.stats.atk}</span>
        <span>방어력 {unit.stats.armor}</span>
        {shield !== undefined && shield > 0 && <span>보호막 {shield}</span>}
      </div>
      <div className="ci-traj">
        이동 {moveRangeOf(champ, unit)} · {trajectoryLabel(trajectoryOf(champ, unit))}
      </div>
      {unit.specials.map((s, i) => (
        <div key={i} className="ci-effect">
          ✦ {SPECIAL_LABEL[s.kind]}: {specialText(s)}
        </div>
      ))}
    </div>
  )
}
