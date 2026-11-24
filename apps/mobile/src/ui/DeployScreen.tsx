import { useMemo, useState } from 'react'
import { posEq, spawnUnit, unitIdFor, zoneCells, type GameState, type Pos, type UnitState } from '@war/v2'
import { addMark, Board, type CellMark } from './Board.tsx'
import { CardInfo } from './CardInfo.tsx'
import { imageOf } from './format.ts'

export function DeployScreen({ state, onSubmit }: { state: GameState; onSubmit: (d: Pos[]) => void }) {
  const team = state.teams.A
  const [slots, setSlots] = useState<(Pos | null)[]>(() => team.map(() => null))
  const [sel, setSel] = useState(0)

  const units = useMemo(() => {
    const out: Record<string, UnitState> = {}
    slots.forEach((p, i) => {
      if (!p) return
      const id = unitIdFor('A', i)
      out[id] = spawnUnit(id, 'A', team[i]!, p)
    })
    return out
  }, [slots, team])

  const zone = zoneCells(state.config, 'A')
  const marks = new Map<string, CellMark[]>()
  for (const c of zone) addMark(marks, c, 'deploy')

  const onCell = (p: Pos) => {
    const occupant = slots.findIndex((s) => s && posEq(s, p))
    if (occupant >= 0) {
      // 놓인 유닛을 누르면 다시 집기
      setSlots((s) => s.map((x, i) => (i === occupant ? null : x)))
      setSel(occupant)
      return
    }
    if (!zone.some((c) => posEq(c, p))) return
    const next = slots.map((x, i) => (i === sel ? p : x))
    setSlots(next)
    const empty = next.findIndex((x) => !x)
    if (empty >= 0) setSel(empty)
  }

  const done = slots.every(Boolean)
  const cur = team[sel]!
  return (
    <div className="screen">
      <h2>배치</h2>
      <p className="hint">
        아래 {state.config.zoneRows}줄(내 진영)에 유닛을 놓으세요. 상대도 동시에 배치하고, 끝나면 함께 공개됩니다.
      </p>
      <Board cfg={state.config} units={units} turn={1} marks={marks} selected={unitIdFor('A', sel)} onCell={onCell} />
      <div className="chips">
        {team.map((inst, i) => (
          <button key={inst.id} className={`chip ${i === sel ? 'on' : ''} ${slots[i] ? 'placed' : ''}`} onClick={() => setSel(i)}>
            {imageOf(inst.image).emoji} {imageOf(inst.image).name}
          </button>
        ))}
      </div>
      <CardInfo unit={cur} />
      <div className="footer">
        <button className="primary" disabled={!done} onClick={() => onSubmit(slots as Pos[])}>
          배치 완료
        </button>
      </div>
    </div>
  )
}
