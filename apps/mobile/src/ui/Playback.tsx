import { useEffect, useMemo, useState } from 'react'
import { cloneUnits, type GameState, type TurnLog, type UnitId, type UnitState } from '@war/engine'
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

/** 스텝마다 이동 → 공격 → 결과 3프레임으로 재생 (엔진 처리 순서 그대로) */
function buildFrames(before: GameState, log: TurnLog): Frame[] {
  const frames: Frame[] = []
  let prev = before.units
  for (const s of log.steps) {
    const moved = cloneUnits(prev)
    for (const e of s.events) if (e.type === 'move') moved[e.unit]!.pos = { ...e.to }
    const lines = s.events.flatMap((e) => eventLines(before, e))
    frames.push({ step: s.step, label: '이동', units: moved, marks: new Map(), floats: new Map(), lines })

    const marks = new Map<string, CellMark[]>()
    const floats = new Map<UnitId, FloatLabel[]>()
    const float = (id: UnitId, f: FloatLabel) => floats.set(id, [...(floats.get(id) ?? []), f])
    for (const e of s.events) {
      if (e.type !== 'attack') continue
      for (const c of e.path) addMark(marks, c, 'path')
      for (const c of e.impactCells) addMark(marks, c, 'impact')
      for (const h of e.hits) {
        if (h.absorbed) float(h.target, { text: `🛡${h.absorbed}`, kind: 'shield' })
        if (h.hpDamage) float(h.target, { text: `-${h.hpDamage}`, kind: 'damage' })
        if (h.reflect) {
          float(h.target, { text: '반사', kind: 'reflected' })
          if (h.reflect.absorbed) float(h.attacker, { text: `🛡${h.reflect.absorbed}`, kind: 'shield' })
          if (h.reflect.hpDamage) float(h.attacker, { text: `-${h.reflect.hpDamage}`, kind: 'damage' })
        }
      }
    }
    for (const e of s.events) {
      if (e.type === 'heal') float(e.unit, { text: `+${e.amount}`, kind: 'heal' })
    }
    frames.push({ step: s.step, label: '공격', units: moved, marks, floats, lines })
    frames.push({ step: s.step, label: '결과', units: s.unitsAfter, marks: new Map(), floats: new Map(), lines })
    prev = s.unitsAfter
  }
  // 턴 끝 ⑧ 자체 회복 ⑨ 위험지대
  // 턴 끝 이벤트(회복·위험지대·사망·승패)가 있으면 별도 프레임 하나로 표시
  const heals = log.endEvents
  if (heals.length) {
    const floats = new Map<UnitId, FloatLabel[]>()
    const float = (id: UnitId, f: FloatLabel) => floats.set(id, [...(floats.get(id) ?? []), f])
    for (const e of heals) {
      if (e.type === 'heal') float(e.unit, { text: `+${e.amount}`, kind: 'heal' })
      if (e.type === 'zoneDamage') float(e.unit, { text: `⚠-${e.amount}`, kind: 'zone' })
    }
    const marks = new Map<string, CellMark[]>()
    addDangerMarks(marks, before, log.turn)
    frames.push({
      step: log.steps.length,
      label: '턴 끝',
      units: log.unitsAfter,
      marks,
      floats,
      lines: log.endEvents.flatMap((e) => eventLines(before, e)),
    })
  }
  return frames
}

export function Playback({ before, log, onDone }: { before: GameState; log: TurnLog; onDone: () => void }) {
  const frames = useMemo(() => buildFrames(before, log), [before, log])
  const [i, setI] = useState(0)
  const last = i >= frames.length - 1

  useEffect(() => {
    if (last) return
    const t = setTimeout(() => setI((x) => x + 1), FRAME_MS)
    return () => clearTimeout(t)
  }, [i, last])

  const f = frames[Math.min(i, frames.length - 1)]
  if (!f) return null

  return (
    <div className="screen">
      <div className="topbar">
        <span>턴 {log.turn} 결과</span>
        <span>
          스텝 {f.step}/{before.config.actionsPerTurn} · {f.label}
        </span>
      </div>
      <Board state={before} units={f.units} marks={f.marks} floats={f.floats} />
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
