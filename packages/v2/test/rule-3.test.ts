import { describe, it } from "vitest"
import { ruleVariantReport, RUN } from "./simlib.ts"

describe.skipIf(!RUN)("규칙 변형", () => {
  it("10턴 · 체력 비율", () => ruleVariantReport("10턴 · 체력 비율", { maxTurns: 10, judgeBy: 'hpRatio' }), 3_600_000)
})
