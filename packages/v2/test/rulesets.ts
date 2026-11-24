/** 규칙 후보 (시뮬레이션 비교용). 기본값 = 현재 확정 규칙 */
import type { V2Config } from '../src/index.ts'
export const RULESETS: Record<string, Partial<V2Config>> = {
  '현재(이동 의무 없음)': {},
  '이전(이동 최소 1번)': { minMovesPerTurn: 1 },
}
