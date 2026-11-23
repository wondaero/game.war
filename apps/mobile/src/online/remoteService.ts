import {
  describeTable,
  pullCost,
  rerollCost,
  type Cost,
  type GachaContext,
  type RerollLocks,
  type UnitInstance,
} from '@war/engine'
import type { GameService, Wallet } from '@war/core'
import { ensureSession, supabase } from './supabase.ts'

/**
 * 서버 함수(game)를 부르는 GameService. 화면은 LocalGameService 와 똑같이 쓴다.
 * 뽑기·리롤·재화·보유 유닛·덱은 전부 서버에 있다. 비용·확률표 계산(표시용)만 앱에서.
 */
export class RemoteGameService implements GameService {
  /** 서버 응답으로 갱신 (개발 단계는 비용 차감 없음) */
  chargesResources = false

  constructor(private readonly ctx: GachaContext) {}

  private async call<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
    if (!supabase) throw new Error('온라인 설정이 없습니다')
    await ensureSession()
    const { data, error } = await supabase.functions.invoke('game', { body: { action, args } })
    if (error) {
      // 서버가 보낸 오류 문장을 꺼냄
      const ctxRes = (error as { context?: Response }).context
      const body = ctxRes ? await ctxRes.json().catch(() => null) : null
      throw new Error((body as { error?: string } | null)?.error ?? error.message)
    }
    return data as T
  }

  private async state() {
    const s = await this.call<{ wallet: Wallet; units: UnitInstance[]; deck: string[]; chargesResources: boolean }>('state')
    this.chargesResources = s.chargesResources
    return s
  }

  async getWallet() {
    return (await this.state()).wallet
  }
  async listUnits() {
    return (await this.state()).units
  }
  async getUnit(id: string) {
    return (await this.state()).units.find((u) => u.id === id) ?? null
  }

  pullCost(count: 1 | 10): Cost {
    return pullCost(this.ctx, count)
  }
  pull(count: 1 | 10) {
    return this.call<{ units: UnitInstance[]; cost: Cost; wallet: Wallet }>('pull', { count })
  }

  rerollCost(locks: RerollLocks): Cost {
    return rerollCost(this.ctx, locks)
  }
  reroll(unitId: string, locks: RerollLocks) {
    return this.call<{ before: UnitInstance; after: UnitInstance; cost: Cost; wallet: Wallet }>('reroll', { unitId, locks })
  }

  async getDeck() {
    return (await this.state()).deck
  }
  async setDeck(unitIds: string[]) {
    await this.call('setDeck', { unitIds })
  }

  describeRates() {
    return describeTable(this.ctx)
  }

  readonly dev = {
    addResources: (delta: Partial<Wallet>) => this.call<Wallet>('dev.addResources', { delta }),
    resetInventory: () => this.call<void>('dev.resetInventory'),
    grantChamp: (champId: string) => this.call<UnitInstance>('dev.grantChamp', { champId }),
  }
}

/** 온라인 대전 결과를 서버가 다시 계산해서 기록 */
export async function verifyMatchResult(matchId: string) {
  if (!supabase) return
  await ensureSession()
  await supabase.functions.invoke('game', { body: { action: 'finishMatch', args: { matchId } } })
}
