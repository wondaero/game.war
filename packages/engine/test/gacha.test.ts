import { describe, expect, it } from 'vitest'
import { MVP_CHAMPS } from '../src/cards/catalog.ts'
import {
  createUnit,
  DEFAULT_GACHA_TABLE,
  describeTable,
  makeGachaContext,
  pull,
  reroll,
  rerollCost,
  validateUnit,
} from '../src/gacha/index.ts'
import { createRngState, type RngState } from '../src/rng.ts'
import { HEAL_SPECIALS, STAT_KEYS, type UnitInstance } from '../src/types.ts'

const ctx = makeGachaContext()
const NOW = 1_700_000_000_000

function pullMany(n: number, seed: string): UnitInstance[] {
  return pull(ctx, createRngState(seed), n, NOW).units
}

describe('개체 생성', () => {
  const units = pullMany(3000, 'range')

  it('모든 일반 능력치가 챔프 범위 안 (validateUnit 통과)', () => {
    for (const u of units) {
      const c = ctx.catalog[u.champId]!
      for (const k of STAT_KEYS) {
        expect(u.stats[k]).toBeGreaterThanOrEqual(c.statRanges[k].min)
        expect(u.stats[k]).toBeLessThanOrEqual(c.statRanges[k].max)
      }
      expect(validateUnit(ctx, u)).toEqual({ ok: true })
    }
  })

  it('범위 양 끝값도 실제로 나옴', () => {
    const hp = units.filter((u) => u.champId === 'vanguard').map((u) => u.stats.hp)
    expect(Math.min(...hp)).toBe(10)
    expect(Math.max(...hp)).toBe(14)
  })

  it('특수능력: 슬롯 수 = 챔프 고정, 같은 종류 중복 없음, 회복 계열 최대 1개', () => {
    for (const u of units) {
      const kinds = u.specials.map((s) => s.kind)
      expect(kinds.length).toBe(ctx.catalog[u.champId]!.specialSlots)
      expect(new Set(kinds).size).toBe(kinds.length)
      expect(kinds.filter((k) => HEAL_SPECIALS.includes(k)).length).toBeLessThanOrEqual(1)
    }
  })

  it('특수능력 수치가 확률표 범위·단위 안', () => {
    for (const u of units)
      for (const s of u.specials) {
        const r = DEFAULT_GACHA_TABLE.specials[s.kind]
        expect(s.value).toBeGreaterThanOrEqual(r.min)
        expect(s.value).toBeLessThanOrEqual(r.max)
        expect((s.value - r.min) % r.step).toBe(0)
      }
  })

  it('개체 id 는 고유', () => {
    expect(new Set(units.map((u) => u.id)).size).toBe(units.length)
  })

  it('validateUnit 은 범위 밖·중복·회복 2개를 거부', () => {
    const u = units.find((x) => x.champId === 'mirrormage')!
    expect(validateUnit(ctx, { ...u, stats: { ...u.stats, hp: 999 } }).ok).toBe(false)
    expect(validateUnit(ctx, { ...u, specials: [{ kind: 'shield', value: 3 }, { kind: 'shield', value: 3 }, { kind: 'reflect', value: 1000 }] }).ok).toBe(false)
    expect(validateUnit(ctx, { ...u, specials: [{ kind: 'regen', value: 1 }, { kind: 'lifesteal', value: 1000 }, { kind: 'shield', value: 3 }] }).ok).toBe(false)
  })
})

describe('결정성', () => {
  it('같은 시드 → 같은 뽑기 결과 (id 포함)와 같은 다음 난수 상태', () => {
    const a = pull(ctx, createRngState('s'), 10, NOW)
    const b = pull(ctx, createRngState('s'), 10, NOW)
    expect(a).toEqual(b)
  })
  it('난수 상태를 이어 쓰면 다음 뽑기는 달라짐', () => {
    const a = pull(ctx, createRngState('s'), 1, NOW)
    const b = pull(ctx, a.rng, 1, NOW)
    expect(b.units[0]!.id).not.toBe(a.units[0]!.id)
  })
  it('같은 시드 → 같은 리롤 결과', () => {
    const { unit } = createUnit(ctx, 'warden', createRngState(1), NOW)
    const r1 = reroll(ctx, unit, { stats: ['atk'] }, createRngState('r'))
    const r2 = reroll(ctx, unit, { stats: ['atk'] }, createRngState('r'))
    expect(r1).toEqual(r2)
  })
})

