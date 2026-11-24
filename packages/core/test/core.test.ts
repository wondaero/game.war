import { describe, expect, it } from 'vitest'
import type { UnitInstance } from '@war/v2'
import {
  InsufficientFundsError,
  LocalGameService,
  LocalSaveStore,
  MemoryStorage,
  SaveVersionError,
  type Migration,
} from '../src/index.ts'

const KEY = 'gamewar:save'

function setup(o: { storage?: MemoryStorage; unlimited?: boolean; seed?: number } = {}) {
  const storage = o.storage ?? new MemoryStorage()
  const store = new LocalSaveStore(storage, { newSeed: () => o.seed ?? 42 })
  const svc = new LocalGameService({ uow: store, now: () => 1000, unlimitedResources: o.unlimited ?? true })
  return { storage, store, svc }
}

describe('Repository 저장 → 불러오기', () => {
  it('새 저장소 인스턴스로 다시 열어도 데이터 동일', async () => {
    const { storage, store, svc } = setup()
    await svc.pull(10)
    await store.repos.wallet.apply({ gem: 500 })
    const ids = (await svc.listUnits()).filter((u, i, a) => a.findIndex((x) => x.image === u.image) === i).slice(0, 4)
    if (ids.length === 4) await svc.setDeck(ids.map((u) => u.id))

    const before = {
      units: await store.repos.inventory.list(),
      wallet: await store.repos.wallet.get(),
      deck: await store.repos.deck.get(),
      rng: await store.repos.gacha.getRng(),
    }
    const reopened = new LocalSaveStore(storage, { newSeed: () => 999 })
    expect({
      units: await reopened.repos.inventory.list(),
      wallet: await reopened.repos.wallet.get(),
      deck: await reopened.repos.deck.get(),
      rng: await reopened.repos.gacha.getRng(),
    }).toEqual(before)
  })

  it('반환값을 바꿔도 저장 데이터는 안 바뀜 (복사본 반환)', async () => {
    const { store, svc } = setup()
    await svc.pull(1)
    const list = await store.repos.inventory.list()
    list[0]!.stats.hp = 9999
    expect((await store.repos.inventory.list())[0]!.stats.hp).not.toBe(9999)
  })

  it('저장 데이터에 스키마 버전 포함', async () => {
    const { storage, svc } = setup()
    await svc.pull(1)
    expect(JSON.parse(storage.getItem(KEY)!).schemaVersion).toBe(2)
  })
})

