import type { ChampTemplate, Pos } from '../types.ts'

/** 십자 5칸 (중심 포함) */
export const CROSS_5: readonly Pos[] = [
  { x: 0, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
]

/**
 * MVP 챔프 7종.
 * 역할: 공격(3) / 방어(2) / 지원(2)
 * 궤적: 직사(돌격병, 방패병) / 대각(저격수, 거울술사) / 곡사(박격포) / 범위(수호기사, 가시정령)
 * 슬롯이 많을수록 일반 능력치 범위가 낮다 (슬롯 1: 공격·방어, 2: 수호기사, 3: 지원).
 * 희귀도는 gacha/table.ts 의 rarities 와 맞아야 한다.
 */
export const MVP_CHAMPS: readonly ChampTemplate[] = [
  {
    id: 'vanguard',
    name: '돌격병',
    role: 'attack',
    rarity: 'R',
    trajectory: { kind: 'straight', range: 4 },
    moveRange: 1,
    specialSlots: 1,
    statRanges: { hp: { min: 10, max: 14 }, atk: { min: 7, max: 9 }, armor: { min: 0, max: 1 } },
  },
  {
    id: 'sniper',
    name: '저격수',
    role: 'attack',
    rarity: 'SR',
    trajectory: { kind: 'diagonal', range: 4 },
    moveRange: 1,
    specialSlots: 1,
    statRanges: { hp: { min: 8, max: 11 }, atk: { min: 9, max: 11 }, armor: { min: 0, max: 1 } },
  },
  {
    id: 'mortar',
    name: '박격포',
    role: 'attack',
    rarity: 'R',
    trajectory: { kind: 'lob', minRange: 2, maxRange: 4 },
    moveRange: 1,
    specialSlots: 1,
    statRanges: { hp: { min: 9, max: 12 }, atk: { min: 6, max: 8 }, armor: { min: 0, max: 1 } },
  },
  {
    id: 'shieldbearer',
    name: '방패병',
    role: 'defense',
    rarity: 'R',
    trajectory: { kind: 'straight', range: 2 },
    moveRange: 1,
    specialSlots: 1,
    statRanges: { hp: { min: 16, max: 20 }, atk: { min: 4, max: 5 }, armor: { min: 2, max: 3 } },
  },
  {
    id: 'warden',
    name: '수호기사',
    role: 'defense',
    rarity: 'SR',
    trajectory: { kind: 'area', range: 2, shape: CROSS_5, damageBp: 6000 },
    moveRange: 1,
    specialSlots: 2,
    statRanges: { hp: { min: 13, max: 17 }, atk: { min: 5, max: 6 }, armor: { min: 1, max: 3 } },
  },
  {
    id: 'mirrormage',
    name: '거울술사',
    role: 'support',
    rarity: 'SR',
    trajectory: { kind: 'diagonal', range: 3 },
    moveRange: 1,
    specialSlots: 3,
    statRanges: { hp: { min: 10, max: 13 }, atk: { min: 4, max: 6 }, armor: { min: 0, max: 2 } },
  },
  {
    id: 'thornspirit',
    name: '가시정령',
    role: 'support',
    rarity: 'SSR',
    trajectory: { kind: 'area', range: 2, shape: CROSS_5, damageBp: 6000 },
    moveRange: 2,
    specialSlots: 3,
    statRanges: { hp: { min: 11, max: 14 }, atk: { min: 5, max: 6 }, armor: { min: 0, max: 2 } },
  },
]

export function catalogById(champs: readonly ChampTemplate[] = MVP_CHAMPS): Record<string, ChampTemplate> {
  const map: Record<string, ChampTemplate> = {}
  for (const c of champs) {
    if (map[c.id]) throw new Error(`Duplicate champ id: ${c.id}`)
    map[c.id] = c
  }
  return map
}
