import { isDangerCell, posKey, zoneOf, type GameState, type Pos, type UnitId, type UnitState } from '@war/engine'
import { ROLE_LABEL } from './format.ts'

export type CellMark = 'move' | 'aim' | 'path' | 'impact' | 'deploy' | 'flash' | 'danger' | 'dangerSoon'

export interface FloatLabel {
  text: string
  kind: 'damage' | 'shield' | 'reflected' | 'heal' | 'zone'
}

interface Props {
  state: GameState
  units: Record<UnitId, UnitState>
  marks?: Map<string, CellMark[]>
  selected?: UnitId | null
  /** 행동이 이미 배정된 유닛 (흐리게) */
  used?: Set<UnitId>
  floats?: Map<UnitId, FloatLabel[]>
  onCell?: (p: Pos) => void
}

export function Board({ state, units, marks, selected, used, floats, onCell }: Props) {
  const { boardWidth: W, boardHeight: H } = state.config
  const cells: Pos[] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells.push({ x, y })

  return (
    <div className="board" style={{ aspectRatio: `${W} / ${H}` }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
        {cells.map((p) => {
          const zone = zoneOf(state.config, p)
          const m = marks?.get(posKey(p)) ?? []
          return (
            <button
              key={posKey(p)}
              className={['cell', `zone-${zone}`, ...m.map((k) => `mark-${k}`)].join(' ')}
              onClick={() => onCell?.(p)}
            />
          )
        })}
      </div>
      {Object.values(units).map((u) => {
        const t = state.catalog[u.instance.champId]!
        const hpPct = Math.max(0, u.hp) / u.instance.stats.hp
        return (
          <div
            key={u.id}
            className={[
              'unit',
              `side-${u.owner}`,
              `role-${t.role}`,
              u.alive ? '' : 'dead',
              selected === u.id ? 'selected' : '',
              used?.has(u.id) ? 'used' : '',
            ].join(' ')}
            style={{
              left: `${(u.pos.x / W) * 100}%`,
              top: `${(u.pos.y / H) * 100}%`,
              width: `${100 / W}%`,
              height: `${100 / H}%`,
            }}
            onClick={() => onCell?.(u.pos)}
          >
            <div className="unit-inner">
              <div className="unit-name">{t.name}</div>
              <div className="unit-role">{ROLE_LABEL[t.role]}</div>
              <div className="hpbar">
                <div className="hpfill" style={{ width: `${hpPct * 100}%` }} />
              </div>
              <div className="unit-hp">
                {Math.max(0, u.hp)}/{u.instance.stats.hp}
                {u.shield > 0 && <span className="unit-shield"> +{u.shield}</span>}
              </div>
            </div>
            {(floats?.get(u.id) ?? []).map((f, i) => (
              <div key={i} className={`float float-${f.kind}`} style={{ animationDelay: `${i * 120}ms` }}>
                {f.text}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function addMark(marks: Map<string, CellMark[]>, p: Pos, m: CellMark) {
  const k = posKey(p)
  const arr = marks.get(k) ?? []
  if (!arr.includes(m)) arr.push(m)
  marks.set(k, arr)
}

/** 위험지대 표시: 이번 턴 끝 위험(빨강), 다음 턴부터 위험(주황 점선) */
export function addDangerMarks(marks: Map<string, CellMark[]>, state: GameState, turn: number) {
  const cfg = state.config
  for (let y = 0; y < cfg.boardHeight; y++)
    for (let x = 0; x < cfg.boardWidth; x++) {
      const p = { x, y }
      const side = zoneOf(cfg, p)
      if (side === 'neutral') continue
      if (isDangerCell(cfg, turn, side, p)) addMark(marks, p, 'danger')
      else if (isDangerCell(cfg, turn + 1, side, p)) addMark(marks, p, 'dangerSoon')
    }
}
