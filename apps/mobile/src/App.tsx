import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createGame, randomDeck, type GameResult, type UnitInstance } from '@war/v2'
import type { Wallet } from '@war/core'
import { AiController, HumanController, LocalMatch, type MatchView } from './match.ts'
import { service, setServiceMode, V2_CFG } from './services.ts'
import { DeployScreen } from './ui/DeployScreen.tsx'
import { PlanScreen } from './ui/PlanScreen.tsx'
import { Playback } from './ui/Playback.tsx'
import {
  ExitedScreen,
  LobbyScreen,
  TitleScreen,
  WaitingRoom,
  type Joined,
  type LobbyTab,
  type MeSection,
} from './lobby/Lobby.tsx'
import { OnlineWaitingRoom } from './lobby/OnlineWaitingRoom.tsx'
import { closeRoom, loadProfile, recordResult, saveProfile, type Room } from './lobby/store.ts'
import { fetchMyProfile, upsertProfile, type OnlineMatchRow } from './online/net.ts'
import { OnlineMatch } from './online/OnlineMatch.ts'
import { ensureSession, supabase } from './online/supabase.ts'

/** 대전 화면이 쓰는 공통 인터페이스 (AI 대전·온라인 대전) */
interface MatchLike {
  subscribe: (fn: () => void) => () => void
  getView: () => MatchView
  human: HumanController
  finishPlayback: () => void
}

function startAiMatch(deck: UnitInstance[], room: Room): LocalMatch {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!
  // AI 덱도 플레이어와 같은 뽑기 규칙으로 (그림 겹침 없이 무작위 4명)
  const state = createGame({ A: deck, B: randomDeck(V2_CFG, seed) }, V2_CFG)
  const match = new LocalMatch(state, new HumanController('A'), new AiController('B', seed), room.turnSeconds * 1000)
  void match.run()
  return match
}

function startOnline(m: OnlineMatchRow, side: 'A' | 'B'): OnlineMatch {
  const state = createGame({ A: m.host_deck, B: m.guest_deck! }, V2_CFG)
  const match = new OnlineMatch(state, m.id, side, m.turn_seconds * 1000)
  void match.run()
  return match
}

/** 서버 프로필을 기준으로 이 기기 캐시를 맞춤 (없으면 지금 닉네임으로 생성) */
async function syncProfile() {
  const local = loadProfile()
  const server = (await fetchMyProfile()) ?? (await upsertProfile(local.nickname))
  saveProfile({ nickname: server.nickname, wins: server.wins, losses: server.losses, draws: server.draws })
}

function MatchScreen({ match, onExit }: { match: MatchLike; onExit: (result: GameResult | null) => void }) {
  const view = useSyncExternalStore(match.subscribe, match.getView)
  const { state, request, playback, error } = view

  if (error)
    return (
      <div className="screen center">
        <p>{error}</p>
        <button onClick={() => onExit(null)}>나가기</button>
      </div>
    )
  if (playback)
    return <Playback before={playback.before} after={playback.after} log={playback.log} notice={playback.notice} onDone={() => match.finishPlayback()} />
  if (state.phase === 'over' && state.result) {
    const w = state.result.winner
    return (
      <div className="screen center">
        <h1>{w === 'draw' ? '무승부' : w === 'A' ? '승리!' : '패배'}</h1>
        <p className="hint">
          {state.result.reason === 'maxTurns'
            ? `최대 ${state.config.maxTurns}턴 도달 — 남은 체력 비율 판정`
            : w === 'draw'
              ? '양쪽 동시 전멸'
              : w === 'A'
                ? '상대 전멸'
                : '내 유닛 전멸'}
        </p>
        <button className="primary" onClick={() => onExit(state.result)}>
          대기실로
        </button>
      </div>
    )
  }
  if (request?.kind === 'deploy') return <DeployScreen state={state} onSubmit={(d) => match.human.submit(d)} />
  if (request?.kind === 'plan')
    return <PlanScreen key={state.turn} state={state} deadline={request.deadline} onSubmit={(p) => match.human.submit(p)} />
  return <div className="screen center">상대 대기 중…</div>
}

/**
 * 화면 흐름: 초기 화면(게임 입장/종료) → 로비(방 목록·방 만들기·내 정보·상점) → 대기실 → 대전
 * .env 에 Supabase 설정이 있으면 온라인(게스트 로그인), 없으면 오프라인(AI 상대)
 */
