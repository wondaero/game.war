import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createGame, type UnitInstance } from '@war/engine'
import { buildAiDeck, RuleAIController } from '@war/ai'
import type { Wallet } from '@war/core'
import { HumanController, LocalMatch } from './match.ts'
import { gachaCtx, service } from './services.ts'
import { DeployScreen } from './ui/DeployScreen.tsx'
import { PlanScreen } from './ui/PlanScreen.tsx'
import { Playback } from './ui/Playback.tsx'
import {
  DeckScreen,
  DevScreen,
  GachaScreen,
  InventoryScreen,
  RatesScreen,
  RerollScreen,
  UnitDetail,
  WalletBar,
} from './ui/screens.tsx'

function startMatch(deck: UnitInstance[]): LocalMatch {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]!
  // AI 덱도 플레이어와 같은 개체 생성 로직으로
  const state = createGame({ teams: { A: deck, B: buildAiDeck(gachaCtx, seed, Date.now()) } })
  const match = new LocalMatch(state, new HumanController('A'), new RuleAIController('B', seed))
  void match.run()
  return match
}

function MatchScreen({ match, onExit }: { match: LocalMatch; onExit: () => void }) {
  const view = useSyncExternalStore(match.subscribe, match.getView)
  const { state, request, playback, error } = view

  if (error) return <div className="screen">{error}</div>
  if (playback) return <Playback before={playback.before} log={playback.log} onDone={() => match.finishPlayback()} />
  if (state.phase === 'over' && state.result) {
    const w = state.result.winner
    return (
      <div className="screen center">
        <h1>{w === 'draw' ? '무승부' : w === 'A' ? '승리!' : '패배'}</h1>
        <p className="hint">
          {state.result.reason === 'maxTurns' ? `최대 ${state.config.maxTurns}턴 도달 — 남은 체력 비율 판정` : '상대 전멸'}
        </p>
        <button className="primary" onClick={onExit}>
          돌아가기
        </button>
      </div>
    )
  }
  if (request?.kind === 'deploy') return <DeployScreen state={state} onSubmit={(d) => match.human.submit(d)} />
  if (request?.kind === 'plan')
    return <PlanScreen key={state.turn} state={state} deadline={request.deadline} onSubmit={(p) => match.human.submit(p)} />
  return <div className="screen center">상대 대기 중…</div>
}

type Tab = 'battle' | 'inventory' | 'gacha' | 'rates' | 'dev'
const TABS: [Tab, string][] = [
  ['battle', '대전'],
  ['inventory', '보관함'],
  ['gacha', '뽑기'],
  ['rates', '확률'],
  ['dev', '개발'],
]
type Overlay = { kind: 'unit'; id: string } | { kind: 'reroll'; id: string } | null

export function App() {
  const [tab, setTab] = useState<Tab>('gacha')
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [match, setMatch] = useState<LocalMatch | null>(null)
  const [wallet, setWallet] = useState<Wallet | null>(null)
  const [version, setVersion] = useState(0)
  const [fatal, setFatal] = useState<string | null>(null)

  const changed = useCallback(() => setVersion((v) => v + 1), [])
  useEffect(() => {
    service.getWallet().then(setWallet, (e: Error) => setFatal(e.message))
  }, [version])

  if (fatal) return <div className="screen center">저장 데이터를 불러오지 못했습니다: {fatal}</div>
  if (match) return <MatchScreen match={match} onExit={() => (setMatch(null), changed())} />

  const open = (id: string) => setOverlay({ kind: 'unit', id })
  let body
  if (overlay?.kind === 'unit')
    body = <UnitDetail id={overlay.id} onBack={() => setOverlay(null)} onReroll={() => setOverlay({ kind: 'reroll', id: overlay.id })} />
  else if (overlay?.kind === 'reroll')
    body = <RerollScreen id={overlay.id} onBack={() => setOverlay({ kind: 'unit', id: overlay.id })} onChanged={changed} />
  else if (tab === 'battle') body = <DeckScreen version={version} onStart={(deck) => setMatch(startMatch(deck))} />
  else if (tab === 'inventory') body = <InventoryScreen version={version} onOpen={open} />
  else if (tab === 'gacha') body = <GachaScreen onChanged={changed} onOpen={open} />
  else if (tab === 'rates') body = <RatesScreen />
  else body = <DevScreen onChanged={changed} />

  return (
    <div className="screen hub">
      <WalletBar wallet={wallet} />
      <div className="hub-body">{body}</div>
      <nav className="tabs">
        {TABS.map(([t, label]) => (
          <button key={t} className={tab === t && !overlay ? 'on' : ''} onClick={() => (setTab(t), setOverlay(null))}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
