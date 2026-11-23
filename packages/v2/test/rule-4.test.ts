import { describe, it } from "vitest"
import { ruleVariantReport, RUN } from "./simlib.ts"

describe.skipIf(!RUN)("규칙 변형", () => {
  it("10턴 · 체력 합", () => ruleVariantReport("10턴 · 체력 합", { maxTurns: 10, judgeBy: 'hpTotal' }), 3_600_000)
})
