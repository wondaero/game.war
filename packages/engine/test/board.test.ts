import { describe, expect, it } from 'vitest'
import { canStandOn, zoneCells, zoneOf } from '../src/board.ts'
import { DEFAULT_CONFIG, makeConfig } from '../src/config.ts'
import { resolveTurn } from '../src/resolve.ts'
import { validatePlan } from '../src/validate.ts'
import { P, idle, move, plan, scenario, shoot, tmpl } from './helpers.ts'

const six = { boardWidth: 6, boardHeight: 6, zoneRows: 3 }

describe('기본 판: 6×6, 진영 3줄씩, 중립 없음', () => {
  const cfg = makeConfig()
  it('기본 설정', () => {
    expect([DEFAULT_CONFIG.boardWidth, DEFAULT_CONFIG.boardHeight, DEFAULT_CONFIG.zoneRows]).toEqual([6, 6, 3])
  })
  it('각 진영 18칸, 중립 칸 없음', () => {
    expect(zoneCells(cfg, 'A')).toHaveLength(18)
    expect(zoneCells(cfg, 'B')).toHaveLength(18)
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) expect(zoneOf(cfg, { x, y })).not.toBe('neutral')
  })
  it('상대 진영에는 설 수 없음 (앞줄끼리 맞닿음: B 앞줄 y=2, A 앞줄 y=3)', () => {
    expect(canStandOn(cfg, 'A', P(0, 3))).toBe(true)
    expect(canStandOn(cfg, 'A', P(0, 2))).toBe(false)
    expect(canStandOn(cfg, 'B', P(0, 2))).toBe(true)
  })
  it('앞줄의 근접 공격(사거리 1)이 바로 앞 상대 앞줄에 닿음', () => {
    const melee = tmpl('melee', { base: { atk: 12, hp: 20 }, trajectory: { kind: 'straight', range: 1, falloffBp: 0 } })
    const s = scenario(
      [
        { side: 'A', pos: P(2, 3), t: melee },
        { side: 'B', pos: P(2, 2), t: tmpl('t', { base: { hp: 30 } }) },
      ],
      { config: six },
    )
    expect(validatePlan(s, 'A', plan(move('A0', 2, 2))).ok).toBe(false)
    const r = resolveTurn(s, { A: plan(shoot('A0', 'up')), B: idle() })
    expect(r.state.units.B0!.hp).toBe(18)
  })
})
