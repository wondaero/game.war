import { describe, it } from 'vitest'
import { ruleVariantReport, RUN } from './simlib.ts'
import { RULESETS } from './rulesets.ts'
const [name, cfg] = Object.entries(RULESETS)[1 - 1]!
/** true = 이벤트 맵 위험지대 켬 (오리지날은 없음) */
const zone: boolean = true
describe.skipIf(!RUN)('규칙 비교', () => {
  it(name, () => ruleVariantReport(`${name}${zone ? ' 위험지대(이벤트)' : ''}`, zone ? { ...cfg, dangerZoneStartTurn: 5 } : cfg), 3_600_000)
})