type Scene = 'title' | 'exited' | 'lobby' | 'room' | 'match'
const ONLINE = !!supabase

export function App() {
  const [scene, setScene] = useState<Scene>('title')
  const [tab, setTab] = useState<LobbyTab>('rooms')
  const [meSection, setMeSection] = useState<MeSection | undefined>(undefined)
  const [joined, setJoined] = useState<Joined | null>(null)
  const [match, setMatch] = useState<{ m: MatchLike; online: OnlineMatch | null } | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [version, setVersion] = useState(0)
  const [fatal, setFatal] = useState<string | null>(null)
  const [entering, setEntering] = useState(false)
  const [enterError, setEnterError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [online, setOnline] = useState(ONLINE)

  const changed = useCallback(() => setVersion((v) => v + 1), [])
  useEffect(() => {
    service.getWallet().then(setWallet, (e: Error) => setFatal(e.message))
  }, [version])

  if (fatal) return <div className="screen center">저장 데이터를 불러오지 못했습니다: {fatal}</div>

  const toLobby = (t: LobbyTab = 'rooms', section?: MeSection) => {
    setJoined(null)
    setTab(t)
    setMeSection(section)
    setScene('lobby')
  }

  if (scene === 'title')
    return (
      <>
        <TitleScreen
          onEnter={async () => {
            if (!online) return toLobby()
            setEntering(true)
            setEnterError(null)
            try {
              await ensureSession()
              await syncProfile()
              setServiceMode('online')
              changed()
              toLobby()
            } catch (e) {
              setEnterError((e as Error).message)
            } finally {
              setEntering(false)
            }
          }}
          onExit={() => {
            window.close() // 스크립트로 연 창이 아니면 브라우저가 무시함
            setScene('exited')
          }}
        />
        {(entering || enterError) && (
          <div className="toast">
            {entering ? (
              '접속 중…'
            ) : (
              <>
                접속 실패: {enterError}{' '}
                <button onClick={() => (setOnline(false), setServiceMode('offline'), changed(), setEnterError(null), toLobby())}>
                  오프라인으로 계속
                </button>
              </>
            )}
          </div>
        )}
      </>
    )
  if (scene === 'exited') return <ExitedScreen onRestart={() => setScene('title')} />

  if (scene === 'match' && match)
    return (
      <MatchScreen
        match={match.m}
        onExit={(result) => {
          if (match.online) {
            match.online.dispose()
            void syncProfile().then(changed, () => {})
          } else if (result && !online) {
            // 오프라인일 때만 AI 대전을 전적에 기록 (온라인 전적은 사람과의 대전만)
            recordResult(result.winner === 'draw' ? 'draw' : result.winner === 'A' ? 'win' : 'loss')
          }
          setMatch(null)
          setScene(joined ? 'room' : 'lobby')
          changed()
        }}
      />
    )

  if (scene === 'room' && joined?.kind === 'online')
    return (
      <OnlineWaitingRoom
        key={joined.room.id}
        initial={joined.room}
        version={version}
        onMatch={(m, side) => {
          const online = startOnline(m, side)
          setMatch({ m: online, online })
          setScene('match')
        }}
        onLeave={(reason) => {
          setNotice(reason ?? null)
          toLobby()
        }}
        onEditDeck={() => toLobby('me', 'deck')}
      />
    )

  if (scene === 'room' && joined?.kind === 'local') {
    const room = joined.room
    return (
      <WaitingRoom
        room={room}
        profile={loadProfile()}
        version={version}
        onStart={(deck) => (setMatch({ m: startAiMatch(deck, room), online: null }), setScene('match'))}
        onLeave={() => {
          if (room.mine) closeRoom(room.id)
          toLobby()
        }}
        onEditDeck={() => {
          if (room.mine) closeRoom(room.id)
          toLobby('me', 'deck')
        }}
      />
    )
  }

  return (
    <>
      <LobbyScreen
        key={`${tab}:${meSection ?? ''}`}
        wallet={wallet}
        version={version}
        onChanged={changed}
        tab={tab}
        onTab={(t) => (setTab(t), setMeSection(undefined), setNotice(null))}
        meSection={meSection}
        online={online}
        onJoin={(j) => (setJoined(j), setNotice(null), setScene('room'))}
        onBackToTitle={() => setScene('title')}
      />
      {notice && (
        <div className="toast" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </>
  )
}
