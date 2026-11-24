import { CURRENCIES, type RngState, type UnitInstance } from '@war/v2'
import {
  InsufficientFundsError,
  NotFoundError,
  type DeckRepository,
  type GachaStateRepository,
  type InventoryRepository,
  type Repos,
  type UnitOfWork,
  type Wallet,
  type WalletRepository,
} from './repositories.ts'
import { emptySave, migrate, MIGRATIONS, SCHEMA_VERSION, type Migration, type SaveData } from './save.ts'

/** localStorage 와 같은 모양 (테스트에서는 메모리 구현 주입) */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export class MemoryStorage implements KeyValueStorage {
  readonly map = new Map<string, string>()
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// ───────────── 저장 데이터(초안) 위에서 동작하는 Repository 구현 ─────────────

export class LocalStorageInventoryRepository implements InventoryRepository {
  constructor(private readonly data: SaveData) {}
  async list() {
    return clone(this.data.inventory)
  }
  async get(id: string) {
    const u = this.data.inventory.find((x) => x.id === id)
    return u ? clone(u) : null
  }
  async add(units: readonly UnitInstance[]) {
    for (const u of units) {
      if (this.data.inventory.some((x) => x.id === u.id)) throw new Error(`Duplicate unit id ${u.id}`)
      this.data.inventory.push(clone(u))
    }
  }
  async update(unit: UnitInstance) {
    const i = this.data.inventory.findIndex((x) => x.id === unit.id)
    if (i < 0) throw new NotFoundError(`unit ${unit.id}`)
    this.data.inventory[i] = clone(unit)
  }
  async remove(id: string) {
    this.data.inventory = this.data.inventory.filter((x) => x.id !== id)
    this.data.deck = this.data.deck.filter((x) => x !== id)
  }
  async clear() {
    this.data.inventory = []
    this.data.deck = []
  }
}

export class LocalStorageWalletRepository implements WalletRepository {
  constructor(private readonly data: SaveData) {}
  /** 예전 저장에 없는 재화는 0 으로 채움 */
  private full(): Wallet {
    return { ...(Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Wallet), ...this.data.wallet }
  }
  async get() {
    return clone(this.full())
  }
  async apply(delta: Partial<Wallet>) {
    const next = this.full()
    for (const [k, v] of Object.entries(delta) as [keyof Wallet, number][]) {
      next[k] = (next[k] ?? 0) + v
      if (next[k] < 0) throw new InsufficientFundsError(k, -v, this.data.wallet[k] ?? 0)
    }
    this.data.wallet = next
    return clone(next)
  }
}

export class LocalStorageDeckRepository implements DeckRepository {
  constructor(private readonly data: SaveData) {}
  async get() {
    return [...this.data.deck]
  }
  async set(ids: readonly string[]) {
    this.data.deck = [...ids]
  }
}

export class LocalStorageGachaStateRepository implements GachaStateRepository {
  constructor(private readonly data: SaveData) {}
  async getRng() {
    return { ...this.data.gachaRng }
  }
  async setRng(s: RngState) {
    this.data.gachaRng = { ...s }
  }
}

// ───────────── 저장소 (키 하나 = 원자적 저장) ─────────────

export interface LocalSaveStoreOptions {
  key?: string
  /** 최초 생성 시 뽑기 난수 시드 */
  newSeed: () => number
  migrations?: Readonly<Record<number, Migration>>
  schemaVersion?: number
}

/**
 * 저장 데이터 전체를 localStorage 키 하나에 저장.
 * run(fn): 초안 복사본에서 fn 실행 → 성공하면 한 번에 저장, 실패하면 아무것도 저장 안 함.
 * 호출은 직렬화되어 동시에 겹치지 않는다.
 */
export class LocalSaveStore implements UnitOfWork {
  private cache: SaveData | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private readonly key: string

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly opts: LocalSaveStoreOptions,
  ) {
    this.key = opts.key ?? 'gamewar:save'
  }

  private load(): SaveData {
    if (this.cache) return this.cache
    const raw = this.storage.getItem(this.key)
    if (raw === null) {
      this.cache = emptySave(this.opts.newSeed())
    } else {
      const parsed = JSON.parse(raw) as { schemaVersion?: number }
      this.cache = migrate(parsed, this.opts.migrations ?? MIGRATIONS, this.opts.schemaVersion ?? SCHEMA_VERSION)
      if (parsed.schemaVersion !== this.cache.schemaVersion) this.persist(this.cache) // 마이그레이션 결과 저장
    }
    return this.cache
  }

  private persist(data: SaveData) {
    this.storage.setItem(this.key, JSON.stringify(data))
  }

  run<T>(fn: (repos: Repos) => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      const draft = clone(this.load())
      const result = await fn(reposOn(draft))
      this.persist(draft)
      this.cache = draft
      return result
    })
    this.queue = job.catch(() => undefined)
    return job
  }

  /** 트랜잭션 밖에서 쓰는 Repository: 호출마다 자동으로 run() 한 번 */
  readonly repos: Repos = {
    inventory: autoTx(this, 'inventory'),
    wallet: autoTx(this, 'wallet'),
    deck: autoTx(this, 'deck'),
    gacha: autoTx(this, 'gacha'),
  }
}

function reposOn(data: SaveData): Repos {
  return {
    inventory: new LocalStorageInventoryRepository(data),
    wallet: new LocalStorageWalletRepository(data),
    deck: new LocalStorageDeckRepository(data),
    gacha: new LocalStorageGachaStateRepository(data),
  }
}

function autoTx<K extends keyof Repos>(uow: UnitOfWork, key: K): Repos[K] {
  return new Proxy({} as Repos[K], {
    get: (_t, prop) =>
      (...args: unknown[]) =>
        uow.run((r) => (r[key] as unknown as Record<string | symbol, (...a: unknown[]) => Promise<unknown>>)[prop]!(...args)),
  })
}
