/** 행동 규칙 후보 (시뮬레이션 비교용) */
import type { V2Config } from '../src/index.ts'
export const RULESETS: Record<string, Partial<V2Config>> = {
  '① 캐릭당1번(2명2·1명3)': { actionsPerUnitByAlive: [0, 3, 2, 1, 1], actsPerUnitByAlive: [0, 3, 3, 3, 3], maxActsPerTurn: 2 },
  '② 자유·공격캐릭당1': { actionsPerUnitByAlive: [0, 3, 3, 3, 3], actsPerUnitByAlive: [0, 1, 1, 1, 1], maxActsPerTurn: 2 },
  '③ ②+1명남으면공격2': { actionsPerUnitByAlive: [0, 3, 3, 3, 3], actsPerUnitByAlive: [0, 2, 1, 1, 1], maxActsPerTurn: 2 },
}
