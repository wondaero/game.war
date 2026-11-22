import {
  createUnit,
  CURRENCIES,
  describeTable,
  pull,
  pullCost,
  reroll,
  rerollCost,
  validateLocks,
  validateTeam,
  type Cost,
  type CurrencyId,
  type GachaContext,
  type RerollLocks,
  type TableDescription,
  type UnitInstance,
} from '@war/engine'
import { DEV_UNLIMITED_RESOURCES } from './config.ts'
import { NotFoundError, type Repos, type UnitOfWork, type Wallet } from './repositories.ts'

/**
 * UI 가 호출하는 유일한 게임 데이터 창구 (명령 단위).
 * - 지금: LocalGameService (엔진 + Repository 를 클라이언트에서 실행)
 * - 나중: RemoteGameService (같은 명령을 서버 함수로 호출, 서버 안에서 엔진 + Supabase Repository)
 * 뽑기·리롤 판정이 클라이언트에 있으면 결과 위조가 가능하므로, 온라인에서는 반드시 서버 구현을 쓴다.
 */
export interface GameService {
  getWallet(): Promise<Wallet>
  listUnits(): Promise<UnitInstance[]>
  getUnit(id: string): Promise<UnitInstance | null>

  pullCost(count: 1 | 10): Cost
  pull(count: 1 | 10): Promise<{ units: UnitInstance[]; cost: Cost; wallet: Wallet }>

  rerollCost(locks: RerollLocks): Cost
  reroll(unitId: string, locks: RerollLocks): Promise<{ before: UnitInstance; after: UnitInstance; cost: Cost; wallet: Wallet }>

  getDeck(): Promise<string[]>
  setDeck(unitIds: string[]): Promise<void>

  /** 확률 정보 화면 (확률표에서 자동 생성) */
  describeRates(): TableDescription
  /** 자원 비용이 실제로 차감되는지 */
  readonly chargesResources: boolean

  dev: {
    addResources(delta: Partial<Wallet>): Promise<Wallet>
    resetInventory(): Promise<void>
    grantChamp(champId: string): Promise<UnitInstance>
  }
}

export interface LocalGameServiceOptions {
  ctx: GachaContext
  uow: UnitOfWork
  now?: () => number
  /** 기본값: config 의 DEV_UNLIMITED_RESOURCES */
  unlimitedResources?: boolean
}

export class LocalGameService implements GameService {
  private readonly ctx: GachaContext
  private readonly uow: UnitOfWork
  private readonly now: () => number
  readonly chargesResources: boolean

  constructor(o: LocalGameServiceOptions) {
    this.ctx = o.ctx
    this.uow = o.uow
    this.now = o.now ?? (() => Date.now())
    this.chargesResources = !(o.unlimitedResources ?? DEV_UNLIMITED_RESOURCES)
  }

  private async charge(r: Repos, cost: Cost): Promise<Wallet> {
    if (!this.chargesResources) return r.wallet.get()
    const delta: Partial<Wallet> = {}
    for (const [k, v] of Object.entries(cost) as [CurrencyId, number][]) delta[k] = -v
    return r.wallet.apply(delta)
  }

  getWallet() {
    return this.uow.run((r) => r.wallet.get())
  }
  listUnits() {
    return this.uow.run((r) => r.inventory.list())
  }
  getUnit(id: string) {
    return this.uow.run((r) => r.inventory.get(id))
  }

  pullCost(count: 1 | 10) {
    return pullCost(this.ctx, count)
  }

  /** 자원 차감 + 개체 생성 + 저장 + 난수 상태 갱신을 한 단위로 */
  pull(count: 1 | 10) {
    return this.uow.run(async (r) => {
      const cost = pullCost(this.ctx, count)
      const wallet = await this.charge(r, cost)
      const res = pull(this.ctx, await r.gacha.getRng(), count, this.now())
      await r.inventory.add(res.units)
      await r.gacha.setRng(res.rng)
      return { units: res.units, cost, wallet }
    })
  }

  rerollCost(locks: RerollLocks) {
    return rerollCost(this.ctx, locks)
  }

  reroll(unitId: string, locks: RerollLocks) {
    return this.uow.run(async (r) => {
      const unit = await r.inventory.get(unitId)
      if (!unit) throw new NotFoundError(`unit ${unitId}`)
      const v = validateLocks(this.ctx, unit, locks)
      if (!v.ok) throw new Error(v.errors.join('; '))
      const cost = rerollCost(this.ctx, locks)
      const wallet = await this.charge(r, cost)
      const res = reroll(this.ctx, unit, locks, await r.gacha.getRng())
      await r.inventory.update(res.after)
      await r.gacha.setRng(res.rng)
      return { before: res.before, after: res.after, cost, wallet }
    })
  }

  getDeck() {
    return this.uow.run(async (r) => {
      // 보관함에서 사라진 유닛은 덱에서 제외
      const ids = new Set((await r.inventory.list()).map((u) => u.id))
      return (await r.deck.get()).filter((id) => ids.has(id))
    })
  }

  setDeck(unitIds: string[]) {
    return this.uow.run(async (r) => {
      const units = await Promise.all(unitIds.map((id) => r.inventory.get(id)))
      if (units.some((u) => !u)) throw new NotFoundError('deck unit')
      const v = validateTeam(this.ctx.config, this.ctx.catalog, units as UnitInstance[])
      if (!v.ok) throw new Error(v.errors.join('; '))
      await r.deck.set(unitIds)
    })
  }

  describeRates() {
    return describeTable(this.ctx)
  }

  readonly dev = {
    addResources: (delta: Partial<Wallet>) => this.uow.run((r) => r.wallet.apply(delta)),
    resetInventory: () => this.uow.run((r) => r.inventory.clear()),
    grantChamp: (champId: string) =>
      this.uow.run(async (r) => {
        const res = createUnit(this.ctx, champId, await r.gacha.getRng(), this.now())
        await r.inventory.add([res.unit])
        await r.gacha.setRng(res.rng)
        return res.unit
      }),
  }
}

export const ZERO_WALLET = (): Wallet => Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Wallet
