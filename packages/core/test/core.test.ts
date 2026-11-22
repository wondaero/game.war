import { describe, expect, it } from 'vitest'
import { makeGachaContext, type UnitInstance } from '@war/engine'
import {
  InsufficientFundsError,
  LocalGameService,
  LocalSaveStore,
  MemoryStorage,
  SaveVersionError,
  type Migration,
} from '../src/index.ts'

const ctx = makeGachaContext()
const KEY = 'gamewar:save'

function setup(o: { storage?: MemoryStorage; unlimited?: boolean; seed?: number } = {}) {
  const storage = o.storage ?? new MemoryStorage()
  const store = new LocalSaveStore(storage, { newSeed: () => o.seed ?? 42 })
  const svc = new LocalGameService({ ctx, uow: store, now: () => 1000, unlimitedResources: o.unlimited ?? true })
  return { storage, store, svc }
}

describe('Repository 저장 → 불러오기', () => {
  it('새 저장소 인스턴스로 다시 열어도 데이터 동일', async () => {
    const { storage, store, svc } = setup()
    await svc.pull(10)
    const unit = (await svc.listUnits())[0]!
    await svc.reroll(unit.id, { stats: ['hp'] })
    await store.repos.wallet.apply({ gem: 500, rerollStone: 7 })
    const ids = (await svc.listUnits()).filter((u, i, a) => a.findIndex((x) => x.champId === u.champId) === i).slice(0, 4)
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
    expect(JSON.parse(storage.getItem(KEY)!).schemaVersion).toBe(1)
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

  it('실제 차감 모드: 뽑기·리롤 비용(잠금 배율 포함) 차감', async () => {
    const { svc } = setup({ unlimited: false })
    await svc.dev.addResources({ gem: 1100, rerollStone: 100 })
    await svc.pull(10)
    expect((await svc.getWallet()).gem).toBe(100)
    const u = (await svc.listUnits())[0]!
    const r = await svc.reroll(u.id, { stats: ['hp', 'atk'] })
    expect(r.cost).toEqual({ rerollStone: 80 })
    expect(r.wallet.rerollStone).toBe(20)
    await expect(svc.reroll(u.id, { stats: ['hp'] })).rejects.toBeInstanceOf(InsufficientFundsError)
  })
})

describe('뽑기·리롤 서비스', () => {
  it('같은 저장 시드 → 같은 뽑기 결과', async () => {
    const a = await setup({ seed: 5 }).svc.pull(10)
    const b = await setup({ seed: 5 }).svc.pull(10)
    expect(a.units).toEqual(b.units)
  })

  it('리롤 결과가 저장되고 잠금 능력치 유지', async () => {
    const { svc } = setup()
    const [u] = (await svc.pull(1)).units as [UnitInstance]
    const r = await svc.reroll(u.id, { stats: ['atk'] })
    expect(r.after.stats.atk).toBe(u.stats.atk)
    expect(await svc.getUnit(u.id)).toEqual(r.after)
  })

  it('덱: 4장·챔프 중복 불가 검증, 보관함에서 지운 유닛은 덱에서 제외', async () => {
    const { store, svc } = setup()
    const champs = ['vanguard', 'sniper', 'mortar', 'warden']
    const units = []
    for (const c of champs) units.push(await svc.dev.grantChamp(c))
    const dup = await svc.dev.grantChamp('vanguard')
    await expect(svc.setDeck([units[0]!.id, dup.id, units[2]!.id, units[3]!.id])).rejects.toThrow(/duplicate champ/)
    await expect(svc.setDeck(units.slice(0, 3).map((u) => u.id))).rejects.toThrow()
    await svc.setDeck(units.map((u) => u.id))
    await store.repos.inventory.remove(units[0]!.id)
    expect(await svc.getDeck()).toEqual(units.slice(1).map((u) => u.id))
  })

  it('개발 메뉴: 특정 챔프 지급, 보관함 초기화', async () => {
    const { svc } = setup()
    expect((await svc.dev.grantChamp('thornspirit')).champId).toBe('thornspirit')
    await svc.dev.resetInventory()
    expect(await svc.listUnits()).toEqual([])
  })

  it('확률 정보는 확률표에서 생성', () => {
    const d = setup().svc.describeRates()
    expect(d.rarities.map((r) => r.id)).toEqual(['R', 'SR', 'SSR'])
    expect(d.champs.reduce((s, c) => s + c.probability, 0)).toBeCloseTo(1)
  })
})

describe('스키마 마이그레이션', () => {
  const v0 = { schemaVersion: 0, units: [], gems: 77, deck: [], rng: 3 }
  const migrations: Record<number, Migration> = {
    0: (old) => ({
      schemaVersion: 1,
      inventory: old.units,
      wallet: { gem: old.gems, rerollStone: 0 },
      deck: old.deck,
      gachaRng: { s: old.rng },
    }),
  }

  it('구버전 데이터를 순서대로 변환하고 변환 결과를 저장', async () => {
    const storage = new MemoryStorage()
    storage.setItem(KEY, JSON.stringify(v0))
    const store = new LocalSaveStore(storage, { newSeed: () => 1, migrations })
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
