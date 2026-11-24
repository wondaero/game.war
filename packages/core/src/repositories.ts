import type { CurrencyId, RngState, UnitInstance } from '@war/v2'

/**
 * 저장소 추상화. UI·게임 로직은 이 인터페이스만 안다 (localStorage 직접 접근 금지).
 * 지금 구현체: LocalStorage* / 나중: Supabase* (서버 안에서 사용)
 * 서버로 바뀌어도 호출부가 그대로이도록 전부 비동기.
 */
export type Wallet = Record<CurrencyId, number>

export interface InventoryRepository {
  list(): Promise<UnitInstance[]>
  get(id: string): Promise<UnitInstance | null>
  add(units: readonly UnitInstance[]): Promise<void>
  update(unit: UnitInstance): Promise<void>
  remove(id: string): Promise<void>
  clear(): Promise<void>
}

export interface WalletRepository {
  get(): Promise<Wallet>
  /** 잔액 변경. 결과가 음수가 되면 InsufficientFundsError, 아무것도 바뀌지 않음 */
  apply(delta: Partial<Wallet>): Promise<Wallet>
}

export interface DeckRepository {
  get(): Promise<string[]>
  set(unitIds: readonly string[]): Promise<void>
}

/** 뽑기·리롤 난수 상태 (서버로 가면 서버만 보관) */
export interface GachaStateRepository {
  getRng(): Promise<RngState>
  setRng(state: RngState): Promise<void>
}

export interface Repos {
  inventory: InventoryRepository
  wallet: WalletRepository
  deck: DeckRepository
  gacha: GachaStateRepository
}

/** 여러 저장소 변경을 한 단위로 (전부 반영되거나 전부 취소) */
export interface UnitOfWork {
  run<T>(fn: (repos: Repos) => Promise<T>): Promise<T>
}

export class InsufficientFundsError extends Error {
  constructor(readonly currency: CurrencyId, readonly need: number, readonly have: number) {
    super(`Not enough ${currency}: need ${need}, have ${have}`)
    this.name = 'InsufficientFundsError'
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`Not found: ${what}`)
    this.name = 'NotFoundError'
  }
}
