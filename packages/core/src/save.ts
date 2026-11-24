import { CURRENCIES, type RngState, type UnitInstance } from '@war/v2'
import type { Wallet } from './repositories.ts'

/**
 * 저장 데이터 (스키마 버전 포함).
 * 버전이 바뀌면 MIGRATIONS[n] 이 n → n+1 로 변환한다. 순서대로 적용.
 */
export const SCHEMA_VERSION = 2

export interface SaveDataV2 {
  schemaVersion: 2
  inventory: UnitInstance[]
  wallet: Wallet
  deck: string[]
  gachaRng: RngState
}
export type SaveData = SaveDataV2

export type Migration = (old: { schemaVersion: number } & Record<string, unknown>) => { schemaVersion: number } & Record<string, unknown>

/** n → n+1 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  // v1(예전 챔피언 규칙) → v2(캐릭터 1종 + 특수능력): 예전 유닛은 새 규칙과 호환되지 않아 보관함·덱을 비운다. 보석은 유지
  1: (old) => {
    const w = (old.wallet ?? {}) as Record<string, number>
    return { schemaVersion: 2, inventory: [], deck: [], wallet: { gem: w.gem ?? 0 }, gachaRng: old.gachaRng }
  },
}

export class SaveVersionError extends Error {
  constructor(found: number, supported: number) {
    super(`Save schema v${found} is newer than supported v${supported}. 앱을 업데이트하세요.`)
    this.name = 'SaveVersionError'
  }
}

export function emptySave(seed: number): SaveData {
  const wallet = Object.fromEntries(CURRENCIES.map((c) => [c, 0])) as Wallet
  return { schemaVersion: 2, inventory: [], wallet, deck: [], gachaRng: { s: seed >>> 0 } }
}

/** 저장 원문 → 최신 스키마. 더 새 버전이면 덮어쓰지 않도록 오류 */
export function migrate(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target = SCHEMA_VERSION,
): SaveData {
  if (!raw || typeof raw !== 'object' || typeof (raw as { schemaVersion?: unknown }).schemaVersion !== 'number')
    throw new Error('Corrupted save: missing schemaVersion')
  let data = raw as { schemaVersion: number } & Record<string, unknown>
  if (data.schemaVersion > target) throw new SaveVersionError(data.schemaVersion, target)
  while (data.schemaVersion < target) {
    const m = migrations[data.schemaVersion]
    if (!m) throw new Error(`No migration from schema v${data.schemaVersion}`)
    const next = m(data)
    if (next.schemaVersion !== data.schemaVersion + 1) throw new Error('Migration must bump schemaVersion by 1')
    data = next
  }
  return data as unknown as SaveData
}
