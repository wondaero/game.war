import type { RarityId, SpecialKind } from '../types.ts'

/**
 * ★ 확률표 — 뽑기·리롤 확률과 비용은 이 파일 한 곳에서만 관리한다.
 * 게임 내 "확률 정보" 화면은 describeTable() 로 이 객체를 읽어 자동 생성된다.
 * 단위: weight 는 상대 가중치, *Bp 는 basis point (100% = 10000).
 */

export type CurrencyId = 'gem' | 'rerollStone'
export const CURRENCIES: readonly CurrencyId[] = ['gem', 'rerollStone']
export type Cost = Partial<Record<CurrencyId, number>>

export interface RarityRule {
  id: RarityId
  label: string
  weight: number
}

/** 능력치 구간: 챔프 범위를 [fromBp, toBp) 비율로 나눈 구간. 구간 안에서는 균등 */
export interface StatTier {
  label: string
  fromBp: number
  toBp: number
  weight: number
}

/** 특수능력 종류별 확률(가중치)과 수치 범위 (min..max, step 단위 균등) */
export interface SpecialRule {
  weight: number
  min: number
  max: number
  step: number
}

export interface GachaTable {
  version: number
  rarities: readonly RarityRule[]
  /** 등급 안에서 챔프별 가중치. 없으면 1 */
  champWeights: Readonly<Record<string, number>>
  statTiers: readonly StatTier[]
  specials: Readonly<Record<SpecialKind, SpecialRule>>
  costs: { pull1: Cost; pull10: Cost; reroll: Cost }
  /** 잠금 개수별 리롤 비용 배율 (index = 잠금 수) */
  lockMultiplier: readonly number[]
}

export const DEFAULT_GACHA_TABLE: GachaTable = {
  version: 1,
  rarities: [
    { id: 'R', label: '일반', weight: 7000 },
    { id: 'SR', label: '희귀', weight: 2500 },
    { id: 'SSR', label: '전설', weight: 500 },
  ],
  champWeights: {},
  statTiers: [
    { label: '하', fromBp: 0, toBp: 5000, weight: 6000 },
    { label: '중', fromBp: 5000, toBp: 8500, weight: 3000 },
    { label: '상', fromBp: 8500, toBp: 10000, weight: 1000 },
  ],
  specials: {
    regen: { weight: 2500, min: 1, max: 2, step: 1 },
    shield: { weight: 2500, min: 3, max: 8, step: 1 },
    reflect: { weight: 2500, min: 1000, max: 3000, step: 100 },
    lifesteal: { weight: 2500, min: 1000, max: 3000, step: 100 },
  },
  costs: {
    pull1: { gem: 100 },
    pull10: { gem: 1000 },
    reroll: { rerollStone: 10 },
  },
  lockMultiplier: [1, 3, 8],
}
