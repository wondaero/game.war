import {
  deploy,
  mirror,
  mirrorState,
  padPlan,
  resolveTurn,
  sanitizePlan,
  validateDeployment,
  type GameState,
  type Pos,
  type Side,
  type TurnPlan,
} from '@war/v2'
import { fixNotice, HumanController, type MatchView } from '../match.ts'
import { MatchNet } from './net.ts'
import { verifyMatchResult } from './remoteService.ts'

const OPPONENT_GRACE_MS = 90_000

const timeout = <T,>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms))

/**
 * 사람 vs 사람 (Supabase 중계). LocalMatch 와 같은 화면 인터페이스.
 * - 판정은 양쪽 기기가 같은 입력으로 각자 계산 (판 안에 난수가 없어 결과가 같다)
 * - 좌표는 항상 방장 = A(아래) 기준. 손님 화면만 상하 반전해서 보여준다
 * - 받은 계획은 sanitizePlan 으로 정리 (양쪽 기기·서버가 같은 규칙으로 정리하므로 결과가 같다)
 */
export class OnlineMatch {
  readonly human = new HumanController('A')
  private view: MatchView
  private listeners = new Set<() => void>()
  private playbackDone: (() => void) | null = null
  private abort = new AbortController()
  private net: MatchNet

  constructor(
    initial: GameState,
    readonly matchId: string,
    readonly mySide: Side,
    private readonly turnMs: number,
  ) {
    this.net = new MatchNet(matchId, mySide)
    this.view = { state: this.show(initial), request: null, playback: null, error: null }
    this.human.onRequest = (kind, deadline) =>
      this.set({ request: kind === 'deploy' ? { kind } : kind === 'plan' ? { kind, deadline: deadline! } : null })
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  getView = () => this.view

  /** 화면을 떠날 때 기다리기 중단 */
  dispose() {
    this.abort.abort()
  }

  finishPlayback() {
    this.set({ playback: null })
    this.playbackDone?.()
    this.playbackDone = null
  }

  private set(patch: Partial<MatchView>) {
    this.view = { ...this.view, ...patch }
    for (const l of this.listeners) l()
  }

  private show = (s: GameState) => (this.mySide === 'A' ? s : mirrorState(s))
  private toCanon = <T,>(x: T, s: GameState): T => (this.mySide === 'A' ? x : mirror(x, s.config.boardHeight))
  private get oppSide(): Side {
    return this.mySide === 'A' ? 'B' : 'A'
  }

  private async opponent<T>(turn: number, extraMs: number): Promise<T | null> {
    return Promise.race([this.net.waitOpponent<T>(turn, this.abort.signal), timeout(extraMs + OPPONENT_GRACE_MS, null)])
  }

  async run(): Promise<void> {
    try {
      await this.loop()
    } catch (e) {
      if (!this.abort.signal.aborted) this.set({ error: `연결 오류: ${(e as Error).message}` })
    }
  }

  private async loop(): Promise<void> {
    let state = this.toCanon(this.view.state, this.view.state) // 원래 좌표로

    // 배치 (turn 0)
    const shown = this.show(state)
    const myDep = this.toCanon(await this.human.chooseDeployment(shown), state)
    if (!validateDeployment(state, this.mySide, myDep).ok) return this.set({ error: '배치가 올바르지 않습니다' })
    await this.net.submit(0, myDep)
    const oppDep = await this.opponent<Pos[]>(0, 60_000)
    if (!oppDep) return this.set({ error: '상대 응답이 없습니다' })
    if (!validateDeployment(state, this.oppSide, oppDep).ok) return this.set({ error: '상대 배치 데이터가 올바르지 않습니다' })
    state = deploy(state, this.mySide === 'A' ? { A: myDep, B: oppDep } : { A: oppDep, B: myDep })
    this.set({ state: this.show(state) })

    const n = state.config.actionsPerTurn
    while (state.phase === 'plan') {
      const s = state
      const limit = this.turnMs
      const raw = await Promise.race([this.human.chooseTurnPlan(this.show(s), limit), timeout(limit + 1000, padPlan([], n))])
      const rawCanon = this.toCanon(raw, s)
      const mine: TurnPlan = sanitizePlan(s, this.mySide, rawCanon)
      const notice = fixNotice(rawCanon, mine, n)
      this.set({ request: null })
      await this.net.submit(s.turn, mine)

      const got = await this.opponent<unknown>(s.turn, limit)
      if (!got) return this.set({ error: '상대 응답이 없습니다 (연결 끊김)' })
      const theirs = sanitizePlan(s, this.oppSide, got)

      const { state: next, log } = resolveTurn(s, this.mySide === 'A' ? { A: mine, B: theirs } : { A: theirs, B: mine })
      state = next
      await new Promise<void>((resolve) => {
        this.playbackDone = resolve
        this.set({
          state: this.show(next),
          playback: { log: this.toCanon(log, s), before: this.show(s), after: this.show(next), notice },
        })
      })
    }
    // 승패는 서버가 행동 기록으로 다시 계산해서 기록 (앱이 보낸 결과는 믿지 않음)
    if (state.result) await verifyMatchResult(this.matchId).catch(() => {})
  }
}
