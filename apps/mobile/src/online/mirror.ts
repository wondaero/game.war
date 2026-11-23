import type { GameState } from '@war/engine'

/**
 * 손님(B) 화면용 상하 반전.
 * 판정은 항상 원래 좌표(방장 = A, 아래)로 하고, 손님 화면에서만 뒤집어서 "내가 A(아래)"처럼 보이게 한다.
 * 같은 함수를 두 번 적용하면 원래대로 돌아온다 (입력은 반전된 화면 → 원래 좌표로 되돌릴 때 다시 적용).
 *
 * 바꾸는 것: 좌표 {x, y} 의 y, 진영 'A'↔'B', 유닛 id 'A0'↔'B0', 방향 up↔down
 * 그대로 두는 것: config · catalog (챔프 원본의 상대 좌표 모양 등)
 */
const DIR_FLIP: Record<string, string> = {
  up: 'down',
  down: 'up',
  upLeft: 'downLeft',
  downLeft: 'upLeft',
  upRight: 'downRight',
  downRight: 'upRight',
}
const UNIT_ID = /^[AB]\d+$/

const swapSide = (s: string) => (s === 'A' ? 'B' : s === 'B' ? 'A' : s)
const swapId = (s: string) => (UNIT_ID.test(s) ? swapSide(s[0]!) + s.slice(1) : s)

export function mirror<T>(value: T, height: number): T {
  return walk(value, height, null) as T
}

function walk(v: unknown, h: number, key: string | null): unknown {
  if (Array.isArray(v)) return v.map((x) => walk(x, h, key))
  if (v === null || typeof v !== 'object') {
    if (typeof v !== 'string') return v
    if (key === 'dir') return DIR_FLIP[v] ?? v
    if (v === 'A' || v === 'B') return swapSide(v)
    return swapId(v)
  }
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length === 2 && typeof o.x === 'number' && typeof o.y === 'number') return { x: o.x, y: h - 1 - o.y }
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (k === 'config' || k === 'catalog') {
      out[k] = o[k]
      continue
    }
    const nk = k === 'A' || k === 'B' ? swapSide(k) : swapId(k)
    out[nk] = walk(o[k], h, k)
  }
  return out
}

export const mirrorState = (s: GameState): GameState => mirror(s, s.config.boardHeight)
