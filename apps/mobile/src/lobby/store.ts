/**
 * 로비 데이터 (임시, 이 기기에만 저장).
 * 서버가 생기면 RoomService·ProfileService 를 서버 호출로 바꾼다. UI 는 이 함수들만 쓴다.
 */

// ───────────── 내 정보 ─────────────

export interface Profile {
  nickname: string
  wins: number
  losses: number
  draws: number
}

const PROFILE_KEY = 'gamewar:profile'

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY)
    if (raw) return { wins: 0, losses: 0, draws: 0, ...(JSON.parse(raw) as Partial<Profile>) } as Profile
  } catch {
    /* 손상 시 새로 만든다 */
  }
  const p: Profile = { nickname: `플레이어${Math.floor(1000 + Math.random() * 9000)}`, wins: 0, losses: 0, draws: 0 }
  saveProfile(p)
  return p
}

export function saveProfile(p: Profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p))
}

export function recordResult(r: 'win' | 'loss' | 'draw'): Profile {
  const p = loadProfile()
  if (r === 'win') p.wins++
  else if (r === 'loss') p.losses++
  else p.draws++
  saveProfile(p)
  return p
}

// ───────────── 방 ─────────────

export interface Room {
  id: string
  title: string
  host: string
  players: number
  capacity: number
  status: 'waiting' | 'playing'
  password: string | null
  /** 턴 입력 제한 시간(초). 0 = 무제한 (AI 연습·오프라인 전용) */
  turnSeconds: number
  /** 지금은 서버가 없어 상대는 AI */
  ai: boolean
  mine: boolean
}

export interface NewRoom {
  title: string
  password: string | null
  turnSeconds: number
}

export const TURN_SECONDS = [15, 30, 60] as const
/** AI 연습·오프라인 방에서 고를 수 있는 제한시간 (0 = 무제한). 온라인 대전은 무제한 불가 */
export const PRACTICE_SECONDS = [15, 30, 60, 0] as const
export const secondsLabel = (s: number) => (s > 0 ? `${s}초` : '무제한')

const PRACTICE_KEY = 'gamewar:practiceSeconds'
/** 개발 메뉴에서 정하는 AI 연습 제한시간 (기본 30초) */
export function loadPracticeSeconds(): number {
  const v = Number(localStorage.getItem(PRACTICE_KEY) ?? 30)
  return (PRACTICE_SECONDS as readonly number[]).includes(v) ? v : 30
}
export function savePracticeSeconds(s: number) {
  localStorage.setItem(PRACTICE_KEY, String(s))
}

/** 서버 연결 전 임시 방 (AI 상대) */
const SAMPLE_ROOMS: Room[] = [
  { id: 's1', title: '초보 환영 한 판', host: 'AI 연습 상대', players: 1, capacity: 2, status: 'waiting', password: null, turnSeconds: 30, ai: true, mine: false },
  { id: 's2', title: '빠른 대전 (15초)', host: 'AI 연습 상대', players: 1, capacity: 2, status: 'waiting', password: null, turnSeconds: 15, ai: true, mine: false },
  { id: 's3', title: '친구 전용', host: 'AI 연습 상대', players: 1, capacity: 2, status: 'waiting', password: '1234', turnSeconds: 30, ai: true, mine: false },
  { id: 's4', title: '고수만', host: 'AI 연습 상대', players: 2, capacity: 2, status: 'playing', password: null, turnSeconds: 30, ai: true, mine: false },
]

const myRooms: Room[] = []

export function listRooms(): Room[] {
  return [...myRooms, ...SAMPLE_ROOMS]
}

export function createRoom(input: NewRoom, host: string): Room {
  const room: Room = {
    id: `r${Date.now()}`,
    title: input.title.trim() || `${host}의 방`,
    host,
    players: 1,
    capacity: 2,
    status: 'waiting',
    password: input.password?.trim() || null,
    turnSeconds: input.turnSeconds,
    ai: false,
    mine: true,
  }
  myRooms.unshift(room)
  return room
}

export function closeRoom(id: string) {
  const i = myRooms.findIndex((r) => r.id === id)
  if (i >= 0) myRooms.splice(i, 1)
}
