/** 시뮬레이션 공용 도구 (테스트 파일 아님) */
import {
  createGame,
  makeV2Config,
  randomDeck,
  STAT_KEYS,
  DEFAULT_AI,
  deploy,
  IMAGES,
  planDeployment,
  planTurn,
  planTurnMixed,
  resolveTurn,
  type Ability,
  type AbilityKind,
  type GameEvent,
  type GameState,
  type Side,
  type Stats,
  type TurnPlan,
  type UnitInstance,
  type V2Config,
} from '../src/index.ts'

export const RUN = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM

export type Pol = (s: GameState, side: Side, seed: number) => TurnPlan
export const mixed: Pol = (s, side, seed) => planTurnMixed(s, side, seed)
export const greedyFirst: Pol = (s, side, seed) => planTurn(s, side, seed)
export const greedyLast: Pol = (s, side, seed) => planTurn(s, side, seed, { ...DEFAULT_AI, moveFirst: false })
export const attackOnly: Pol = (s, side, seed) => planTurn(s, side, seed, { ...DEFAULT_AI, dodge: 0, approach: 0, zone: 0 })
export const dodgeHeavy: Pol = (s, side, seed) => planTurn(s, side, seed, { ...DEFAULT_AI, dodge: 3 })

export interface Played {
  s: GameState
  events: GameEvent[]
}

export function play(A: UnitInstance[], B: UnitInstance[], seed: number, pa: Pol = mixed, pb: Pol = mixed, config: Partial<V2Config> = {}): Played {
  let s = createGame({ A, B }, config)
  s = deploy(s, { A: planDeployment(s, 'A', A, seed), B: planDeployment(s, 'B', B, seed + 7) })
  const events: GameEvent[] = []
  while (s.phase === 'plan') {
    const r = resolveTurn(s, { A: pa(s, 'A', seed), B: pb(s, 'B', seed + 1) })
    for (const st of r.log.steps) events.push(...st)
    events.push(...r.log.endEvents)
    s = r.state
  }
  return { s, events }
}

/** X 덱 관점 점수 (승 1, 무 0.5). 진영은 번갈아 */
export function duel(
  X: (i: number) => UnitInstance[],
  Y: (i: number) => UnitInstance[],
  N: number,
  o: { px?: Pol; py?: Pol; onGame?: (p: Played, xSide: Side) => void; config?: Partial<V2Config> } = {},
) {
  const px = o.px ?? mixed
  const py = o.py ?? mixed
  let score = 0, turns = 0, maxT = 0, draws = 0
  for (let i = 0; i < N; i++) {
    const xSide: Side = i % 2 ? 'A' : 'B'
    const p = xSide === 'A' ? play(X(i), Y(i), i, px, py, o.config) : play(Y(i), X(i), i, py, px, o.config)
    const w = p.s.result!.winner
    score += w === xSide ? 1 : w === 'draw' ? 0.5 : 0
    if (w === 'draw') draws++
    turns += p.s.turn - 1
    if (p.s.result!.reason === 'maxTurns') maxT++
    o.onGame?.(p, xSide)
  }
  return { rate: score / N, turns: turns / N, maxT: maxT / N, draws: draws / N }
}

export const pct = (x: number) => `${(x * 100).toFixed(0)}%`.padStart(4)
export const unit = (i: number, stats: Stats, ability: Ability | null = null): UnitInstance => ({
  id: `u${i}`,
  image: IMAGES[i]!,
  stats: { ...stats },
  ability,
})
export const AVG: Stats[] = [
  { atk: 17, armor: 3, hp: 40, move: 1, range: 7 },
  { atk: 18, armor: 3, hp: 40, move: 2, range: 8 },
  { atk: 17, armor: 3, hp: 40, move: 2, range: 7 },
  { atk: 18, armor: 3, hp: 40, move: 1, range: 8 },
]
export const avgDeck = (ab: Ability | null = null, holder = 0) => AVG.map((s, i) => unit(i, s, i === holder ? ab : null))
export const fixedDeck = (s: Stats) => [0, 1, 2, 3].map((i) => unit(i, s))

/** 능력이 실제로 작동한 횟수 (holder = 능력 가진 유닛 id) */
export function countFires(kind: AbilityKind, holder: string, ev: GameEvent[]): number {
  let n = 0
  for (const e of ev) {
    switch (kind) {
      case 'heal':
      case 'areaHeal':
      case 'moveRegen':
      case 'lifesteal':
        if (e.type === 'heal' && e.source === kind && (kind === 'heal' || kind === 'areaHeal' || e.unit === holder)) n++
        break
      case 'nullify':
        if (e.type === 'fizzle' && e.reason === 'nullified') n++
        break
      case 'reflect':
        if (e.type === 'reflect' && e.from === holder) n++
        break
      case 'slow':
        if (e.type === 'status' && e.status === 'slowed') n++
        break
      case 'poison':
        if (e.type === 'poisonTick') n++
        break
      case 'teamArmorUp':
      case 'teamAtkUp':
      case 'moveUp':
      case 'allUp':
        if (e.type === 'buff' && e.unit === holder) n++
        break
      case 'splash':
        if (e.type === 'attack' && e.unit === holder) n += e.hits.length
        break
      default: // 방어력 무시·유도탄·퍼센트딜·도핑: 그 유닛의 명중 수
        if (e.type === 'attack' && e.unit === holder) n += e.hits.length
    }
  }
  return n
}

/** 규칙 변형 비교: 기본 지표 + 주요 매치업 */
export function ruleVariantReport(name: string, config: Partial<V2Config>) {
  const cfg = makeV2Config(config)
  const N = 100
  let a = 0, b = 0, d = 0, turns = 0, maxT = 0
  for (let i = 0; i < N; i++) {
    const p = play(randomDeck(cfg, `ra${i}`), randomDeck(cfg, `rb${i}`), i, mixed, mixed, config)
    const r = p.s.result!
    r.winner === 'A' ? a++ : r.winner === 'B' ? b++ : d++
    turns += p.s.turn - 1
    if (r.reason === "maxTurns") maxT++
  }
  const best: Stats = { atk: 20, armor: 5, hp: 50, move: 2, range: 10 }
  const worst: Stats = { atk: 15, armor: 1, hp: 30, move: 1, range: 5 }
  const M = 60
  const bestAvg = duel(() => fixedDeck(best), () => avgDeck(), M, { config }).rate
  const avgWorst = duel(() => avgDeck(), () => fixedDeck(worst), M, { config }).rate
  const score = (dk: UnitInstance[]) =>
    dk.reduce((s, u) => s + STAT_KEYS.reduce((x, k) => x + (u.stats[k] - cfg.statRanges[k].min) / (cfg.statRanges[k].max - cfg.statRanges[k].min), 0), 0)
  const decks = Array.from({ length: 2000 }, (_, i) => randomDeck(cfg, `pool${i}`).map((u) => ({ ...u, ability: null }))).sort((x, y) => score(y) - score(x))
  const top = decks.slice(0, 200), mid = decks.slice(900, 1100)
  const topMid = duel((i) => top[i]!, (i) => mid[i]!, M, { config }).rate
  console.log(`[규칙] ${name.padEnd(18)} 평균 ${(turns / N).toFixed(1)}턴 · 전멸 ${pct(1 - maxT / N)} · 판정 ${pct(maxT / N)} · 무 ${pct(d / N)} · A/B ${pct(a / N)}/${pct(b / N)} | 최고vs평균 ${pct(bestAvg)} · 평균vs최악 ${pct(avgWorst)} · 뽑기 상위10%vs중간 ${pct(topMid)}`)
}