describe('트랜잭션 (전부 반영 또는 전부 취소)', () => {
  it('자원 부족이면 유닛도 안 생기고 난수 상태도 그대로', async () => {
    const { store, svc } = setup({ unlimited: false })
    const rng = await store.repos.gacha.getRng()
    await expect(svc.pull(1)).rejects.toBeInstanceOf(InsufficientFundsError)
    expect(await svc.listUnits()).toEqual([])
    expect(await store.repos.gacha.getRng()).toEqual(rng)
  })

  it('중간에 예외가 나면 앞선 변경도 저장되지 않음', async () => {
    const { store } = setup()
    await expect(
      store.run(async (r) => {
        await r.wallet.apply({ gem: 100 })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect((await store.repos.wallet.get()).gem).toBe(0)
  })
})

describe('자원', () => {
  it('DEV_UNLIMITED: 비용은 계산되지만 차감 없음', async () => {
    const { svc } = setup({ unlimited: true })
    const r = await svc.pull(10)
    expect(r.cost).toEqual({ gem: 1000 })
    expect(r.wallet.gem).toBe(0)
    expect(r.units).toHaveLength(10)
  })

  it('실제 차감 모드: 뽑기 비용 차감, 부족하면 오류', async () => {
    const { svc } = setup({ unlimited: false })
    await svc.dev.addResources({ gem: 1100 })
    await svc.pull(10)
    expect((await svc.getWallet()).gem).toBe(100)
    await svc.pull(1)
    await expect(svc.pull(1)).rejects.toBeInstanceOf(InsufficientFundsError)
  })
})

describe('뽑기 서비스 (새 규칙)', () => {
  it('같은 저장 시드 → 같은 뽑기 결과', async () => {
    const a = await setup({ seed: 5 }).svc.pull(10)
    const b = await setup({ seed: 5 }).svc.pull(10)
    expect(a.units).toEqual(b.units)
  })

  it('뽑은 유닛: 능력치 범위 안, 그림 8종 중 하나', async () => {
    const { units } = await setup({ seed: 9 }).svc.pull(10)
    for (const u of units) {
      expect(u.stats.atk).toBeGreaterThanOrEqual(15)
      expect(u.stats.atk).toBeLessThanOrEqual(20)
      expect(u.stats.range).toBeGreaterThanOrEqual(5)
      expect(u.stats.range).toBeLessThanOrEqual(10)
      expect(u.image).toMatch(/^img[1-8]$/)
    }
  })

  it('덱: 4명·같은 그림 불가, 보관함에서 지운 유닛은 덱에서 제외', async () => {
    const { store, svc } = setup()
    const units: UnitInstance[] = []
    while (units.length < 4) {
      const u = await svc.dev.grantUnit(null)
      if (!units.some((x) => x.image === u.image)) units.push(u)
    }
    let dup = await svc.dev.grantUnit(null)
    while (dup.image !== units[0]!.image) dup = await svc.dev.grantUnit(null)
    await expect(svc.setDeck([units[0]!.id, dup.id, units[2]!.id, units[3]!.id])).rejects.toThrow(/같은 그림/)
    await expect(svc.setDeck(units.slice(0, 3).map((u) => u.id))).rejects.toThrow()
    await svc.setDeck(units.map((u) => u.id))
    await store.repos.inventory.remove(units[0]!.id)
    expect(await svc.getDeck()).toEqual(units.slice(1).map((u) => u.id))
  })

  it('개발 메뉴: 능력 지정 지급, 보관함 초기화', async () => {
    const { svc } = setup()
    expect((await svc.dev.grantUnit('homing')).ability?.kind).toBe('homing')
    expect((await svc.dev.grantUnit(null)).ability).toBeNull()
    await svc.dev.resetInventory()
    expect(await svc.listUnits()).toEqual([])
  })

  it('확률 정보: 능력 확률 합 = 20%', () => {
    const d = setup().svc.describeRates()
    expect(d.abilities.reduce((s, a) => s + a.probability, 0)).toBeCloseTo(0.2)
  })
})

describe('합성 · 리롤', () => {
  it('합성: 3명 → 리롤석 1개, 덱에 있는 캐릭·중복·개수 틀림은 거부', async () => {
    const { svc } = setup()
    const units = (await svc.pull(10)).units
    const deck: string[] = []
    for (const u of units) if (deck.length < 4 && !deck.some((id) => units.find((x) => x.id === id)!.image === u.image)) deck.push(u.id)
    if (deck.length === 4) await svc.setDeck(deck)
    const free = units.filter((u) => !deck.includes(u.id)).map((u) => u.id)
    if (deck.length === 4) await expect(svc.merge([deck[0]!, free[0]!, free[1]!])).rejects.toThrow(/덱에 있는/)
    await expect(svc.merge([free[0]!, free[0]!, free[1]!])).rejects.toThrow()
    await expect(svc.merge([free[0]!, free[1]!])).rejects.toThrow()
    const r = await svc.merge(free.slice(0, 3))
    expect(r.wallet.rerollStone).toBe(1)
    expect((await svc.listUnits()).some((u) => free.slice(0, 3).includes(u.id))).toBe(false)
  })

  it('리롤: 리롤석 1개 차감 (개발 모드에서도), 그림·특수능력·잠근 능력치 유지', async () => {
    const { svc } = setup()
    const u = await svc.dev.grantUnit('homing')
    await expect(svc.reroll(u.id, 'hp')).rejects.toBeInstanceOf(InsufficientFundsError)
    await svc.dev.addResources({ rerollStone: 20 })
    let cur = u
    let changed = false
    for (let i = 0; i < 20; i++) {
      const r = await svc.reroll(cur.id, 'hp')
      expect(r.after.image).toBe(u.image)
      expect(r.after.ability).toEqual(u.ability)
      expect(r.after.stats.hp).toBe(u.stats.hp)
      if (JSON.stringify(r.after.stats) !== JSON.stringify(cur.stats)) changed = true
      cur = r.after
    }
    expect(changed).toBe(true)
    expect((await svc.getWallet()).rerollStone).toBe(0)
    expect(await svc.getUnit(u.id)).toEqual(cur)
  })
})

describe('스키마 마이그레이션', () => {
  it('예전 저장(v1, 챔피언 규칙) → v2: 유닛·덱은 비우고 보석은 유지', async () => {
    const storage = new MemoryStorage()
    storage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 1,
        inventory: [{ id: 'x', champId: 'mirror' }],
        wallet: { gem: 300, rerollStone: 5 },
        deck: ['x'],
        gachaRng: { s: 7 },
      }),
    )
    const store = new LocalSaveStore(storage, { newSeed: () => 1 })
    expect(await store.repos.inventory.list()).toEqual([])
    expect(await store.repos.wallet.get()).toEqual({ gem: 300, rerollStone: 0 })
    expect(JSON.parse(storage.getItem(KEY)!).schemaVersion).toBe(2)
  })

  const v0 = { schemaVersion: 0, units: [], gems: 77, deck: [], rng: 3 }
  const migrations: Record<number, Migration> = {
    0: (old) => ({ schemaVersion: 1, inventory: old.units, wallet: { gem: old.gems }, deck: old.deck, gachaRng: { s: old.rng } }),
  }

  it('구버전 데이터를 순서대로 변환하고 변환 결과를 저장', async () => {
    const storage = new MemoryStorage()
    storage.setItem(KEY, JSON.stringify(v0))
    const store = new LocalSaveStore(storage, { newSeed: () => 1, migrations, schemaVersion: 1 })
    expect((await store.repos.wallet.get()).gem).toBe(77)
    expect(JSON.parse(storage.getItem(KEY)!).schemaVersion).toBe(1)
  })

  it('앱보다 새 버전 데이터는 덮어쓰지 않고 오류', async () => {
    const storage = new MemoryStorage()
    const future = JSON.stringify({ schemaVersion: 99 })
    storage.setItem(KEY, future)
    const store = new LocalSaveStore(storage, { newSeed: () => 1 })
    await expect(store.repos.wallet.get()).rejects.toBeInstanceOf(SaveVersionError)
    expect(storage.getItem(KEY)).toBe(future)
  })

  it('변환 경로가 없으면 오류', async () => {
    const storage = new MemoryStorage()
    storage.setItem(KEY, JSON.stringify(v0))
    const store = new LocalSaveStore(storage, { newSeed: () => 1 })
    await expect(store.repos.wallet.get()).rejects.toThrow(/No migration/)
  })
})
