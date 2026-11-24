import { describe, it } from 'vitest'
import { ruleVariantReport, RUN } from './simlib.ts'
import { RULESETS } from './rulesets.ts'
const [name, cfg] = Object.entries(RULESETS)[1 - 1]!
const zone: boolean = true
describe.skipIf(!RUN)('규칙 비교', () => {
  it(name, () => ruleVariantReport(`${name}${zone ? '' : ' 위험지대X'}`, zone ? cfg : { ...cfg, dangerZoneStartTurn: 0 }), 3_600_000)
})
