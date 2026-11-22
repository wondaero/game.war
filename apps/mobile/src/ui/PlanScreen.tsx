import { useEffect, useMemo, useState } from 'react'
import {
  attackPreviews,
  canRepeatActions,
  hitOdds,
  legalMoves,
  padPlan,
  posEq,
  type Action,
  type Aim,
  type AttackPreview,
  type GameState,
  type Pos,
  type TurnPlan,
  type UnitId,
} from '@war/engine'
import { addDangerMarks, addMark, Board, type CellMark } from './Board.tsx'
import { CardInfo } from './CardInfo.tsx'
import { actionLabel, dangerNotice } from './format.ts'

type Mode = 'idle' | 'move' | 'attack'

const aimEq = (a: Aim, b: Aim) =>
  a.kind === 'dir' ? b.kind === 'dir' && a.dir === b.dir : b.kind === 'cell' && posEq(a.pos, b.pos)

export function PlanScreen({
  state,
  deadline,
  onSubmit,
}: {
  state: GameState
  deadline: number
  onSubmit: (p: TurnPlan) => void
}) {
  const cfg = state.config
  const [actions, setActions] = useState<Action[]>([])
  const [sel, setSel] = useState<UnitId | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [preview, setPreview] = useState<AttackPreview | null>(null)
  const [now, setNow] = useState(Date.now())

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  const attacksUsed = actions.filter((a) => a.type === 'attack').length
  const used = new Set(actions.flatMap((a) => (a.type === 'wait' ? [] : [a.unit])))
  const full = actions.length >= cfg.actionsPerTurn

  // 제한시간: 마감 시 입력된 행동까지 자동 제출 (빈 칸은 대기)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (remaining === 0) onSubmit(padPlan(actions, cfg.actionsPerTurn))
  }, [remaining]) // eslint-disable-line react-hooks/exhaustive-deps

  const previews = useMemo(() => (sel && mode === 'attack' ? attackPreviews(state, sel) : []), [state, sel, mode])
  const moves = useMemo(() => (sel && mode === 'move' ? legalMoves(state, sel) : []), [state, sel, mode])

  const marks = new Map<string, CellMark[]>()
  addDangerMarks(marks, state, state.turn)
  if (mode === 'move') for (const p of moves) addMark(marks, p, 'move')
  if (mode === 'attack') {
    for (const p of previews) {
      if (p.aim.kind === 'cell') addMark(marks, p.aim.pos, 'aim')
      else for (const c of p.geometry.path) addMark(marks, c, 'aim')
    }
    if (preview) {
      for (const c of preview.geometry.path) addMark(marks, c, 'path')
      for (const c of preview.geometry.impactCells) addMark(marks, c, 'impact')
    }
  }
  // 이미 입력한 이동의 목적지 표시
  for (const a of actions) if (a.type === 'move') addMark(marks, a.to, 'flash')

  const reset = () => {
    setSel(null)
    setMode('idle')
    setPreview(null)
  }

  const push = (a: Action) => {
    if (full) return
    setActions((xs) => [...xs, a])
    reset()
  }

  const canAct = (id: UnitId) => !used.has(id) || canRepeatActions(state, 'A')

  const onCell = (p: Pos) => {
    if (mode === 'move' && sel && moves.some((m) => posEq(m, p))) return push({ type: 'move', unit: sel, to: p })
    if (mode === 'attack' && sel) {
      // 칸 조준이면 그 칸, 방향 조준이면 그 칸을 지나는 방향
      const hit =
        previews.find((pv) => pv.aim.kind === 'cell' && posEq(pv.aim.pos, p)) ??
        previews.find((pv) => pv.aim.kind === 'dir' && pv.geometry.path.some((c) => posEq(c, p)))
      if (hit) return setPreview(hit)
    }
    const u = Object.values(state.units).find((x) => x.alive && posEq(x.pos, p))
    // 이동·공격 모드 중 잘못된 칸을 눌러도 모드는 유지 (내 다른 카드를 누를 때만 전환)
    if (mode !== 'idle' && !(u && u.owner === 'A' && u.id !== sel)) return
    if (u && u.owner === 'A' && canAct(u.id)) {
      setSel(u.id)
      setMode('idle')
      setPreview(null)
    } else if (u) {
      setSel(u.id) // 상대 카드 정보 보기
      setMode('idle')
    } else reset()
  }

  const selUnit = sel ? state.units[sel] : undefined
  const mine = selUnit?.owner === 'A' && canAct(selUnit.id)

  return (
    <div className="screen">
      <div className="topbar">
        <span>턴 {state.turn}</span>
        <span className={remaining <= 5 ? 'timer warn' : 'timer'}>{remaining}s</span>
        <span>
          공격 {attacksUsed}/{cfg.maxAttacksPerTurn}
        </span>
      </div>
      {dangerNotice(cfg, state.turn) && <div className="danger-notice">{dangerNotice(cfg, state.turn)}</div>}
      <Board state={state} units={state.units} marks={marks} selected={sel} used={used} onCell={onCell} />

      <div className="slots">
        {Array.from({ length: cfg.actionsPerTurn }, (_, i) => {
          const a = actions[i]
          return (
            <button
              key={i}
              className={`slot ${a ? 'filled' : ''}`}
              onClick={() => a && setActions((xs) => xs.slice(0, i))}
              title="누르면 이 칸부터 다시 입력"
            >
              <span className="slot-n">{i + 1}</span>
              {a ? actionLabel(state, a) : '—'}
            </button>
          )
        })}
      </div>

      {selUnit && (
        <CardInfo champ={state.catalog[selUnit.instance.champId]!} unit={selUnit.instance} hp={selUnit.hp} shield={selUnit.shield} />
      )}

      {mine && !full && (
        <div className="actions">
          <button className={mode === 'move' ? 'on' : ''} onClick={() => (setMode('move'), setPreview(null))}>
            이동
          </button>
          <button
            className={mode === 'attack' ? 'on' : ''}
            disabled={attacksUsed >= cfg.maxAttacksPerTurn}
            onClick={() => setMode('attack')}
          >
            공격
          </button>
        </div>
      )}

      {mode === 'attack' && preview && selUnit && (
        <div className="preview">
          {preview.geometry.targets.length === 0 ? (
            <div>{preview.geometry.blockedBy ? '아군에 막힘' : '현재 맞는 카드 없음 (상대가 이동해 올 수도 있음)'}</div>
          ) : (
            preview.geometry.targets.map((tid, i) => {
              const t = state.units[tid]!
              const o = hitOdds(state, selUnit, t, i)
              return (
                <div key={tid}>
                  {state.catalog[t.instance.champId]!.name}: 피해 {o.afterArmor}
                  {o.absorbed > 0 && ` (보호막 흡수 ${o.absorbed})`} → 체력 −{o.hpDamage}
                  {o.reflected > 0 && ` · 반사로 내가 받을 피해 ${o.reflected}`}
                </div>
              )
            })
          )}
          <button
            className="primary"
            onClick={() => push({ type: 'attack', unit: selUnit.id, aim: preview.aim })}
            disabled={previews.every((p) => !aimEq(p.aim, preview.aim))}
          >
            공격 확정
          </button>
        </div>
      )}

      <div className="footer">
        {!full && <button onClick={() => push({ type: 'wait' })}>대기</button>}
        <button className="primary" onClick={() => onSubmit(padPlan(actions, cfg.actionsPerTurn))}>
          제출{actions.length < cfg.actionsPerTurn ? ' (빈 칸은 대기)' : ''}
        </button>
      </div>
    </div>
  )
}
