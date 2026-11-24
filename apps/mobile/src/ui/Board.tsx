import { inZone, isDangerCell, maxHp, posKey, type Pos, type UnitId, type UnitState, type V2Config } from '@war/v2'
import { cellName, imageOf } from './format.ts'

export type CellMark =
  | 'move'
  | 'aim'
  | 'impact'
  | 'heal'
  | 'deploy'
  | 'flash'
  | 'origin'
  | 'danger'
  | 'dangerSoon'

export interface FloatLabel {
  text: string
  kind: 'damage' | 'reflected' | 'heal' | 'zone' | 'status'
}

interface Props {
  cfg: V2Config
  units: Record<UnitId, UnitState>
  turn: number
  marks?: Map<string, CellMark[]>
  selected?: UnitId | null
  /** 행동이 이미 배정된 유닛 (흐리게) */
  used?: Set<UnitId>
  floats?: Map<UnitId, FloatLabel[]>
  onCell?: (p: Pos) => void
}

export function Board({ cfg, units, turn, marks, selected, used, floats, onCell }: Props) {
  const { boardWidth: W, boardHeight: H } = cfg
  const cells: Pos[] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells.push({ x, y })

  return (
    <div className="board" style={{ aspectRatio: `${W} / ${H}` }}>
      <div className="grid" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
        {cells.map((p) => {
          const zone = inZone(cfg, 'A', p) ? 'A' : 'B'
          const m = marks?.get(posKey(p)) ?? []
          return (
            <button
              key={posKey(p)}
              className={['cell', `zone-${zone}`, ...m.map((k) => `mark-${k}`)].join(' ')}
              onClick={() => onCell?.(p)}
            >
              <span className="cell-name">{cellName(p)}</span>
            </button>
          )
        })}
      </div>
      {Object.values(units).map((u) => {
        const img = imageOf(u.inst.image)
        const max = maxHp(u, turn)
        const hpPct = Math.max(0, Math.min(1, Math.max(0, u.hp) / max))
        const icons = [
          u.inst.ability ? '✦' : '',
          u.nullified ? '⛔' : '',
          u.slowTurn === turn ? '🐌' : '',
          u.poison.some((p) => p.untilTurn >= turn) ? '☠' : '',
          u.buffs.some((b) => b.untilTurn >= turn) ? '⬆' : '',
        ].join('')
        return (
          <div
            key={u.id}
            className={[
              'unit',
              `side-${u.owner}`,
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
              <div className="unit-emoji">{img.emoji}</div>
              {icons && <div className="unit-icons">{icons}</div>}
              <div className="hpbar">
                <div className="hpfill" style={{ width: `${hpPct * 100}%` }} />
              </div>
              <div className="unit-hp">{Math.max(0, u.hp)}</div>
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

/** 위험지대 표시: 이번 턴 끝 위험(빨강), 다음 턴부터 위험(주황 테두리) */
export function addDangerMarks(marks: Map<string, CellMark[]>, cfg: V2Config, turn: number) {
  for (let y = 0; y < cfg.boardHeight; y++)
    for (let x = 0; x < cfg.boardWidth; x++) {
      const p = { x, y }
      const side = inZone(cfg, 'A', p) ? 'A' : 'B'
      if (isDangerCell(cfg, turn, side, p)) addMark(marks, p, 'danger')
      else if (isDangerCell(cfg, turn + 1, side, p)) addMark(marks, p, 'dangerSoon')
    }
}