describe('리롤', () => {
  const base = createUnit(ctx, 'thornspirit', createRngState(7), NOW).unit

  it('잠금한 능력치는 유지, id·챔프·생성일 유지, 리롤 횟수 증가', () => {
    let rng: RngState = createRngState('lock')
    let cur = base
    for (let i = 0; i < 200; i++) {
      const r = reroll(ctx, cur, { stats: ['hp', 'armor'] }, rng)
      expect(r.after.stats.hp).toBe(base.stats.hp)
      expect(r.after.stats.armor).toBe(base.stats.armor)
      expect([r.after.id, r.after.champId, r.after.createdAt]).toEqual([base.id, base.champId, base.createdAt])
      expect(r.after.rerollCount).toBe(cur.rerollCount + 1)
      expect(r.before).toBe(cur)
      expect(validateUnit(ctx, r.after)).toEqual({ ok: true })
      cur = r.after
      rng = r.rng
    }
  })

  it('잠그지 않은 능력치와 특수능력은 실제로 바뀜', () => {
    let rng: RngState = createRngState('change')
    const atks = new Set<number>()
    const specials = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const r = reroll(ctx, base, { stats: [] }, rng)
      atks.add(r.after.stats.atk)
      specials.add(JSON.stringify(r.after.specials))
      rng = r.rng
    }
    expect(atks.size).toBeGreaterThan(1)
    expect(specials.size).toBeGreaterThan(10)
  })

  it('이동거리·사거리·슬롯 수는 변하지 않음 (개체에 덮어쓰기 값 없음)', () => {
    const r = reroll(ctx, base, { stats: [] }, createRngState(3))
    expect(r.after.specials.length).toBe(base.specials.length)
    expect(r.after.moveRangeOverride).toBeUndefined()
    expect(r.after.attackRangeOverride).toBeUndefined()
  })

  it('잠금은 최대 2개, 특수능력 잠금은 현재 불가', () => {
    expect(() => reroll(ctx, base, { stats: ['hp', 'atk', 'armor'] }, createRngState(1))).toThrow(/at most 2 stat locks/)
    expect(() => reroll(ctx, base, { stats: [], specialSlots: [0] }, createRngState(1))).toThrow(/special locks/)
  })

  it('비용 배율: 잠금 0/1/2개 = 1/3/8배', () => {
    expect(rerollCost(ctx, { stats: [] })).toEqual({ rerollStone: 10 })
    expect(rerollCost(ctx, { stats: ['hp'] })).toEqual({ rerollStone: 30 })
    expect(rerollCost(ctx, { stats: ['hp', 'atk'] })).toEqual({ rerollStone: 80 })
  })

  it('특수능력 잠금을 열면(config) 잠근 슬롯은 유지되고 나머지는 중복 없이 채워짐', () => {
    const open = makeGachaContext({ config: { maxSpecialLocks: 1 }, table: { ...DEFAULT_GACHA_TABLE, lockMultiplier: [1, 3, 8, 20] } })
    let rng: RngState = createRngState('sl')
    for (let i = 0; i < 100; i++) {
      const r = reroll(open, base, { stats: [], specialSlots: [1] }, rng)
      expect(r.after.specials[1]).toEqual(base.specials[1])
      expect(new Set(r.after.specials.map((s) => s.kind)).size).toBe(3)
      rng = r.rng
    }
  })

  it('rerollMovementAndRange=true 면 이동거리·사거리도 범위 안에서 돌림', () => {
    const champs = MVP_CHAMPS.map((c) =>
      c.id === 'vanguard' ? { ...c, moveRangeRange: { min: 1, max: 2 }, attackRangeRange: { min: 3, max: 4 } } : c,
    )
    const flex = makeGachaContext({ champs, config: { rerollMovementAndRange: true } })
    const seen = new Set<string>()
    let rng: RngState = createRngState('mv')
    for (let i = 0; i < 100; i++) {
      const r = createUnit(flex, 'vanguard', rng, NOW)
      seen.add(`${r.unit.moveRangeOverride}/${r.unit.attackRangeOverride}`)
      rng = r.rng
    }
    expect(seen).toEqual(new Set(['1/3', '1/4', '2/3', '2/4']))
  })
})

describe('확률표대로 뽑히는지 (대량 시뮬레이션)', () => {
  const N = 40_000
  const units = pullMany(N, 'dist')
  const desc = describeTable(ctx)
  const close = (observed: number, expected: number) => expect(Math.abs(observed - expected)).toBeLessThan(0.012)

  it('챔프별 확률 = 공개된 확률 (등급 × 등급 내 비중)', () => {
    const total = desc.champs.reduce((s, c) => s + c.probability, 0)
    expect(total).toBeCloseTo(1, 10)
    for (const c of desc.champs) close(units.filter((u) => u.champId === c.id).length / N, c.probability)
  })

  it('등급별 확률 = 공개된 확률', () => {
    for (const r of desc.rarities) {
      const n = units.filter((u) => ctx.catalog[u.champId]!.rarity === r.id).length
      close(n / N, r.probability)
    }
  })

  it('능력치 구간 확률 = 공개된 확률 (범위가 넓은 수호기사 체력 13~17, 2만 개체)', () => {
    let rng: RngState = createRngState('tier')
    const ws: number[] = []
    for (let i = 0; i < 20_000; i++) {
      const r = createUnit(ctx, 'warden', rng, NOW)
      ws.push(r.unit.stats.hp)
      rng = r.rng
    }
    // 공개 규칙(구간 확률 × 구간 안 균등)으로 값별 기대 확률 계산
    const expected = new Map<number, number>()
    for (const t of DEFAULT_GACHA_TABLE.statTiers) {
      const p = t.weight / 10000
      for (let bp = t.fromBp; bp < t.toBp; bp++) {
        const v = 13 + Math.floor((bp * 5) / 10000)
        expected.set(v, (expected.get(v) ?? 0) + p / (t.toBp - t.fromBp))
      }
    }
    for (const [v, p] of expected) close(ws.filter((x) => x === v).length / ws.length, p)
  })

  it('첫 슬롯 특수능력 종류 확률 = 공개된 확률', () => {
    for (const s of desc.specials) close(units.filter((u) => u.specials[0]?.kind === s.kind).length / N, s.probability)
  })
})
