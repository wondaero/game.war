import type { GameState, Side } from './types.ts'

/**
 * 상하 반전 (B ↔ A). 같은 함수를 두 번 적용하면 원래대로 돌아온다.
 * - 쓰는 곳: 손님(B) 화면 표시, AI 를 진영과 무관하게 똑같이 생각시키기 (B 는 뒤집어서 A 처럼 계획)
 * - 바꾸는 것: 좌표 {x, y} 의 y, 진영 'A'↔'B', 유닛 id 'A0'↔'B0', 객체 키 'A'/'B'·'A0'/'B0'
 * - 그대로 두는 것: config
 */
const UNIT_ID = /^[AB]\d+$/
const swapSide = (s: string) => (s === 'A' ? 'B' : s === 'B' ? 'A' : s)
const swapId = (s: string) => (UNIT_ID.test(s) ? swapSide(s[0]!) + s.slice(1) : s)

export function mirror<T>(value: T, height: number): T {
  return walk(value, height) as T
}

function walk(v: unknown, h: number): unknown {
  if (Array.isArray(v)) return v.map((x) => walk(x, h))
  if (v === null || typeof v !== 'object') {
    if (typeof v !== 'string') return v
    if (v === 'A' || v === 'B') return swapSide(v)
    return swapId(v)
  }
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length === 2 && typeof o.x === 'number' && typeof o.y === 'number') return { x: o.x, y: h - 1 - o.y }
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (k === 'config') {
      out[k] = o[k]
      continue
    }
    out[k === 'A' || k === 'B' ? swapSide(k) : swapId(k)] = walk(o[k], h)
  }
  return out
}

export const mirrorState = (s: GameState): GameState => mirror(s, s.config.boardHeight)

/** side 관점으로 맞춤: B 면 뒤집어서 "내가 A(아래)" 인 판으로 */
export const asA = <T>(side: Side, x: T, s: GameState): T => (side === 'A' ? x : mirror(x, s.config.boardHeight))
