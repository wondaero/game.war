import { describe, it } from "vitest"
import { ruleVariantReport, RUN } from "./simlib.ts"

describe.skipIf(!RUN)("규칙 변형", () => {
  it("20턴 · 체력 비율", () => ruleVariantReport("20턴 · 체력 비율", { maxTurns: 20, judgeBy: 'hpRatio' }), 3_600_000)
})
