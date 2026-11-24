import {
  CURRENCIES,
  describeRates,
  grantUnit,
  makeV2Config,
  MAX_REROLL_LOCKS,
  MERGE_COUNT,
  MERGE_REWARD,
  REROLL_COST,
  rerollUnit,
  pullCost,
  pullUnits,
  validateTeam,
  type AbilityKind,
  type Cost,
  type CurrencyId,
  type RatesDescription,
  type StatKey,
  type UnitInstance,
  type V2Config,
} from '@war/v2'
import { DEV_UNLIMITED_RESOURCES } from './config.ts'
import { NotFoundError, type Repos, type UnitOfWork, type Wallet } from './repositories.ts'

/**
 * UI 가 호출하는 유일한 게임 데이터 창구 (명령 단위).
 * - 오프라인: LocalGameService (규칙 + Repository 를 이 기기에서 실행)
 * - 온라인: RemoteGameService (같은 명령을 서버 함수로 호출, 서버 안에서 이 LocalGameService 를 실행)
 * 뽑기 판정이 클라이언트에 있으면 결과 위조가 가능하므로, 온라인에서는 반드시 서버 구현을 쓴다.
 */
export interface GameService {
  getWallet(): Promise<Wallet>
  listUnits(): Promise<UnitInstance[]>
  getUnit(id: string): Promise<UnitInstance | null>

  pullCost(count: 1 | 10): Cost
  pull(count: 1 | 10): Promise<{ units: UnitInstance[]; cost: Cost; wallet: Wallet }>

  getDeck(): Promise<string[]>
  setDeck(unitIds: string[]): Promise<void>

  /** 합성: 캐릭 3명 → 리롤석 1개 (덱에 있는 캐릭은 불가) */
  merge(unitIds: string[]): Promise<{ gained: number; wallet: Wallet }>
  /** 리롤: 그림·특수능력·잠근 능력치(최대 1개)는 유지, 나머지 능력치 다시 */
  rerollCost(): Cost
  reroll(unitId: string, lock: StatKey | null): Promise<{ before: UnitInstance; after: UnitInstance; cost: Cost; wallet: Wallet }>

  /** 확률 정보 화면 (실제 뽑기와 같은 설정에서 자동 생성) */
  describeRates(): RatesDescription
  /** 자원 비용이 실제로 차감되는지 */
  readonly chargesResources: boolean

  dev: {
    addResources(delta: Partial<Wallet>): Promise<Wallet>
    resetInventory(): Promise<void>
    /** 능력 지정 지급 (null = 능력 없음) */
    grantUnit(ability: AbilityKind | null): Promise<UnitInstance>
  }
}

export interface LocalGameServiceOptions {
  uow: UnitOfWork
  config?: V2Config
  now?: () => number
  /** 기본값: config 의 DEV_UNLIMITED_RESOURCES */
  unlimitedResources?: boolean
}

export class LocalGameService implements GameService {
  private readonly cfg: V2Config
  private readonly uow: UnitOfWork
  private readonly now: () => number
  readonly chargesResources: boolean

  constructor(o: LocalGameServiceOptions) {
    this.cfg = o.config ?? makeV2Config()
    this.uow = o.uow
    this.now = o.now ?? (() => Date.now())
    this.chargesResources = !(o.unlimitedResources ?? DEV_UNLIMITED_RESOURCES)
  }

  /** 비용 차감. 개발 모드(chargesResources=false)에서도 리롤석은 실제로 차감 (구매가 아니라 합성으로 얻는 재화) */
  private async charge(r: Repos, cost: Cost): Promise<Wallet> {
    const delta: Partial<Wallet> = {}
    for (const [k, v] of Object.entries(cost) as [CurrencyId, number][]) if (this.chargesResources || k === 'rerollStone') delta[k] = -v
    return Object.keys(delta).length ? r.wallet.apply(delta) : r.wallet.get()
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
    return pullCost(count)
  }

  /** 자원 차감 + 개체 생성 + 저장 + 난수 상태 갱신을 한 단위로 */
  pull(count: 1 | 10) {
    return this.uow.run(async (r) => {
      const n = count === 10 ? 10 : 1
      const cost = pullCost(n)
      const wallet = await this.charge(r, cost)
      const res = pullUnits(this.cfg, await r.gacha.getRng(), n, this.now())
      await r.inventory.add(res.units)
      await r.gacha.setRng(res.rng)
      return { units: res.units, cost, wallet }
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
      if (!Array.isArray(unitIds) || new Set(unitIds).size !== unitIds.length) throw new Error('같은 유닛을 두 번 넣을 수 없습니다')
      const units = await Promise.all(unitIds.map((id) => r.inventory.get(String(id))))
      if (units.some((u) => !u)) throw new NotFoundError('deck unit')
      const errors = validateTeam(this.cfg, units as UnitInstance[])
      if (errors.some((e) => e.startsWith('duplicate image'))) throw new Error('같은 그림은 한 덱에 한 명만 넣을 수 있습니다')
      if (errors.length) throw new Error(errors.join('; '))
      await r.deck.set(unitIds)
    })
  }

  merge(unitIds: string[]) {
    return this.uow.run(async (r) => {
      const ids = Array.isArray(unitIds) ? unitIds.map(String) : []
      if (ids.length !== MERGE_COUNT || new Set(ids).size !== MERGE_COUNT) throw new Error(`서로 다른 캐릭 ${MERGE_COUNT}명을 골라야 합니다`)
      const deck = new Set(await r.deck.get())
      if (ids.some((id) => deck.has(id))) throw new Error('덱에 있는 캐릭은 합성할 수 없습니다')
      for (const id of ids) if (!(await r.inventory.get(id))) throw new NotFoundError(`unit ${id}`)
      for (const id of ids) await r.inventory.remove(id)
      const wallet = await r.wallet.apply({ rerollStone: MERGE_REWARD })
      return { gained: MERGE_REWARD, wallet }
    })
  }

  rerollCost() {
    return { ...REROLL_COST }
  }

  reroll(unitId: string, lock: StatKey | null) {
    return this.uow.run(async (r) => {
      const unit = await r.inventory.get(String(unitId))
      if (!unit) throw new NotFoundError(`unit ${unitId}`)
      if (MAX_REROLL_LOCKS < 1 && lock !== null) throw new Error('잠금을 쓸 수 없습니다')
      const cost = this.rerollCost()
      const wallet = await this.charge(r, cost)
      const res = rerollUnit(this.cfg, await r.gacha.getRng(), unit, lock ?? null)
      await r.inventory.update(res.after)
      await r.gacha.setRng(res.rng)
      return { before: res.before, after: res.after, cost, wallet }
    })
  }

  describeRates() {
    return describeRates(this.cfg)
  }

  readonly dev = {
    addResources: (delta: Partial<Wallet>) => this.uow.run((r) => r.wallet.apply(delta)),
    resetInventory: () => this.uow.run((r) => r.inventory.clear()),
    grantUnit: (ability: AbilityKind | null) =>
      this.uow.run(async (r) => {
        const res = grantUnit(this.cfg, await r.gacha.getRng(), this.now(), ability)
        await r.inventory.add([res.unit])
        await r.gacha.setRng(res.rng)
        return res.unit
      }),
  }
}

export const ZERO_WALLET = (): Wallet => Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Wallet
