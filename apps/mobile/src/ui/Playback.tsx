import { useEffect, useMemo, useState } from 'react'
import { cloneUnits, type GameEvent, type GameState, type TurnLog, type UnitId, type UnitState } from '@war/v2'
import { addDangerMarks, addMark, Board, type CellMark, type FloatLabel } from './Board.tsx'
import { eventLines } from './format.ts'

interface Frame {
  step: number
  label: string
  units: Record<UnitId, UnitState>
  marks: Map<string, CellMark[]>
  floats: Map<UnitId, FloatLabel[]>
  lines: string[]
}

const FRAME_MS = 750

/** 체력 변화·사망을 판에 반영 (재생용) */
function applyHp(units: Record<UnitId, UnitState>, events: readonly GameEvent[]) {
  for (const e of events) {
    if (e.type === 'attack') for (const h of e.hits) units[h.target]!.hp -= h.damage
    if (e.type === 'reflect') units[e.to]!.hp -= e.damage
    if (e.type === 'heal') units[e.unit]!.hp += e.amount
    if (e.type === 'poisonTick' || e.type === 'zoneDamage') units[e.unit]!.hp -= e.damage
    if (e.type === 'death') units[e.unit]!.alive = false
  }
}

/** 행동마다 이동 → 액션 → 결과 3프레임 (엔진 처리 순서 그대로) */
function buildFrames(before: GameState, after: GameState, log: TurnLog): Frame[] {
  const frames: Frame[] = []
  let prev = before.units
  log.steps.forEach((events, i) => {
    const step = i + 1
    const lines = events.flatMap((e) => eventLines(before, e))
    const moved = cloneUnits(prev)
    const moveMarks = new Map<string, CellMark[]>()
    for (const e of events) {
      if (e.type === 'move') {
        moved[e.unit]!.pos = { ...e.to }
        addMark(moveMarks, e.from, 'origin')
        addMark(moveMarks, e.to, 'flash')
      }
      // 이동 시 자가 회복은 이동 프레임에 반영
      if (e.type === 'heal' && e.source === 'moveRegen') moved[e.unit]!.hp += e.amount
    }
    frames.push({ step, label: '이동', units: moved, marks: moveMarks, floats: new Map(), lines })

    const marks = new Map<string, CellMark[]>()
    const floats = new Map<UnitId, FloatLabel[]>()
    const float = (id: UnitId, f: FloatLabel) => floats.set(id, [...(floats.get(id) ?? []), f])
    for (const e of events) {
      if (e.type === 'attack') {
        for (const c of e.cells) addMark(marks, c, 'impact')
        for (const h of e.hits) float(h.target, { text: `-${h.damage}`, kind: 'damage' })
      }
      if (e.type === 'reflect') float(e.to, { text: `↩-${e.damage}`, kind: 'reflected' })
      if (e.type === 'heal' && e.source !== 'moveRegen') float(e.unit, { text: `+${e.amount}`, kind: 'heal' })
      if (e.type === 'buff') for (const t of e.targets) float(t, { text: '⬆', kind: 'status' })
      if (e.type === 'status') float(e.unit, { text: e.status === 'nullified' ? '⛔' : e.status === 'slowed' ? '🐌' : '☠', kind: 'status' })
    }
    frames.push({ step, label: '액션', units: moved, marks, floats, lines })

    const result = cloneUnits(moved)
    applyHp(
      result,
      events.filter((e) => !(e.type === 'heal' && e.source === 'moveRegen')),
    )
    frames.push({ step, label: '결과', units: result, marks: new Map(), floats: new Map(), lines })
    prev = result
  })

  if (log.endEvents.length) {
    const floats = new Map<UnitId, FloatLabel[]>()
    const float = (id: UnitId, f: FloatLabel) => floats.set(id, [...(floats.get(id) ?? []), f])
    for (const e of log.endEvents) {
      if (e.type === 'poisonTick') float(e.unit, { text: `☠-${e.damage}`, kind: 'damage' })
      if (e.type === 'zoneDamage') float(e.unit, { text: `⚠-${e.damage}`, kind: 'zone' })
    }
    const marks = new Map<string, CellMark[]>()
    addDangerMarks(marks, before.config, log.turn)
    frames.push({
      step: log.steps.length,
      label: '턴 끝',
      units: after.units,
      marks,
      floats,
      lines: log.endEvents.flatMap((e) => eventLines(before, e)),
    })
  } else if (frames.length) {
    // 마지막 화면은 실제 결과 상태로 (버프 만료 등 반영)
    frames[frames.length - 1] = { ...frames[frames.length - 1]!, units: after.units }
  }
  return frames
}

export function Playback({
  before,
  after,
  log,
  notice,
  onDone,
}: {
  before: GameState
  after: GameState
  log: TurnLog
  notice?: string | undefined
  onDone: () => void
}) {
  const frames = useMemo(() => buildFrames(before, after, log), [before, after, log])
  const [i, setI] = useState(0)
  const last = i >= frames.length - 1

  useEffect(() => {
    if (last) return
    const t = setTimeout(() => setI((x) => x + 1), FRAME_MS)
    return () => clearTimeout(t)
  }, [i, last])

  const f = frames[Math.min(i, frames.length - 1)]
  if (!f) {
    onDone()
    return null
  }

  return (
    <div className="screen">
      <div className="topbar">
        <span>턴 {log.turn} 결과</span>
        <span>
          행동 {f.step}/{before.config.actionsPerTurn} · {f.label}
        </span>
      </div>
      {notice && <div className="danger-notice">{notice}</div>}
      <Board cfg={before.config} units={f.units} turn={log.turn} marks={f.marks} floats={f.floats} />
      <div className="log">
        {f.lines.map((l, k) => (
          <div key={k}>{l}</div>
        ))}
      </div>
      <div className="footer">
        {!last && <button onClick={() => setI(frames.length - 1)}>건너뛰기</button>}
        <button className="primary" disabled={!last} onClick={onDone}>
          {last ? '다음' : '재생 중…'}
        </button>
      </div>
    </div>
  )
}
