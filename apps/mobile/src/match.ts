import {
  deploy,
  padPlan,
  resolveTurn,
  validateDeployment,
  validatePlan,
  type UnitInstance,
  type Deployment,
  type GameState,
  type PlayerController,
  type Side,
  type TurnLog,
  type TurnPlan,
} from '@war/engine'

/**
 * 사람 입력을 PlayerController 로 감싼다.
 * UI 가 submit 을 호출하면 대기 중인 Promise 가 풀린다.
 * → 온라인이 되면 RemoteController 로 교체만 하면 된다.
 */
export class HumanController implements PlayerController {
  private pending: { kind: 'deploy' | 'plan'; resolve: (v: never) => void } | null = null
  onRequest: (kind: 'deploy' | 'plan' | null, deadline?: number) => void = () => {}

  constructor(readonly side: Side) {}

  chooseDeployment(_state: GameState, _team: readonly UnitInstance[]): Promise<Deployment> {
    return new Promise((resolve) => {
      this.pending = { kind: 'deploy', resolve: resolve as (v: never) => void }
      this.onRequest('deploy')
    })
  }

  chooseTurnPlan(_state: GameState, deadlineMs: number): Promise<TurnPlan> {
    return new Promise((resolve) => {
      this.pending = { kind: 'plan', resolve: resolve as (v: never) => void }
      this.onRequest('plan', Date.now() + deadlineMs)
    })
  }

  submit(value: Deployment | TurnPlan): void {
    const p = this.pending
    this.pending = null
    this.onRequest(null)
    ;(p?.resolve as ((v: Deployment | TurnPlan) => void) | undefined)?.(value)
  }
}

export interface MatchView {
  state: GameState
  request: { kind: 'deploy' } | { kind: 'plan'; deadline: number } | null
  /** 재생할 턴 로그와 그 직전 상태 */
  playback: { log: TurnLog; before: GameState } | null
  error: string | null
}

const timeout = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms))

/**
 * 로컬 매치 진행 (사람 vs AI). 엔진은 순수 함수이고 진행·시간 제한은 여기서 담당.
 * 온라인 전환 시 이 역할은 서버로 이동한다.
 */
export class LocalMatch {
  private view: MatchView
  private listeners = new Set<() => void>()
  private playbackDone: (() => void) | null = null

  constructor(
    initial: GameState,
    readonly human: HumanController,
    private readonly ai: PlayerController,
  ) {
    this.view = { state: initial, request: null, playback: null, error: null }
    human.onRequest = (kind, deadline) =>
      this.set({
        request: kind === 'deploy' ? { kind } : kind === 'plan' ? { kind, deadline: deadline! } : null,
      })
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getView = () => this.view

  private set(patch: Partial<MatchView>) {
    this.view = { ...this.view, ...patch }
    for (const l of this.listeners) l()
  }

  finishPlayback() {
    this.set({ playback: null })
    this.playbackDone?.()
    this.playbackDone = null
  }

  private controllers(): Record<Side, PlayerController> {
    return this.human.side === 'A' ? { A: this.human, B: this.ai } : { A: this.ai, B: this.human }
  }

  async run(): Promise<void> {
    const ctrl = this.controllers()
    let state = this.view.state

    // 동시 배치: 양쪽 입력을 모두 받은 뒤 함께 공개
    const [depA, depB] = await Promise.all([
      ctrl.A.chooseDeployment(state, state.teams.A),
      ctrl.B.chooseDeployment(state, state.teams.B),
    ])
    for (const [side, dep] of [['A', depA], ['B', depB]] as const) {
      const v = validateDeployment(state, side, dep)
      if (!v.ok) return this.set({ error: `배치 오류 (${side}): ${v.errors.join(', ')}` })
    }
    state = deploy(state, { A: depA, B: depB })
    this.set({ state })

    while (state.phase === 'plan') {
      const limit = state.config.turnTimeLimitMs
      const n = state.config.actionsPerTurn
      // 제한시간 + 여유 1초 안에 못 내면 전부 대기 처리 (UI 는 마감 시 입력 중인 칸을 자동 제출)
      const ask = (c: PlayerController) =>
        Promise.race([c.chooseTurnPlan(state, limit), timeout(limit + 1000, padPlan([], n))])
      const [rawA, rawB] = await Promise.all([ask(ctrl.A), ask(ctrl.B)])
      const plans = { A: padPlan(rawA, n), B: padPlan(rawB, n) }
      for (const side of ['A', 'B'] as const) {
        if (!validatePlan(state, side, plans[side]).ok) plans[side] = padPlan([], n)
      }

      const before = state
      const { state: next, log } = resolveTurn(state, plans)
      state = next
      // 재생 중 화면은 playback(before + 스텝 스냅샷)으로 그리고, 끝나면 state 로 넘어감
      await new Promise<void>((resolve) => {
        this.playbackDone = resolve
        this.set({ state, playback: { log, before } })
      })
    }
  }
}
