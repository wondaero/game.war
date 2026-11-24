/** 규칙 후보 (시뮬레이션 비교용). 기본값 = 현재 확정 규칙 */
import type { V2Config } from '../src/index.ts'
export const RULESETS: Record<string, Partial<V2Config>> = {
  '현재(1대1 종료)': {},
  '1대1 종료 없음': { endOnOneVsOne: false },
}
