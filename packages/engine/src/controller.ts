import type { Deployment, GameState, Side, TurnPlan, UnitInstance } from './types.ts'

/**
 * 플레이어 입력 인터페이스 (사람·AI·원격 공통).
 * 엔진은 이 인터페이스를 직접 호출하지 않는다 — 매치 진행 모듈이 호출해서
 * 받은 입력을 validate → resolveTurn 에 넘긴다.
 */
export interface PlayerController {
  readonly side: Side
  chooseDeployment(state: GameState, team: readonly UnitInstance[]): Promise<Deployment>
  /** deadlineMs 안에 응답하지 못하면 매치 모듈이 빈 칸을 wait 으로 채운다 */
  chooseTurnPlan(state: GameState, deadlineMs: number): Promise<TurnPlan>
}

/** 시간 초과·미입력 칸을 wait 으로 채움 */
export function padPlan(plan: TurnPlan, actionsPerTurn: number): TurnPlan {
  const out = plan.slice(0, actionsPerTurn)
  while (out.length < actionsPerTurn) out.push({ type: 'wait' })
  return out
}
