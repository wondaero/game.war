/**
 * 밸런스 시뮬레이션 (필승법·매칭 지표 점검). 기본 테스트에서는 건너뜀.
 *   SIM=1 npx vitest run packages/ai/test/balance.sim.test.ts
 */
import { describe, it } from 'vitest'
import {
  createGame,
  deploy,
  makeGachaContext,
  MVP_CHAMPS,
  padPlan,
  resolveTurn,
  STAT_KEYS,
  type ChampTemplate,
  type GameConfig,
  type GameState,
  type Side,
  type TurnPlan,
  type UnitInstance,
  validatePlan,
} from '@war/engine'
import { buildAiDeck, DEFAULT_WEIGHTS, planDeployment, planTurn } from '../src/index.ts'

const RUN = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.SIM
const ctx = makeGachaContext()

type Policy = (s: GameState, side: Side, seed: number) => TurnPlan
const standard: Policy = (s, side, seed) => planTurn(s, side, seed)

/** 행동을 걸러낸 뒤 무효가 되면(같은 카드의 이동 후 공격 등) 뒤에서부터 대기로 바꿔 유효하게 */
function sanitize(s: GameState, side: Side, plan: TurnPlan): TurnPlan {
  const out = [...plan]
  for (let i = out.length - 1; i >= 0 && !validatePlan(s, side, out).ok; i--) out[i] = { type: 'wait' }
  return out
}
const hpRatio = (s: GameState, side: Side) => {
  const us = Object.values(s.units).filter((u) => u.owner === side)
  return us.reduce((a, u) => a + (u.alive ? u.hp : 0), 0) / us.reduce((a, u) => a + u.instance.stats.hp, 0)
}
const dodgeOnly: Policy = (s, side, seed) =>
  sanitize(
    s,
    side,
    planTurn(s, side, seed, { ...DEFAULT_WEIGHTS, dodge: 5, approach: 0 }).map((a) =>
      a.type === 'attack' ? { type: 'wait' as const } : a,
    ),
  )
const POLICIES: Record<string, Policy> = {
  '표준 AI': standard,
  '아무것도 안 함': (s) => padPlan([], s.config.actionsPerTurn),
  '회피만 (공격 안 함)': dodgeOnly,
  '공격만 (이동 안 함)': (s, side, seed) =>
    sanitize(s, side, planTurn(s, side, seed).map((a) => (a.type === 'move' ? { type: 'wait' as const } : a))),
  '앞서면 도망 (판정승 노림)': (s, side, seed) =>
    hpRatio(s, side) > hpRatio(s, side === 'A' ? 'B' : 'A') ? dodgeOnly(s, side, seed) : standard(s, side, seed),
  '후방 고수 (접근 안 함, 회피 강함)': (s, side, seed) =>
    planTurn(s, side, seed, { ...DEFAULT_WEIGHTS, approach: 0, dodge: 2 }),
  '돌격 (회피 안 함)': (s, side, seed) => planTurn(s, side, seed, { ...DEFAULT_WEIGHTS, dodge: 0, approach: 2 }),
}

function play(
  teams: Record<Side, UnitInstance[]>,
  pol: Record<Side, Policy>,
  seed: number,
  config: Partial<GameConfig> = {},
  champs?: readonly ChampTemplate[],
): GameState {
  let s = createGame({ teams, config, catalog: champs })
  s = deploy(s, { A: planDeployment(s, 'A', teams.A, seed), B: planDeployment(s, 'B', teams.B, seed + 7) })
  while (s.phase === 'plan') s = resolveTurn(s, { A: pol.A(s, 'A', seed), B: pol.B(s, 'B', seed + 1) }).state
  return s
}

