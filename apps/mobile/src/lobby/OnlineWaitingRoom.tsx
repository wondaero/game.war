import { useEffect, useRef, useState } from 'react'
import type { UnitInstance } from '@war/v2'
import { service, V2_CFG } from '../services.ts'
import { imageOf } from '../ui/format.ts'
import {
  fetchRoom,
  leaveOnlineRoom,
  setReady,
  startOnlineMatch,
  submitGuestDeck,
  waitForDecks,
  watchRooms,
  type OnlineMatchRow,
  type OnlineRoom,
} from '../online/net.ts'
import { ensureSession } from '../online/supabase.ts'

/**
 * 온라인 대기실.
 * 방장: 손님이 "준비"하면 게임 시작 → 서버에 대전 생성
 * 손님: 준비 → 방장이 시작하면 내 덱 제출
 * 양쪽 덱이 모이면 onMatch 로 넘어간다 (방장 = A, 손님 = B)
 */
export function OnlineWaitingRoom({
  initial,
  version,
  onMatch,
  onLeave,
  onEditDeck,
}: {
  initial: OnlineRoom
  version: number
  onMatch: (m: OnlineMatchRow, side: 'A' | 'B') => void
  onLeave: (reason?: string) => void
  onEditDeck: () => void
}) {
  const [room, setRoom] = useState(initial)
  const [uid, setUid] = useState<string | null>(null)
  const [deck, setDeck] = useState<UnitInstance[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  const need = V2_CFG.cardsPerSide

  useEffect(() => {
    void ensureSession().then(setUid)
  }, [])
  useEffect(() => {
    void Promise.all([service.getDeck(), service.listUnits()]).then(([ids, units]) => {
      const byId = new Map(units.map((u) => [u.id, u]))
      setDeck(ids.map((id) => byId.get(id)).filter((u): u is UnitInstance => !!u))
    })
  }, [version])

  // 방 상태 실시간 반영
  useEffect(() => {
    const refresh = async () => {
      const r = await fetchRoom(initial.id).catch(() => null)
      if (!r || r.status === 'closed') return onLeave('방이 닫혔습니다.')
      setRoom(r)
    }
    const stop = watchRooms(() => void refresh(), initial.id)
    const t = setInterval(() => void refresh(), 5000)
    return () => (stop(), clearInterval(t))
  }, [initial.id])

  const isHost = uid !== null && room.host_id === uid
  const deckOk = deck?.length === need

  // 대전 시작 감지 (양쪽 공통): match_id 가 생기면 덱을 모아서 넘어감
  useEffect(() => {
    if (!room.match_id || !uid || !deck || started.current) return
    started.current = true
    const ac = new AbortController()
    void (async () => {
      try {
        if (!isHost) await submitGuestDeck(room.match_id!)
        const m = await waitForDecks(room.match_id!, ac.signal)
        onMatch(m, isHost ? 'A' : 'B')
      } catch (e) {
        started.current = false
        setError((e as Error).message)
      }
    })()
    return () => ac.abort()
  }, [room.match_id, uid, deck])

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      const r = await fetchRoom(room.id)
      if (r) setRoom(r)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const leave = async () => {
    await leaveOnlineRoom(room.id).catch(() => {})
    onLeave()
  }

  const guestLabel = room.guest_name
    ? room.guest_ready
      ? '준비 완료'
      : '준비 중…'
    : '상대를 기다리는 중…'

  return (
    <div className="screen">
      <div className="row between">
        <button className="ghost" onClick={leave}>
          ← 방 나가기
        </button>
        <span className="hint">
          온라인 · 턴 {room.turn_seconds}초 · {room.status === 'playing' ? '대전 준비 중' : '대기 중'}
        </span>
      </div>
      <h2>
        {room.has_password && '🔒 '}
        {room.title}
      </h2>
      <div className="seats">
        <div className={`seat ${isHost ? 'me' : 'enemy'}`}>
          <span className="hint">방장{isHost ? ' (나)' : ''}</span>
          <strong>{room.host_name}</strong>
          {isHost && <DeckLine deck={deck} need={need} />}
        </div>
        <div className="vs">VS</div>
        <div className={`seat ${room.guest_name ? (isHost ? 'enemy' : 'me') : 'empty'}`}>
          <span className="hint">손님{!isHost && room.guest_id ? ' (나)' : ''}</span>
          <strong>{room.guest_name ?? '—'}</strong>
          <span className="hint">{guestLabel}</span>
          {!isHost && <DeckLine deck={deck} need={need} />}
        </div>
      </div>

      {!deckOk && deck !== null && (
        <p className="error">
          덱을 먼저 편성하세요. <button onClick={() => void leaveOnlineRoom(room.id).finally(onEditDeck)}>덱 편성하러 가기</button>
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="footer">
        {isHost ? (
          <button
            className="primary"
            disabled={busy || !deckOk || !room.guest_ready || room.status !== 'waiting'}
            onClick={() => act(() => startOnlineMatch(room.id))}
          >
            {room.status === 'playing' ? '상대 덱 기다리는 중…' : room.guest_ready ? '게임 시작' : '상대 준비를 기다리는 중'}
          </button>
        ) : (
          <button
            className={room.guest_ready ? '' : 'primary'}
            disabled={busy || !deckOk || room.status !== 'waiting'}
            onClick={() => act(() => setReady(room.id, !room.guest_ready))}
          >
            {room.status === 'playing' ? '대전 준비 중…' : room.guest_ready ? '준비 취소' : '준비'}
          </button>
        )}
      </div>
    </div>
  )
}

function DeckLine({ deck, need }: { deck: UnitInstance[] | null; need: number }) {
  if (deck === null) return <span className="hint">덱 불러오는 중…</span>
  return (
    <>
      <span className="hint">{deck.length === need ? `덱 준비 완료 (${need}명)` : `덱 미완성 (${deck.length}/${need})`}</span>
      {deck.length > 0 && (
        <div className="deck-chips">
          {deck.map((u) => (
            <span key={u.id} className="tag">
              {imageOf(u.image).emoji} {imageOf(u.image).name}{u.ability ? ' ✦' : ''}
            </span>
          ))}
        </div>
      )}
    </>
  )
}
