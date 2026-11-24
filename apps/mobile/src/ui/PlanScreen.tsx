import { useEffect, useMemo, useState } from 'react'
import {
  ABILITIES,
  abilityValue,
  actionError,
  aliveOf,
  anyMovePossible,
  attackTargets,
  actionsPerUnit,
  actsPerUnit,
  effMove,
  hitDamage,
  padPlan,
  planUnits,
  posEq,
  reachable,
  skillHealAmount,
  square3,
  validatePlan,
  zoneCells,
  type Action,
  type Aim,
  type GameState,
  type Pos,
  type TurnPlan,
  type UnitId,
} from '@war/v2'
import { addDangerMarks, addMark, Board, type CellMark } from './Board.tsx'
import { CardInfo } from './CardInfo.tsx'
import { actionLabel, dangerNotice, imageOf } from './format.ts'

type Mode = 'idle' | 'move' | 'attack' | 'skill'

const aimEq = (a: Aim, b: Aim) =>
  a.kind === 'cell' ? b.kind === 'cell' && posEq(a.pos, b.pos) : b.kind === 'unit' && a.id === b.id

/**
 * 한 턴 행동 입력 (내 쪽 = A, 아래).
 * 행동은 순서대로 쌓이고, 다음 행동은 앞 행동을 반영한 판(planUnits) 기준으로 고른다.
 * 예) 행동 1로 a5 → a4 이동했으면, 행동 2의 공격 사거리는 a4 에서 잰다.
 */
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
  const turn = state.turn
  const n = cfg.actionsPerTurn
  const [actions, setActions] = useState<Action[]>([])
  const [sel, setSel] = useState<UnitId | null>(null)
  const [mode, setMode] = useState<Mode>('idle')
  const [aim, setAim] = useState<Aim | null>(null)
  const [now, setNow] = useState(Date.now())

  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  const full = actions.length >= n
  const cap = actionsPerUnit(state, 'A')
  const repeatOk = cap > 1
  const count = new Map<UnitId, number>()
  for (const a of actions) if (a.type !== 'wait') count.set(a.unit, (count.get(a.unit) ?? 0) + 1)
  // 행동 횟수를 다 쓴 유닛 (흐리게)
  const used = new Set([...count].filter(([, k]) => k >= cap).map(([id]) => id))
  const actsUsed = actions.filter((a) => a.type === 'attack' || a.type === 'skill').length
  const actCap = actsPerUnit(state, 'A')
  const unitDid = (id: UnitId, type: Action['type']) => actions.filter((a) => a.type === type && a.type !== 'wait' && a.unit === id).length
  const moves = actions.filter((a) => a.type === 'move').length
  const needMove = moves < cfg.minMovesPerTurn && anyMovePossible(state, 'A')

  // 지금까지 입력한 내 행동을 반영한 판
  const proj = useMemo(() => planUnits(state, 'A', actions), [state, actions])

  // 제한시간: 마감 시 입력된 행동까지 자동 제출 (남은 행동은 대기, 이동이 없으면 자동으로 하나 채움)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (remaining === 0) onSubmit(padPlan(actions, n))
  }, [remaining]) // eslint-disable-line react-hooks/exhaustive-deps

  const selUnit = sel ? (proj[sel] ?? state.units[sel]) : undefined
  const canAct = (id: UnitId) => !used.has(id)
  const mine = !!selUnit && selUnit.owner === 'A' && selUnit.alive && canAct(selUnit.id)
  const ab = selUnit?.inst.ability ?? null
  const skillDef = ab ? ABILITIES[ab.kind] : null
  const ok = (a: Action) => actionError(state, proj, 'A', a) === null
  // 액션(이동 외 전부)은 턴당 maxActsPerTurn 번, 캐릭당 actCap 번
  const attackLeft = !!sel && actsUsed < cfg.maxActsPerTurn && unitDid(sel, 'attack') + unitDid(sel, 'skill') < actCap
  const skillLeft = attackLeft

  // 현재 모드에서 고를 수 있는 것
  const options = useMemo(() => {
    if (!selUnit || !mine) return { cells: [] as Pos[], aims: [] as Aim[] }
    if (mode === 'move') return { cells: reachable(cfg, proj, selUnit, effMove(selUnit, turn)), aims: [] }
    if (mode === 'attack') {
      const homing = abilityValue(selUnit.inst, 'homing') !== null
      const aims: Aim[] = homing
        ? aliveOf(proj, 'B').map((e) => ({ kind: 'unit', id: e.id }) as Aim)
        : zoneCells(cfg, 'B').map((pos) => ({ kind: 'cell', pos }) as Aim)
      return { cells: [], aims: aims.filter((aim) => ok({ type: 'attack', unit: selUnit.id, aim })) }
    }
    if (mode === 'skill' && ab) {
      if (ab.kind === 'heal')
        return {
          cells: [],
          aims: aliveOf(proj, 'A')
            .map((u) => ({ kind: 'unit', id: u.id }) as Aim)
            .filter((aim) => ok({ type: 'skill', unit: selUnit.id, aim })),
        }
      if (ab.kind === 'areaHeal')
        return {
          cells: [],
          aims: zoneCells(cfg, 'A')
            .map((pos) => ({ kind: 'cell', pos }) as Aim)
            .filter((aim) => ok({ type: 'skill', unit: selUnit.id, aim })),
        }
    }
    return { cells: [], aims: [] }
  }, [selUnit, mine, mode, proj]) // eslint-disable-line react-hooks/exhaustive-deps

  const aimCell = (a: Aim): Pos | null => (a.kind === 'cell' ? a.pos : (proj[a.id]?.pos ?? null))

  // ── 판 표시 ──
  const marks = new Map<string, CellMark[]>()
  addDangerMarks(marks, cfg, turn)
  for (const u of Object.values(state.units)) {
    const p = proj[u.id]
    if (u.owner === 'A' && u.alive && p && !posEq(p.pos, u.pos)) addMark(marks, u.pos, 'origin') // 이번 턴 출발 자리
  }
  for (const c of options.cells) addMark(marks, c, 'move')
  for (const a of options.aims) {
    const c = aimCell(a)
    if (c) addMark(marks, c, mode === 'skill' ? 'heal' : 'aim')
  }
  if (aim && selUnit) {
    const c = aimCell(aim)
    if (c) {
      const area =
        (mode === 'attack' && abilityValue(selUnit.inst, 'splash') !== null) || (mode === 'skill' && ab?.kind === 'areaHeal')
          ? square3(cfg, c)
          : [c]
      for (const p of area) addMark(marks, p, mode === 'skill' ? 'heal' : 'impact')
    }
  }
  for (const a of actions) if (a.type === 'move') addMark(marks, a.to, 'flash')

  const reset = () => {
    setSel(null)
    setMode('idle')
    setAim(null)
  }
  const push = (a: Action) => {
    if (full) return
    setActions((xs) => [...xs, a])
    // 같은 유닛을 계속 쓸 수 있으면 선택 유지
    if (a.type !== 'wait' && repeatOk && (count.get(a.unit) ?? 0) + 1 < cap) {
      setMode('idle')
      setAim(null)
    } else reset()
  }
  const chooseMode = (m: Mode) => {
    setMode(m)
    setAim(null)
    if (m === 'skill' && selUnit && skillDef && ab && ab.kind !== 'heal' && ab.kind !== 'areaHeal') {
      // 버프형 능력은 대상 없이 바로 사용
      const a: Action = { type: 'skill', unit: selUnit.id }
      if (ok(a)) push(a)
    }
  }

  const onCell = (p: Pos) => {
    if (mode === 'move' && sel && options.cells.some((c) => posEq(c, p))) return push({ type: 'move', unit: sel, to: p })
    if ((mode === 'attack' || mode === 'skill') && sel) {
      const hit = options.aims.find((a) => {
        const c = aimCell(a)
        return c && posEq(c, p)
      })
      if (hit) {
        // 같은 대상을 한 번 더 누르면 확정
        if (aim && aimEq(aim, hit)) return push({ type: mode === 'attack' ? 'attack' : 'skill', unit: sel, aim: hit })
        return setAim(hit)
      }
    }
    const u = Object.values(proj).find((x) => x.alive && posEq(x.pos, p))
    // 모드 중 잘못된 칸을 눌러도 모드는 유지 (다른 유닛을 누를 때만 전환)
    if (mode !== 'idle' && !(u && u.id !== sel)) return
    if (u) {
      setSel(u.id)
      setMode('idle')
      setAim(null)
    } else reset()
  }

  // ── 미리보기 (공격 피해 / 회복량) ──
  let preview: string[] = []
  if (aim && selUnit && mode === 'attack') {
    const { targets } = attackTargets(cfg, proj, selUnit, aim)
    preview = targets.length
      ? targets.map((t) => `${imageOf(t.inst.image).name}: ${hitDamage(selUnit, t, turn)} 피해 (체력 ${t.hp})`)
      : ['지금은 그 칸에 적이 없음 (상대가 이동해 올 수도 있음)']
  }
  if (aim && selUnit && mode === 'skill' && ab) {
    const v = ABILITIES[ab.kind].tiers[ab.tier] ?? 0
    const c = aimCell(aim)
    const area = ab.kind === 'areaHeal' && c ? square3(cfg, c) : c ? [c] : []
    const allies = aliveOf(proj, 'A').filter((u) => area.some((q) => posEq(q, u.pos)))
    preview = allies.length
      ? allies.map((u) => `${imageOf(u.inst.image).name}: +${skillHealAmount(u, v, turn)} 회복 (체력 ${u.hp})`)
      : ['범위 안에 아군 없음']
  }

  const plan = padPlan(actions, n)
  const planCheck = validatePlan(state, 'A', plan)
  const submitBlocked = needMove || !planCheck.ok
  const skillReady = skillLeft && !!(selUnit && skillDef?.use === 'skill' && !(skillDef.buff && selUnit.readyTurn > turn))

  return (
    <div className="screen">
      <div className="topbar">
        <span>
          턴 {turn}/{cfg.maxTurns}
        </span>
        <span className={remaining <= 5 ? 'timer warn' : 'timer'}>{Number.isFinite(remaining) ? `${remaining}s` : '∞'}</span>
        <span>
          행동 {actions.length}/{n} · 액션 {actsUsed}/{cfg.maxActsPerTurn}
        </span>
      </div>
      <p className="hint">
        {cap === 1 ? '캐릭마다 한 턴에 1번 행동' : '같은 캐릭이 여러 행동 가능'} · 액션(이동 외 전부)은 턴당 {cfg.maxActsPerTurn}번, 캐릭당 {actCap}번
      </p>
      {dangerNotice(cfg, turn) && <div className="danger-notice">{dangerNotice(cfg, turn)}</div>}
      <Board cfg={cfg} units={proj} turn={turn} marks={marks} selected={sel} used={used} onCell={onCell} />

      <div className="slots">
        {Array.from({ length: n }, (_, i) => {
          const a = actions[i]
          return (
            <button
              key={i}
              className={`slot ${a ? 'filled' : ''}`}
              onClick={() => a && (setActions((xs) => xs.slice(0, i)), reset())}
              title="누르면 이 행동부터 다시 입력"
            >
              <span className="slot-n">{i + 1}</span>
              {a ? actionLabel(state, a) : '—'}
            </button>
          )
        })}
      </div>

      {selUnit && <CardInfo unit={selUnit.inst} state={selUnit} turn={turn} />}

      {mine && !full && (
        <div className="actions">
          <button className={mode === 'move' ? 'on' : ''} onClick={() => chooseMode('move')}>
            이동
          </button>
          <button className={mode === 'attack' ? 'on' : ''} disabled={!attackLeft} onClick={() => chooseMode('attack')}>
            공격
          </button>
          {skillDef?.use === 'skill' && (
            <button className={mode === 'skill' ? 'on' : ''} disabled={!skillReady} onClick={() => chooseMode('skill')}>
              {skillDef.name}
            </button>
          )}
        </div>
      )}
      {mine && !full && mode !== 'idle' && (
        <p className="hint">
          {mode === 'move' && (options.cells.length ? '초록 칸을 눌러 이동 (아군은 건너뜀)' : '이동할 수 있는 칸이 없음')}
          {mode === 'attack' &&
            (options.aims.length
              ? abilityValue(selUnit!.inst, 'homing') !== null
                ? '노릴 적을 누르세요 (유도탄: 반드시 명중)'
                : `사거리 ${selUnit!.inst.stats.range} 안의 칸을 누르세요 (현재 위치 기준)`
              : '사거리 안에 조준할 칸이 없음')}
          {mode === 'skill' && (options.aims.length ? '대상을 누르세요' : '사거리 안에 대상이 없음')}
        </p>
      )}

      {aim && selUnit && (mode === 'attack' || mode === 'skill') && (
        <div className="preview">
          {preview.map((l) => (
            <div key={l}>{l}</div>
          ))}
          <button className="primary" onClick={() => push({ type: mode === 'attack' ? 'attack' : 'skill', unit: selUnit.id, aim })}>
            {mode === 'attack' ? '공격 확정' : '사용 확정'}
          </button>
        </div>
      )}

      {needMove && (
        <p className="hint warn">
          이번 턴에 이동을 최소 {cfg.minMovesPerTurn}번 넣어야 합니다
          {remaining <= 10 && ' — 시간이 끝나면 이동이 자동으로 들어갑니다'}
        </p>
      )}
      <div className="footer">
        {!full && <button onClick={() => push({ type: 'wait' })}>대기</button>}
        <button className="primary" disabled={submitBlocked} onClick={() => onSubmit(plan)}>
          제출{actions.length < n ? ' (남은 행동은 대기)' : ''}
        </button>
      </div>
    </div>
  )
}

