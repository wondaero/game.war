/**
 * 시드 기반 결정적 난수 (mulberry32).
 * - 상태는 uint32 하나 → GameState에 그대로 넣어 직렬화 가능
 * - Math.random 금지. 엔진의 모든 난수는 여기서만 나온다.
 */
export interface RngState {
  s: number
}

export function seedFromString(str: string): number {
  // xmur3 해시 → uint32
  let h = 1779033703 ^ str.length
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^ (h >>> 16)) >>> 0
}

export function createRngState(seed: number | string): RngState {
  const s = typeof seed === 'string' ? seedFromString(seed) : seed >>> 0
  return { s }
}

/** 이동 가능한 난수 생성기. 해결 과정 동안만 쓰고 끝나면 state()로 되돌려 저장. */
export class Rng {
  private s: number

  constructor(state: RngState) {
    this.s = state.s >>> 0
  }

  nextU32(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }

  /** 0 이상 n 미만 정수 */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0) throw new Error(`Rng.int: invalid n=${n}`)
    return Math.floor((this.nextU32() / 4294967296) * n)
  }

  /** min 이상 max 이하 정수 */
  range(min: number, max: number): number {
    if (max < min) throw new Error('Rng.range: max < min')
    return min + this.int(max - min + 1)
  }

  state(): RngState {
    return { s: this.s }
  }
}
