import { useEffect, useState } from 'react'
import type { UnitInstance } from '@war/v2'
import type { Wallet } from '@war/core'
import { service, V2_CFG } from '../services.ts'
import { imageOf } from '../ui/format.ts'
import {
  DeckScreen,
  DevScreen,
  GachaScreen,
  InventoryScreen,
  RatesScreen,
  UnitDetail,
  WalletBar,
} from '../ui/screens.tsx'
import { createRoom, listRooms, loadProfile, saveProfile, TURN_SECONDS, type Profile, type Room } from './store.ts'
import { createOnlineRoom, fetchRooms, joinOnlineRoom, upsertProfile, watchRooms, type OnlineRoom } from '../online/net.ts'

/** 들어간 방: 이 기기 안의 AI 연습방 또는 서버 방 */
export type Joined = { kind: 'local'; room: Room } | { kind: 'online'; room: OnlineRoom }

/** AI 연습 (온라인일 때 방 목록 위 버튼) */
const PRACTICE_ROOM: Room = {
  id: 'practice', title: 'AI 연습', host: 'AI 연습 상대', players: 1, capacity: 2, status: 'waiting',
  password: null, turnSeconds: 30, ai: true, mine: false,
}

// ───────────── 초기 화면 ─────────────

export function TitleScreen({ onEnter, onExit }: { onEnter: () => void; onExit: () => void }) {
  return (
    <div className="screen center title-screen">
      <div className="title-logo">
        <div className="title-grid" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => (
            <span key={i} className={i === 4 ? 'hot' : ''} />
          ))}
        </div>
        <h1>Grid Tactics</h1>
        <p className="hint">동시 턴 전술 대전 (가칭)</p>
      </div>
      <div className="title-buttons">
        <button className="primary big" onClick={onEnter}>
          게임 입장
        </button>
        <button className="big" onClick={onExit}>
          게임 종료
        </button>
      </div>
    </div>
  )
}

export function ExitedScreen({ onRestart }: { onRestart: () => void }) {
  return (
    <div className="screen center">
      <h2>게임을 종료했습니다</h2>
      <p className="hint">브라우저에서는 창을 직접 닫아 주세요.</p>
      <button onClick={onRestart}>다시 시작</button>
    </div>
  )
}

// ───────────── 로비 ─────────────

export type LobbyTab = 'rooms' | 'create' | 'me' | 'shop'
const TABS: [LobbyTab, string][] = [
  ['rooms', '방 목록'],
  ['create', '방 만들기'],
  ['me', '내 정보'],
  ['shop', '상점'],
]

type Overlay = { kind: 'unit'; id: string } | null

interface LobbyProps {
  wallet: Wallet | null
  version: number
  onChanged: () => void
  onJoin: (j: Joined) => void
  onBackToTitle: () => void
  online: boolean
  tab: LobbyTab
  onTab: (t: LobbyTab) => void
  meSection?: MeSection
}

