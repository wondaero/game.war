import type { UnitInstance } from '@war/engine'
import { gachaCtx } from '../services.ts'
import { ROLE_LABEL, SPECIAL_LABEL, specialText } from './format.ts'

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
  const c = gachaCtx.catalog[unit.champId]!
  return (
    <button
      className={`unit-row rarity-${c.rarity} role-${c.role} ${selected ? 'on' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <div className="ur-head">
        <b>{c.name}</b>
        <span className="tag">
          {c.rarity} · {ROLE_LABEL[c.role]}
        </span>
        {badge && <span className="badge">{badge}</span>}
      </div>
      <div className="ur-stats">
        체력 {unit.stats.hp} · 공격력 {unit.stats.atk} · 방어력 {unit.stats.armor}
      </div>
      <div className="ur-specials">
        {unit.specials.map((s, i) => (
          <span key={i} title={specialText(s)}>
            {SPECIAL_LABEL[s.kind]} {specialText(s).match(/\d+%?/)?.[0]}
          </span>
        ))}
      </div>
    </button>
  )
}
