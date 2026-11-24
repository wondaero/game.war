import { inZone, isDangerCell, maxHp, posKey, type Pos, type Side, type UnitId, type UnitState, type V2Config } from '@war/v2'
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

/** 재생 효과: from → to 로 포물선을 그리며 날아가는 투사체 */
export interface Projectile {
  from: Pos
  to: Pos
  kind: 'attack' | 'heal'
  side: Side
}

/** 투사체 비행 시간 (착탄 후 칸 표시·숫자가 뜸) */
export const FLIGHT_MS = 520

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
  /** 투사체 효과 (있으면 칸 표시·숫자는 착탄 뒤에 나타남) */
  projectiles?: Projectile[]
  /** 바뀌면 투사체 효과를 처음부터 다시 재생 (유닛 이동 애니메이션은 유지) */
  fxKey?: string | number
  onCell?: (p: Pos) => void
}

export function Board({ cfg, units, turn, marks, selected, used, floats, projectiles, fxKey, onCell }: Props) {
  const fx = !!projectiles?.length
  const { boardWidth: W, boardHeight: H } = cfg
  const cells: Pos[] = []
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cells.push({ x, y })

  return (
    <div className={`board${fx ? ' fx-delay' : ''}`} style={{ aspectRatio: `${W} / ${H}` }}>
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
              <div key={i} className={`float float-${f.kind}`} style={{ animationDelay: `${(fx ? FLIGHT_MS : 0) + i * 120}ms` }}>
                {f.text}
              </div>
            ))}
          </div>
        )
      })}
      {fx && <ProjectileLayer key={fxKey} W={W} H={H} items={projectiles!} />}
    </div>
  )
}

const FX_COLOR = { A: '#64b5f6', B: '#ff8a65', heal: '#69f0ae' } as const

/**
 * 포물선 투사체 (위에서 내려다보는 판이라 높이는 크기·그림자로 표현).
 * 공: 위로 휘는 곡선을 따라가며 커졌다 작아짐 / 그림자: 바닥을 직선으로 / 착탄: 퍼지는 원.
 * SVG 애니메이션은 요소가 붙는 순간 시작 → 프레임마다 새로 그리면 다시 재생된다.
 */
function ProjectileLayer({ W, H, items }: { W: number; H: number; items: Projectile[] }) {
  const dur = `${FLIGHT_MS}ms`
  return (
    <svg className="fx-layer" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      {items.map((p, i) => {
        const fx = p.from.x + 0.5
        const fy = p.from.y + 0.5
        const tx = p.to.x + 0.5
        const ty = p.to.y + 0.5
        const dist = Math.hypot(tx - fx, ty - fy)
        // 곡선 꼭대기: 가운데에서 화면 위쪽으로 (거리에 비례), 세로로 쏠 때도 휘어 보이게 옆으로 조금
        const cx = (fx + tx) / 2 + (fx === tx ? 0.35 * Math.min(2, dist) * (p.side === 'A' ? 1 : -1) : 0)
        const cy = (fy + ty) / 2 - (0.6 + dist * 0.35)
        const arc = `M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}`
        const color = p.kind === 'heal' ? FX_COLOR.heal : FX_COLOR[p.side]
        return (
          <g key={i}>
            <ellipse rx={0.13} ry={0.06} fill="rgba(0,0,0,0.45)">
              <animateMotion dur={dur} path={`M ${fx} ${fy} L ${tx} ${ty}`} fill="freeze" />
              <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.9;1" dur={dur} fill="freeze" />
            </ellipse>
            <g>
              <animateMotion dur={dur} path={arc} fill="freeze" />
              <circle r={0.12} fill={color} stroke="#fff" strokeWidth={0.03}>
                <animate attributeName="r" values="0.1;0.22;0.1" dur={dur} fill="freeze" />
                <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.9;1" dur={dur} fill="freeze" />
              </circle>
            </g>
            <circle cx={tx} cy={ty} r={0} fill="none" stroke={color} strokeWidth={0.06} opacity={0}>
              <animate attributeName="r" values="0;0.55" begin={dur} dur="280ms" fill="freeze" />
              <animate attributeName="opacity" values="1;0" begin={dur} dur="280ms" fill="freeze" />
            </circle>
          </g>
        )
      })}
    </svg>
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