export function LobbyScreen(p: LobbyProps) {
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [profile, setProfile] = useState<Profile>(loadProfile)
  useEffect(() => setProfile(loadProfile()), [p.version])

  const open = (id: string) => setOverlay({ kind: 'unit', id })
  let body
  if (overlay?.kind === 'unit')
    body = <UnitDetail id={overlay.id} onBack={() => setOverlay(null)} />
  else if (p.tab === 'rooms')
    body = p.online ? (
      <OnlineRoomList onJoin={p.onJoin} onCreate={() => p.onTab('create')} />
    ) : (
      <RoomList onJoin={(room) => p.onJoin({ kind: 'local', room })} onCreate={() => p.onTab('create')} />
    )
  else if (p.tab === 'create') body = <CreateRoom host={profile.nickname} online={p.online} onCreated={p.onJoin} />
  else if (p.tab === 'me')
    body = (
      <MyInfo
        profile={profile}
        onProfile={(np) => {
          saveProfile(np)
          setProfile(np)
          if (p.online) void upsertProfile(np.nickname).catch(() => {})
        }}
        version={p.version}
        onChanged={p.onChanged}
        onOpen={open}
        initial={p.meSection}
      />
    )
  else body = <Shop onChanged={p.onChanged} onOpen={open} />

  return (
    <div className="screen hub">
      <div className="lobby-top">
        <button className="ghost" onClick={p.onBackToTitle}>
          ← 처음으로
        </button>
        <span className="nick">{profile.nickname}</span>
        <WalletBar wallet={p.wallet} />
      </div>
      <div className="hub-body">{body}</div>
      <nav className="tabs">
        {TABS.map(([t, label]) => (
          <button key={t} className={p.tab === t && !overlay ? 'on' : ''} onClick={() => (p.onTab(t), setOverlay(null))}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

// ───────────── 방 목록 ─────────────

function RoomList({ onJoin, onCreate }: { onJoin: (r: Room) => void; onCreate: () => void }) {
  const [rooms, setRooms] = useState(listRooms)
  const [error, setError] = useState<string | null>(null)
  const join = (r: Room) => {
    setError(null)
    if (r.status === 'playing') return setError('이미 게임 중인 방입니다.')
    if (r.password && !r.mine) {
      const pw = prompt('비밀번호를 입력하세요')
      if (pw === null) return
      if (pw !== r.password) return setError('비밀번호가 틀렸습니다.')
    }
    onJoin(r)
  }
  return (
    <div className="screen-body">
      <div className="row between">
        <h2>방 목록</h2>
        <button onClick={() => setRooms(listRooms())}>새로고침</button>
      </div>
      <p className="hint">지금은 서버가 없어 모든 방의 상대는 AI입니다.</p>
      <div className="list">
        {rooms.map((r) => (
          <button key={r.id} className={`room-row ${r.status}`} onClick={() => join(r)}>
            <div className="room-main">
              <span className="room-title">
                {r.password && '🔒 '}
                {r.title}
              </span>
              <span className="hint">
                {r.host} · 턴 {r.turnSeconds}초{r.mine ? ' · 내 방' : ''}
              </span>
            </div>
            <div className="room-side">
              <span className={`badge ${r.status}`}>{r.status === 'waiting' ? '대기 중' : '게임 중'}</span>
              <span className="hint">
                {r.players}/{r.capacity}
              </span>
            </div>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="footer sticky">
        <button className="primary" onClick={onCreate}>
          방 만들기
        </button>
      </div>
    </div>
  )
}

// ───────────── 온라인 방 목록 ─────────────

function OnlineRoomList({ onJoin, onCreate }: { onJoin: (j: Joined) => void; onCreate: () => void }) {
  const [rooms, setRooms] = useState<OnlineRoom[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = () =>
    fetchRooms().then(
      (r) => (setRooms(r), setError(null)),
      (e: Error) => setError(e.message),
    )
  useEffect(() => {
    void refresh()
    const stop = watchRooms(() => void refresh())
    return stop
  }, [])
  const join = async (r: OnlineRoom) => {
    setError(null)
    if (r.status === 'playing') return setError('이미 게임 중인 방입니다.')
    let pw: string | null = null
    if (r.has_password) {
      pw = prompt('비밀번호를 입력하세요')
      if (pw === null) return
    }
    setBusy(true)
    try {
      onJoin({ kind: 'online', room: await joinOnlineRoom(r.id, pw) })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="screen-body">
      <div className="row between">
        <h2>방 목록</h2>
        <button onClick={() => void refresh()}>새로고침</button>
      </div>
      <button onClick={() => onJoin({ kind: 'local', room: PRACTICE_ROOM })}>🤖 AI와 연습하기</button>
      {rooms === null && !error && <p className="hint">불러오는 중…</p>}
      {rooms?.length === 0 && <p className="hint">열린 방이 없습니다. 방을 만들어 보세요.</p>}
      <div className="list">
        {rooms?.map((r) => (
          <button key={r.id} disabled={busy} className={`room-row ${r.status}`} onClick={() => void join(r)}>
            <div className="room-main">
              <span className="room-title">
                {r.has_password && '🔒 '}
                {r.title}
              </span>
              <span className="hint">
                {r.host_name} · 턴 {r.turn_seconds}초
              </span>
            </div>
            <div className="room-side">
              <span className={`badge ${r.status}`}>{r.status === 'waiting' ? '대기 중' : '게임 중'}</span>
              <span className="hint">{r.guest_id ? 2 : 1}/2</span>
            </div>
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="footer sticky">
        <button className="primary" onClick={onCreate}>
          방 만들기
        </button>
      </div>
    </div>
  )
}

// ───────────── 방 만들기 ─────────────

function CreateRoom({ host, online, onCreated }: { host: string; online: boolean; onCreated: (j: Joined) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    const pw = locked ? password : null
    if (!online) return onCreated({ kind: 'local', room: createRoom({ title, password: pw, turnSeconds }, host) })
    setBusy(true)
    setError(null)
    try {
      onCreated({ kind: 'online', room: await createOnlineRoom(title, pw, turnSeconds) })
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  const [title, setTitle] = useState('')
  const [locked, setLocked] = useState(false)
  const [password, setPassword] = useState('')
  const [turnSeconds, setTurnSeconds] = useState<number>(30)
  const canCreate = !locked || password.trim().length > 0
  return (
    <div className="screen-body">
      <h2>방 만들기</h2>
      <label className="field">
        <span>방 제목</span>
        <input value={title} maxLength={20} placeholder={`${host}의 방`} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field check">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} />
        <span>비밀번호 설정</span>
      </label>
      {locked && (
        <label className="field">
          <span>비밀번호</span>
          <input value={password} maxLength={8} inputMode="numeric" onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      <div className="field">
        <span>턴 입력 제한 시간</span>
        <div className="row">
          {TURN_SECONDS.map((s) => (
            <button key={s} className={turnSeconds === s ? 'on' : ''} onClick={() => setTurnSeconds(s)}>
              {s}초
            </button>
          ))}
        </div>
      </div>
      <p className="hint">판 6×6 · 출전 4명 · 최대 20턴 (규칙은 고정){online ? '' : ' · 오프라인: 상대는 AI'}</p>
      {error && <p className="error">{error}</p>}
      <div className="footer sticky">
        <button
          className="primary"
          disabled={!canCreate || busy}
          onClick={() => void create()}
        >
          만들기
        </button>
      </div>
    </div>
  )
}

// ───────────── 대기실 ─────────────

export function WaitingRoom({
  room,
  profile,
  version,
  onStart,
  onLeave,
  onEditDeck,
}: {
  room: Room
  profile: Profile
  version: number
  onStart: (deck: UnitInstance[]) => void
  onLeave: () => void
  onEditDeck: () => void
}) {
  const [deck, setDeck] = useState<UnitInstance[] | null>(null)
  const [opponent, setOpponent] = useState<string | null>(room.mine ? null : room.host)
  const need = V2_CFG.cardsPerSide
  useEffect(() => {
    void Promise.all([service.getDeck(), service.listUnits()]).then(([ids, units]) => {
      const byId = new Map(units.map((u) => [u.id, u]))
      setDeck(ids.map((id) => byId.get(id)).filter((u): u is UnitInstance => !!u))
    })
  }, [version])
  const deckOk = deck?.length === need
  return (
    <div className="screen">
      <div className="row between">
        <button className="ghost" onClick={onLeave}>
          ← 방 나가기
        </button>
        <span className="hint">턴 {room.turnSeconds}초</span>
      </div>
      <h2>
        {room.password && '🔒 '}
        {room.title}
      </h2>
      <div className="seats">
        <div className="seat me">
          <span className="hint">나</span>
          <strong>{profile.nickname}</strong>
          <span className="hint">
            {deck === null ? '덱 불러오는 중…' : deckOk ? `덱 준비 완료 (${need}명)` : `덱 미완성 (${deck.length}/${need})`}
          </span>
          {deck && deck.length > 0 && (
            <div className="deck-chips">
              {deck.map((u) => (
                <span key={u.id} className="tag">
                  {imageOf(u.image).emoji} {imageOf(u.image).name}{u.ability ? ' ✦' : ''}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="vs">VS</div>
        <div className={`seat ${opponent ? 'enemy' : 'empty'}`}>
          {opponent ? (
            <>
              <span className="hint">상대</span>
              <strong>{opponent}</strong>
              <span className="hint">준비 완료</span>
            </>
          ) : (
            <>
              <span className="hint">상대를 기다리는 중…</span>
              <button onClick={() => setOpponent('AI 연습 상대')}>AI로 채우기</button>
            </>
          )}
        </div>
      </div>
      {!deckOk && deck !== null && (
        <p className="error">
          덱을 먼저 편성하세요. <button onClick={onEditDeck}>덱 편성하러 가기</button>
        </p>
      )}
      <div className="footer">
        <button className="primary" disabled={!deckOk || !opponent} onClick={() => deck && onStart(deck)}>
          게임 시작
        </button>
      </div>
    </div>
  )
}

// ───────────── 내 정보 ─────────────

export type MeSection = 'deck' | 'inventory' | 'dev'

function MyInfo({
  profile,
  onProfile,
  version,
  onChanged,
  onOpen,
  initial,
}: {
  profile: Profile
  onProfile: (p: Profile) => void
  version: number
  onChanged: () => void
  onOpen: (id: string) => void
  initial?: MeSection | undefined
}) {
  const [section, setSection] = useState<MeSection>(initial ?? 'deck')
  const [saved, setSaved] = useState(false)
  const total = profile.wins + profile.losses + profile.draws
  const rename = () => {
    const name = prompt('새 닉네임 (2~12자)', profile.nickname)?.trim()
    if (name && name.length >= 2 && name.length <= 12) onProfile({ ...profile, nickname: name })
  }
  return (
    <div className="screen-body">
      <div className="profile-card">
        <div className="row between">
          <strong className="nick-big">{profile.nickname}</strong>
          <button onClick={rename}>닉네임 변경</button>
        </div>
        <div className="record">
          <span>전적 {total}판</span>
          <span>
            {profile.wins}승 {profile.losses}패 {profile.draws}무
          </span>
          <span>승률 {total ? Math.round((profile.wins / total) * 100) : 0}%</span>
        </div>
      </div>
      <div className="segmented">
        {(
          [
            ['deck', '덱 편성'],
            ['inventory', '보관함'],
            ['dev', '개발'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={section === k ? 'on' : ''} onClick={() => (setSection(k), setSaved(false))}>
            {label}
          </button>
        ))}
      </div>
      {section === 'deck' && (
        <>
          <DeckScreen version={version} actionLabel="덱 저장" onStart={() => (setSaved(true), onChanged())} />
          {saved && <p className="hint">덱을 저장했습니다.</p>}
        </>
      )}
      {section === 'inventory' && <InventoryScreen version={version} onOpen={onOpen} />}
      {section === 'dev' && <DevScreen onChanged={onChanged} />}
    </div>
  )
}

// ───────────── 상점 ─────────────

function Shop({ onChanged, onOpen }: { onChanged: () => void; onOpen: (id: string) => void }) {
  const [section, setSection] = useState<'gacha' | 'gem' | 'rates'>('gacha')
  return (
    <div className="screen-body">
      <div className="segmented">
        {(
          [
            ['gacha', '뽑기'],
            ['gem', '보석 충전'],
            ['rates', '확률 정보'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={section === k ? 'on' : ''} onClick={() => setSection(k)}>
            {label}
          </button>
        ))}
      </div>
      {section === 'gacha' && <GachaScreen onChanged={onChanged} onOpen={onOpen} />}
      {section === 'rates' && <RatesScreen />}
      {section === 'gem' && (
        <div className="list">
          {[
            ['보석 100', '₩1,200'],
            ['보석 550', '₩5,900'],
            ['보석 1,200', '₩11,000'],
            ['보석 3,000', '₩25,000'],
          ].map(([name, price]) => (
            <div key={name} className="shop-item">
              <span>💎 {name}</span>
              <button disabled>{price}</button>
            </div>
          ))}
          <p className="hint">결제는 아직 준비 중입니다. 테스트용 보석은 내 정보 → 개발에서 받을 수 있습니다.</p>
        </div>
      )}
    </div>
  )
}