const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(0)}%`.padStart(4)

describe.skipIf(!RUN)('밸런스 시뮬레이션', () => {
  it('1. 진영(위/아래) 유불리: 같은 덱으로 양쪽 표준 AI', () => {
    let a = 0, b = 0, d = 0
    const N = 150
    for (let i = 0; i < N; i++) {
      const deck = buildAiDeck(ctx, `side${i}`)
      const r = play({ A: deck, B: deck }, { A: standard, B: standard }, i).result!
      r.winner === 'A' ? a++ : r.winner === 'B' ? b++ : d++
    }
    console.log(`[진영] 아래(A) 승 ${pct(a, N)} / 위(B) 승 ${pct(b, N)} / 무 ${pct(d, N)}`)
  }, 600_000)

  it('2. 전략별 승률: 같은 덱, 표준 AI 상대, 진영 교대', () => {
    const N = 60
    for (const [name, pol] of Object.entries(POLICIES)) {
      let w = 0, l = 0, d = 0, turns = 0, byTurns = 0
      for (let i = 0; i < N; i++) {
        const deck = buildAiDeck(ctx, `pol${i}`)
        const mine: Side = i % 2 ? 'A' : 'B'
        const pols = mine === 'A' ? { A: pol, B: standard } : { A: standard, B: pol }
        const s = play({ A: deck, B: deck }, pols, i)
        const r = s.result!
        turns += s.turn - 1
        if (r.reason === 'maxTurns') byTurns++
        r.winner === mine ? w++ : r.winner === 'draw' ? d++ : l++
      }
      console.log(`[전략] ${name.padEnd(22)} 승 ${pct(w, N)} 패 ${pct(l, N)} 무 ${pct(d, N)} · 평균 ${(turns / N).toFixed(1)}턴 · 턴제한 종료 ${pct(byTurns, N)}`)
    }
  }, 600_000)

  it('3. 챔프·특수능력 지배 여부 + 4. 능력치 합 매칭 지표', () => {
    const N = 600
    const champ = new Map<string, { w: number; n: number }>()
    const special = new Map<string, { w: number; n: number }>()
    const rows: { dSum: number; dPow: number; dSpec: number; win: number }[] = []
    const sum = (t: UnitInstance[]) => t.reduce((s, u) => s + STAT_KEYS.reduce((x, k) => x + u.stats[k], 0), 0)
    // 단순 전투력: 체력 × 공격력 (서로 깎는 속도) + 방어력은 받는 피해를 줄임
    const power = (t: UnitInstance[]) => t.reduce((s, u) => s + u.stats.hp * (u.stats.atk + 2 * u.stats.armor), 0)
    let sumRight = 0, powRight = 0, decided = 0
    for (let i = 0; i < N; i++) {
      const A = buildAiDeck(ctx, `rA${i}`)
      const B = buildAiDeck(ctx, `rB${i}`)
      const r = play({ A, B }, { A: standard, B: standard }, i).result!
      const score = r.winner === 'A' ? 1 : r.winner === 'B' ? 0 : 0.5
      for (const [team, sc] of [[A, score], [B, 1 - score]] as const) {
        for (const u of team) {
          const c = champ.get(u.champId) ?? { w: 0, n: 0 }
          champ.set(u.champId, { w: c.w + sc, n: c.n + 1 })
          for (const sp of u.specials) {
            const e = special.get(sp.kind) ?? { w: 0, n: 0 }
            special.set(sp.kind, { w: e.w + sc, n: e.n + 1 })
          }
        }
      }
      const dSum = sum(A) - sum(B)
      const dPow = power(A) - power(B)
      rows.push({ dSum, dPow, dSpec: A.flatMap((u) => u.specials).length - B.flatMap((u) => u.specials).length, win: score })
      if (score !== 0.5) {
        decided++
        if (Math.sign(dSum) === (score === 1 ? 1 : -1)) sumRight++
        if (Math.sign(dPow) === (score === 1 ? 1 : -1)) powRight++
      }
    }
    console.log('[챔프] 포함 시 승률')
    for (const [id, c] of [...champ].sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n))
      console.log(`   ${ctx.catalog[id]!.name.padEnd(6)} ${pct(c.w, c.n)} (n=${c.n})`)
    console.log('[특수능력] 보유 시 승률')
    for (const [k, c] of [...special].sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n))
      console.log(`   ${k.padEnd(10)} ${pct(c.w, c.n)} (n=${c.n})`)
    console.log(`[매칭] 승부가 난 ${decided}판 중 "능력치 합이 높은 쪽 승" ${pct(sumRight, decided)}, "전투력(체력×(공격+2×방어)) 높은 쪽 승" ${pct(powRight, decided)}`)
    // 능력치 합 차이 구간별 승률
    const buckets = [[-99, -6], [-5, -2], [-1, 1], [2, 5], [6, 99]] as const
    for (const [lo, hi] of buckets) {
      const g = rows.filter((r) => r.dSum >= lo && r.dSum <= hi)
      if (g.length) console.log(`   합 차이 ${String(lo).padStart(3)}~${String(hi).padEnd(3)} → A 승률 ${pct(g.reduce((s, r) => s + r.win, 0), g.length)} (n=${g.length})`)
    }
  }, 600_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (리그전)', () => {
  it('5. 전략 리그전: 같은 덱, 진영 교대', () => {
    const names = ['표준 AI', '후방 고수 (접근 안 함, 회피 강함)', '돌격 (회피 안 함)', '앞서면 도망 (판정승 노림)']
    const N = 40
    for (const x of names)
      for (const y of names) {
        if (x > y) continue
        let w = 0, l = 0, d = 0, dmg = 0
        for (let i = 0; i < N; i++) {
          const deck = buildAiDeck(ctx, `rr${i}`)
          const xSide: Side = i % 2 ? 'A' : 'B'
          const pols = xSide === 'A' ? { A: POLICIES[x]!, B: POLICIES[y]! } : { A: POLICIES[y]!, B: POLICIES[x]! }
          const s = play({ A: deck, B: deck }, pols, i)
          dmg += Object.values(s.units).reduce((a, u) => a + (u.instance.stats.hp - Math.max(0, u.hp)), 0)
          const r = s.result!
          r.winner === xSide ? w++ : r.winner === 'draw' ? d++ : l++
        }
        console.log(`[리그] ${x.slice(0, 8).padEnd(9)} vs ${y.slice(0, 8).padEnd(9)}: 승 ${pct(w, N)} 패 ${pct(l, N)} 무 ${pct(d, N)} · 판당 총피해 ${(dmg / N).toFixed(0)}`)
      }
  }, 600_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (규칙 변형)', () => {
  it('6. 관통 × 턴당 최대 공격 수 비교', () => {
    const variants: [string, Partial<GameConfig>][] = [
      ['관통 없음 · 공격 2', { lineFalloffBp: 0, maxAttacksPerTurn: 2 }],
      ['관통 50% · 공격 2', { lineFalloffBp: 5000, maxAttacksPerTurn: 2 }],
      ['관통 없음 · 공격 3', { lineFalloffBp: 0, maxAttacksPerTurn: 3 }],
      ['관통 50% · 공격 3', { lineFalloffBp: 5000, maxAttacksPerTurn: 3 }],
    ]
    const camp = POLICIES['후방 고수 (접근 안 함, 회피 강함)']!
    const N = 80
    for (const [name, cfg] of variants) {
      let ann = 0, draw = 0, turns = 0, moves = 0, slots = 0
      for (let i = 0; i < N; i++) {
        const deck = buildAiDeck(ctx, `v${i}`)
        let s = createGame({ teams: { A: deck, B: buildAiDeck(ctx, `w${i}`) }, config: cfg })
        s = deploy(s, { A: planDeployment(s, 'A', s.teams.A, i), B: planDeployment(s, 'B', s.teams.B, i + 7) })
        while (s.phase === 'plan') {
          const A = planTurn(s, 'A', i), B = planTurn(s, 'B', i + 1)
          for (const a of [...A, ...B]) { slots++; if (a.type === 'move') moves++ }
          s = resolveTurn(s, { A, B }).state
        }
        turns += s.turn - 1
        if (s.result!.reason === 'annihilation') ann++
        if (s.result!.winner === 'draw') draw++
      }
      // 교착 지표: 양쪽 다 후방 고수일 때
      let cDraw = 0, cDmg = 0
      const M = 40
      for (let i = 0; i < M; i++) {
        const deck = buildAiDeck(ctx, `c${i}`)
        const s = play({ A: deck, B: deck }, { A: camp, B: camp }, i, cfg)
        if (s.result!.winner === 'draw') cDraw++
        cDmg += Object.values(s.units).reduce((a, u) => a + (u.instance.stats.hp - Math.max(0, u.hp)), 0)
      }
      console.log(`[변형] ${name.padEnd(12)} 전멸 종료 ${pct(ann, N)} · 무 ${pct(draw, N)} · 평균 ${(turns / N).toFixed(1)}턴 · 이동 비중 ${pct(moves, slots)} | 후방고수끼리: 무 ${pct(cDraw, M)} · 판당 피해 ${(cDmg / M).toFixed(0)}`)
    }
  }, 900_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (판 크기)', () => {
  it('7. 판 크기 비교', () => {
    const variants: [string, Partial<GameConfig>][] = [
      ['5×5 (진영2·중립1)', {}],
      ['6×6 (진영2·중립2)', { boardWidth: 6, boardHeight: 6, zoneRows: 2 }],
      ['6×6 (진영3·중립0)', { boardWidth: 6, boardHeight: 6, zoneRows: 3 }],
      ['6×5 (가로만 6)', { boardWidth: 6, boardHeight: 5, zoneRows: 2 }],
    ]
    const camp = POLICIES['후방 고수 (접근 안 함, 회피 강함)']!
    const N = 80
    for (const [name, cfg] of variants) {
      let ann = 0, draw = 0, turns = 0, dmg = 0
      for (let i = 0; i < N; i++) {
        const s = play({ A: buildAiDeck(ctx, `bv${i}`), B: buildAiDeck(ctx, `bw${i}`) }, { A: standard, B: standard }, i, cfg)
        turns += s.turn - 1
        if (s.result!.reason === 'annihilation') ann++
        if (s.result!.winner === 'draw') draw++
        dmg += Object.values(s.units).reduce((a, u) => a + (u.instance.stats.hp - Math.max(0, u.hp)), 0)
      }
      let cDraw = 0, cDmg = 0
      const M = 40
      for (let i = 0; i < M; i++) {
        const deck = buildAiDeck(ctx, `bc${i}`)
        const s = play({ A: deck, B: deck }, { A: camp, B: camp }, i, cfg)
        if (s.result!.winner === 'draw') cDraw++
        cDmg += Object.values(s.units).reduce((a, u) => a + (u.instance.stats.hp - Math.max(0, u.hp)), 0)
      }
      console.log(`[판] ${name.padEnd(14)} 전멸 종료 ${pct(ann, N)} · 무 ${pct(draw, N)} · 평균 ${(turns / N).toFixed(1)}턴 · 판당 피해 ${(dmg / N).toFixed(0)} | 후방고수끼리: 무 ${pct(cDraw, M)} · 피해 ${(cDmg / M).toFixed(0)}`)
    }
  }, 900_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (위험지대)', () => {
  it('8. 위험지대 설정 비교 (목표: 전멸 종료 70%+, 평균 8~12턴)', () => {
    const variants: [string, Partial<GameConfig>][] = [
      ['없음', { dangerZoneStartTurn: 0 }],
      ['8턴·20%·1줄', { dangerZoneStartTurn: 8, dangerZoneDamageBp: 2000, dangerZoneMaxDepth: 1 }],
      ['6턴·20%·1줄', { dangerZoneStartTurn: 6, dangerZoneDamageBp: 2000, dangerZoneMaxDepth: 1 }],
      ['6턴·25%·2줄(+5턴)', { dangerZoneStartTurn: 6, dangerZoneDamageBp: 2500, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 5 }],
      ['5턴·25%·2줄(+4턴)', { dangerZoneStartTurn: 5, dangerZoneDamageBp: 2500, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 4 }],
      ['4턴·20%·2줄(+4턴)', { dangerZoneStartTurn: 4, dangerZoneDamageBp: 2000, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 4 }],
    ]
    const camp = POLICIES['후방 고수 (접근 안 함, 회피 강함)']!
    const N = 80
    for (const [name, cfg] of variants) {
      let ann = 0, draw = 0, turns = 0
      const hist = new Map<number, number>()
      for (let i = 0; i < N; i++) {
        const s = play({ A: buildAiDeck(ctx, `zv${i}`), B: buildAiDeck(ctx, `zw${i}`) }, { A: standard, B: standard }, i, cfg)
        const t = s.turn - 1
        turns += t
        hist.set(t, (hist.get(t) ?? 0) + 1)
        if (s.result!.reason === 'annihilation') ann++
        if (s.result!.winner === 'draw') draw++
      }
      let cDraw = 0, cAnn = 0
      const M = 40
      for (let i = 0; i < M; i++) {
        const deck = buildAiDeck(ctx, `zc${i}`)
        const s = play({ A: deck, B: deck }, { A: camp, B: camp }, i, cfg)
        if (s.result!.winner === 'draw') cDraw++
        if (s.result!.reason === 'annihilation') cAnn++
      }
      const within = [...hist].filter(([t]) => t >= 8 && t <= 12).reduce((a, [, n]) => a + n, 0)
      console.log(`[위험] ${name.padEnd(16)} 전멸 ${pct(ann, N)} · 무 ${pct(draw, N)} · 평균 ${(turns / N).toFixed(1)}턴 · 8~12턴 비율 ${pct(within, N)} | 후방고수끼리: 전멸 ${pct(cAnn, M)} 무 ${pct(cDraw, M)}`)
    }
  }, 900_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (체력 조정)', () => {
  it('9. 챔프 체력 배율 × 위험지대', () => {
    const zones: [string, Partial<GameConfig>][] = [
      ['6턴·25%·2줄', { dangerZoneStartTurn: 6, dangerZoneDamageBp: 2500, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 5 }],
      ['4턴·20%·2줄', { dangerZoneStartTurn: 4, dangerZoneDamageBp: 2000, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 4 }],
    ]
    const N = 80
    for (const mult of [1, 0.8, 0.7, 0.6])
      for (const [zname, cfg] of zones) {
        const champs = MVP_CHAMPS.map((c) => ({
          ...c,
          statRanges: {
            ...c.statRanges,
            hp: { min: Math.max(1, Math.round(c.statRanges.hp.min * mult)), max: Math.max(1, Math.round(c.statRanges.hp.max * mult)) },
          },
        }))
        const cctx = makeGachaContext({ champs })
        let ann = 0, turns = 0, within = 0
        for (let i = 0; i < N; i++) {
          const s = play({ A: buildAiDeck(cctx, `hv${i}`), B: buildAiDeck(cctx, `hw${i}`) }, { A: standard, B: standard }, i, cfg, champs)
          const t = s.turn - 1
          turns += t
          if (t >= 8 && t <= 12) within++
          if (s.result!.reason === 'annihilation') ann++
        }
        console.log(`[체력] ×${mult} ${zname.padEnd(10)} 전멸 ${pct(ann, N)} · 평균 ${(turns / N).toFixed(1)}턴 · 8~12턴 ${pct(within, N)}`)
      }
  }, 900_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (능력치 범위)', () => {
  it('10. 능력치 범위 제안 비교', () => {
    type R = { hp: [number, number]; atk: [number, number]; armor: [number, number] }
    const uniform = (r: R) =>
      MVP_CHAMPS.map((c) => ({
        ...c,
        statRanges: {
          hp: { min: r.hp[0], max: r.hp[1] },
          atk: { min: r.atk[0], max: r.atk[1] },
          armor: { min: r.armor[0], max: r.armor[1] },
        },
      }))
    /** 역할 차이 유지: 현재 범위를 비율로 넓힘 */
    const widened = MVP_CHAMPS.map((c) => {
      const w = (lo: number, hi: number, f: number) => ({ min: Math.max(0, Math.round(lo * f)), max: Math.round(hi * f) })
      return {
        ...c,
        statRanges: {
          hp: w(c.statRanges.hp.min, c.statRanges.hp.max + 4, 1.1),
          atk: { min: c.statRanges.atk.min - 1, max: c.statRanges.atk.max + 1 },
          armor: { min: c.statRanges.armor.min, max: c.statRanges.armor.max + 1 },
        },
      }
    })
    const variants: [string, readonly ChampTemplate[]][] = [
      ['현재 (챔프별 범위)', MVP_CHAMPS],
      ['제안: 체12~20 공2~5 방2~5', uniform({ hp: [12, 20], atk: [2, 5], armor: [2, 5] })],
      ['대안1: 체12~20 공4~8 방0~3', uniform({ hp: [12, 20], atk: [4, 8], armor: [0, 3] })],
      ['대안2: 체12~20 공5~9 방1~4', uniform({ hp: [12, 20], atk: [5, 9], armor: [1, 4] })],
      ['대안3: 현재 역할차 유지+폭 확대', widened],
    ]
    const N = 80
    for (const [name, champs] of variants) {
      const cctx = makeGachaContext({ champs })
      let ann = 0, turns = 0, hits = 0, minHits = 0, atkDmg = 0, zoneDmg = 0
      for (let i = 0; i < N; i++) {
        let s = createGame({ teams: { A: buildAiDeck(cctx, `sv${i}`), B: buildAiDeck(cctx, `sw${i}`) }, catalog: champs })
        s = deploy(s, { A: planDeployment(s, 'A', s.teams.A, i), B: planDeployment(s, 'B', s.teams.B, i + 7) })
        while (s.phase === 'plan') {
          const r = resolveTurn(s, { A: standard(s, 'A', i), B: standard(s, 'B', i + 1) })
          for (const e of [...r.log.steps.flatMap((x) => x.events), ...r.log.endEvents]) {
            if (e.type === 'attack')
              for (const h of e.hits) {
                hits++
                if (h.afterArmor === 1 && h.base > 1) minHits++
                atkDmg += h.hpDamage + (h.reflect?.hpDamage ?? 0)
              }
            if (e.type === 'zoneDamage') zoneDmg += e.amount
          }
          s = r.state
        }
        turns += s.turn - 1
        if (s.result!.reason === 'annihilation') ann++
      }
      console.log(
        `[범위] ${name.padEnd(22)} 전멸 ${pct(ann, N)} · 평균 ${(turns / N).toFixed(1)}턴 · 최소피해(1) 비율 ${pct(minHits, hits)} · 전체 피해 중 위험지대 ${pct(zoneDmg, zoneDmg + atkDmg)}`,
      )
    }
  }, 900_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (근접 돌격병)', () => {
  it('11. 돌격병 근접화 비교 (포함 덱 승률 50% 근처가 목표)', () => {
    const mk = (patch: Partial<ChampTemplate>) => MVP_CHAMPS.map((c) => (c.id === 'vanguard' ? { ...c, ...patch } : c))
    const melee = (atk: [number, number], move: number, hp: [number, number] = [10, 14]): Partial<ChampTemplate> => ({
      trajectory: { kind: 'straight', range: 1, falloffBp: 0 },
      moveRange: move,
      statRanges: { hp: { min: hp[0], max: hp[1] }, atk: { min: atk[0], max: atk[1] }, armor: { min: 0, max: 1 } },
    })
    const variants: [string, readonly ChampTemplate[]][] = [
      ['현재: 직사 4칸·관통·공7~9', MVP_CHAMPS],
      ['근접 1칸·공12~15·이동1', mk(melee([12, 15], 1))],
      ['근접 1칸·공12~15·이동2', mk(melee([12, 15], 2))],
      ['근접 1칸·공15~18·이동2', mk(melee([15, 18], 2))],
      ['근접 1칸·공12~15·이동2·체14~18', mk(melee([12, 15], 2, [14, 18]))],
      [
        '앞 3칸 베기·공10~13·이동2·체14~18',
        mk({
          ...melee([10, 13], 2, [14, 18]),
          // 시뮬레이션용 근사: 인접 칸을 조준하면 그 칸과 좌우 칸(= 앞 3칸)
          trajectory: { kind: 'area', range: 1, shape: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], damageBp: 10000 },
        }),
      ],
      [
        '앞 3칸 베기·공12~15·이동2·체14~18',
        mk({
          ...melee([12, 15], 2, [14, 18]),
          trajectory: { kind: 'area', range: 1, shape: [{ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }], damageBp: 10000 },
        }),
      ],
    ]
    const N = 400
    for (const [name, champs] of variants.filter(([n]) => /현재|근접 1칸·공12~15·이동2·체|베기·공10/.test(n))) {
      const cctx = makeGachaContext({ champs })
      let w = 0, n = 0, vAtk = 0, vHit = 0, vDmg = 0
      for (let i = 0; i < N; i++) {
        const A = buildAiDeck(cctx, `mv${i}`)
        const B = buildAiDeck(cctx, `mw${i}`)
        let s = createGame({ teams: { A, B }, catalog: champs })
        s = deploy(s, { A: planDeployment(s, 'A', A, i), B: planDeployment(s, 'B', B, i + 7) })
        while (s.phase === 'plan') {
          const r = resolveTurn(s, { A: standard(s, 'A', i), B: standard(s, 'B', i + 1) })
          for (const e of r.log.steps.flatMap((x) => x.events))
            if (e.type === 'attack' && s.units[e.unit]!.instance.champId === 'vanguard') {
              vAtk++
              if (e.hits.length) vHit++
              vDmg += e.hits.reduce((a, h) => a + h.hpDamage, 0)
            }
          s = r.state
        }
        const res = s.result!
        for (const [side, team] of [['A', A], ['B', B]] as const)
          if (team.some((u) => u.champId === 'vanguard')) {
            n++
            w += res.winner === side ? 1 : res.winner === 'draw' ? 0.5 : 0
          }
      }
      console.log(`[돌격] ${name.padEnd(24)} 포함 덱 승률 ${pct(w, n)} (n=${n}) · 공격 ${vAtk}회 중 명중 ${pct(vHit, vAtk)} · 명중당 피해 ${(vDmg / Math.max(1, vHit)).toFixed(1)}`)
    }
  }, 900_000)
})

describe.skipIf(!RUN)('밸런스 시뮬레이션 (6×6)', () => {
  it('12. 6×6 위험지대 설정', () => {
    const variants: [string, Partial<GameConfig>][] = [
      ['위험지대 없음', { dangerZoneStartTurn: 0 }],
      ['6턴·25%·최대2줄(+5)', { dangerZoneStartTurn: 6, dangerZoneDamageBp: 2500, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 5 }],
      ['5턴·25%·최대2줄(+3)', { dangerZoneStartTurn: 5, dangerZoneDamageBp: 2500, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 3 }],
      ['4턴·20%·최대2줄(+3)', { dangerZoneStartTurn: 4, dangerZoneDamageBp: 2000, dangerZoneMaxDepth: 2, dangerZoneGrowEveryTurns: 3 }],
      ['5턴·25%·최대3줄(+3)', { dangerZoneStartTurn: 5, dangerZoneDamageBp: 2500, dangerZoneMaxDepth: 3, dangerZoneGrowEveryTurns: 3 }],
    ]
    const camp = POLICIES['후방 고수 (접근 안 함, 회피 강함)']!
    const N = 80
    for (const [name, cfg] of variants) {
      let ann = 0, turns = 0, within = 0
      for (let i = 0; i < N; i++) {
        const s = play({ A: buildAiDeck(ctx, `sx${i}`), B: buildAiDeck(ctx, `sy${i}`) }, { A: standard, B: standard }, i, cfg)
        const t = s.turn - 1
        turns += t
        if (t >= 8 && t <= 12) within++
        if (s.result!.reason === 'annihilation') ann++
      }
      let cDraw = 0
      const M = 40
      for (let i = 0; i < M; i++) {
        const deck = buildAiDeck(ctx, `sc${i}`)
        if (play({ A: deck, B: deck }, { A: camp, B: camp }, i, cfg).result!.winner === 'draw') cDraw++
      }
      console.log(`[6x6] ${name.padEnd(18)} 전멸 ${pct(ann, N)} · 평균 ${(turns / N).toFixed(1)}턴 · 8~12턴 ${pct(within, N)} | 후방고수끼리 무 ${pct(cDraw, M)}`)
    }
  }, 900_000)
})
