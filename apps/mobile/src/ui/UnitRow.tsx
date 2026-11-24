import { abilityInfo, type UnitInstance } from '@war/v2'
import { imageOf } from './format.ts'

export function UnitRow({
  unit,
  onClick,
  selected,
  disabled,
  badge,
}: {
  unit: UnitInstance
  onClick?: () => void
  selected?: boolean
  disabled?: boolean
  badge?: string
}) {
  const img = imageOf(unit.image)
  const ab = abilityInfo(unit)
  const s = unit.stats
  return (
    <button
      className={`unit-row ${ab ? 'has-ability' : ''} ${selected ? 'on' : ''}`}
      style={{ borderLeftColor: img.color }}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="ur-head">
        <span className="ci-emoji">{img.emoji}</span>
        <b>{img.name}</b>
        {ab && <span className="tag ability">✦ {ab.name}</span>}
        {badge && <span className="badge">{badge}</span>}
      </div>
      <div className="ur-stats">
        공 {s.atk} · 방 {s.armor} · 체 {s.hp} · 이동 {s.move} · 사거리 {s.range}
      </div>
    </button>
  )
}
