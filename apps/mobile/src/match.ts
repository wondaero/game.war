import {
  deploy,
  padPlan,
  planDeployment,
  planTurnMixed,
  resolveTurn,
  sanitizePlan,
  validateDeployment,
  type GameState,
  type Pos,
  type Side,
  type TurnLog,
  type TurnPlan,
} from '@war/v2'

/** 한쪽 플레이어 입력 (사람 화면 · AI · 온라인 상대) */
export interface PlayerController {
  readonly side: Side
  chooseDeployment(state: GameState): Promise<Pos[]>
  chooseTurnPlan(state: GameState, deadlineMs: number): Promise<TurnPlan>
}

/**
 * 사람 입력을 PlayerController 로 감싼다.
 * UI 가 submit 을 호출하면 대기 중인 Promise 가 풀린다.
 */
export class HumanController implements PlayerController {
  private pending: { kind: 'deploy' | 'plan'; resolve: (v: never) => void } | null = null
  onRequest: (kind: 'deploy' | 'plan' | null, deadline?: number) => void = () => {}

  constructor(readonly side: Side) {}

  chooseDeployment(_state: GameState): Promise<Pos[]> {
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

  submit(value: Pos[] | TurnPlan): void {
    const p = this.pending
    this.pending = null
    this.onRequest(null)
    ;(p?.resolve as ((v: Pos[] | TurnPlan) => void) | undefined)?.(value)
  }
}

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 30))

/** AI 상대: 가위바위보 계산 방식(혼합 전략). 상대 입력은 보지 않는다 */
export class AiController implements PlayerController {
  constructor(
    readonly side: Side,
    private readonly seed: number,
  ) {}

  async chooseDeployment(state: GameState): Promise<Pos[]> {
    await nextFrame()
    return planDeployment(state, this.side, state.teams[this.side], this.seed)
  }

  async chooseTurnPlan(state: GameState): Promise<TurnPlan> {
    await nextFrame() // 화면이 먼저 그려지도록
    return planTurnMixed(state, this.side, `${this.seed}:${state.turn}`)
  }
}

export interface MatchView {
  state: GameState
  request: { kind: 'deploy' } | { kind: 'plan'; deadline: number } | null
  /** 재생할 턴 로그와 그 전후 상태 */
  playback: { log: TurnLog; before: GameState; after: GameState } | null
  error: string | null
}

const timeout = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms))

/**
 * 로컬 매치 진행 (사람 vs AI). 엔진은 순수 함수이고 진행·시간 제한은 여기서 담당.
 */
export class LocalMatch {
  private view: MatchView
  private listeners = new Set<() => void>()
  private playbackDone: (() => void) | null = null

  constructor(
    initial: GameState,
    readonly human: HumanController,
    private readonly ai: PlayerController,
    private readonly turnMs: number,
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

  async run(): Promise<void> {
    try {
      await this.loop()
    } catch (e) {
      this.set({ error: `오류: ${(e as Error).message}` })
    }
  }

  private async loop(): Promise<void> {
    const ctrl: Record<Side, PlayerController> = this.human.side === 'A' ? { A: this.human, B: this.ai } : { A: this.ai, B: this.human }
    let state = this.view.state

    // 동시 배치: 양쪽 입력을 모두 받은 뒤 함께 공개
    const [depA, depB] = await Promise.all([ctrl.A.chooseDeployment(state), ctrl.B.chooseDeployment(state)])
    for (const [side, dep] of [['A', depA], ['B', depB]] as const) {
      const v = validateDeployment(state, side, dep)
      if (!v.ok) return this.set({ error: `배치 오류 (${side}): ${v.errors.join(', ')}` })
    }
    state = deploy(state, { A: depA, B: depB })
    this.set({ state })

    const n = state.config.actionsPerTurn
    while (state.phase === 'plan') {
      const s = state
      // 제한시간 + 여유 1초 안에 못 내면 빈 계획 (UI 는 마감 시 입력 중인 칸을 자동 제출)
      const ask = (c: PlayerController) => Promise.race([c.chooseTurnPlan(s, this.turnMs), timeout(this.turnMs + 1000, padPlan([], n))])
      const [rawA, rawB] = await Promise.all([ask(ctrl.A), ask(ctrl.B)])
      const plans = { A: sanitizePlan(s, 'A', rawA), B: sanitizePlan(s, 'B', rawB) }

      const { state: next, log } = resolveTurn(s, plans)
      state = next
      await new Promise<void>((resolve) => {
        this.playbackDone = resolve
        this.set({ state, playback: { log, before: s, after: next } })
      })
    }
  }
}
