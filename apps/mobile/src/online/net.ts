import type { UnitInstance } from '@war/v2'
import { ensureSession, errorText, supabase } from './supabase.ts'

/** 서버 방 (rooms 테이블 한 줄) */
export interface OnlineRoom {
  id: string
  title: string
  host_id: string
  host_name: string
  guest_id: string | null
  guest_name: string | null
  guest_ready: boolean
  has_password: boolean
  turn_seconds: number
  status: 'waiting' | 'playing' | 'closed'
  match_id: string | null
  created_at: string
}

export interface OnlineMatchRow {
  id: string
  room_id: string
  host_id: string
  guest_id: string
  turn_seconds: number
  host_deck: UnitInstance[]
  guest_deck: UnitInstance[] | null
  status: 'playing' | 'over'
  winner: 'A' | 'B' | 'draw' | null
}

export interface ServerProfile {
  id: string
  nickname: string
  wins: number
  losses: number
  draws: number
}

const db = () => {
  if (!supabase) throw new Error('온라인 설정이 없습니다')
  return supabase
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  await ensureSession()
  const { data, error } = await db().rpc(fn, args)
  if (error) throw new Error(errorText(error))
  return data as T
}

// ───────────── 프로필 ─────────────

export async function fetchMyProfile(): Promise<ServerProfile | null> {
  const uid = await ensureSession()
  const { data, error } = await db().from('profiles').select('*').eq('id', uid).maybeSingle()
  if (error) throw new Error(errorText(error))
  return data as ServerProfile | null
}

export const upsertProfile = (nickname: string) => rpc<ServerProfile>('upsert_profile', { p_nickname: nickname })

// ───────────── 방 ─────────────

/** 최근 3시간 안에 만들어진 열린 방 */
export async function fetchRooms(): Promise<OnlineRoom[]> {
  await ensureSession()
  const since = new Date(Date.now() - 3 * 3600_000).toISOString()
  const { data, error } = await db()
    .from('rooms')
    .select('*')
    .neq('status', 'closed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(errorText(error))
  return data as OnlineRoom[]
}

export async function fetchRoom(id: string): Promise<OnlineRoom | null> {
  const { data, error } = await db().from('rooms').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(errorText(error))
  return data as OnlineRoom | null
}

/** 방 테이블 변화 구독 (목록·대기실 공용). 반환값 = 구독 해제 */
export function watchRooms(onChange: () => void, roomId?: string): () => void {
  const ch = db()
    .channel(`rooms:${roomId ?? 'all'}:${Math.random().toString(36).slice(2)}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rooms', ...(roomId ? { filter: `id=eq.${roomId}` } : {}) },
      onChange,
    )
    .subscribe()
  return () => void db().removeChannel(ch)
}

export const createOnlineRoom = (title: string, password: string | null, turnSeconds: number) =>
  rpc<OnlineRoom>('create_room', { p_title: title, p_password: password ?? '', p_turn_seconds: turnSeconds })
export const joinOnlineRoom = (id: string, password: string | null) =>
  rpc<OnlineRoom>('join_room', { p_room_id: id, p_password: password ?? '' })
export const leaveOnlineRoom = (id: string) => rpc<void>('leave_room', { p_room_id: id })
export const setReady = (id: string, ready: boolean) => rpc<void>('set_ready', { p_room_id: id, p_ready: ready })

// ───────────── 대전 ─────────────

/** 덱은 서버에 저장된 내 덱을 서버가 직접 꺼내 쓴다 (앱이 보내지 않음) */
export const startOnlineMatch = (roomId: string) => rpc<OnlineMatchRow>('start_match', { p_room_id: roomId })
export const submitGuestDeck = (matchId: string) => rpc<void>('submit_guest_deck', { p_match_id: matchId })

export async function fetchMatch(id: string): Promise<OnlineMatchRow | null> {
  const { data, error } = await db().from('matches').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(errorText(error))
  return data as OnlineMatchRow | null
}

/** 양쪽 덱이 다 들어올 때까지 기다림 */
export async function waitForDecks(matchId: string, signal: AbortSignal): Promise<OnlineMatchRow> {
  return waitUntil(
    async () => {
      const m = await fetchMatch(matchId)
      return m?.guest_deck ? m : null
    },
    (wake) => watchTable('matches', `id=eq.${matchId}`, wake),
    signal,
  )
}

/**
 * 대전 중 행동 주고받기. turn 0 = 배치, 1.. = 턴.
 * 상대 행동은 양쪽이 다 낸 뒤에만 서버가 보여준다 (RLS).
 */
export class MatchNet {
  constructor(
    readonly matchId: string,
    readonly side: 'A' | 'B',
  ) {}

  async submit(turn: number, payload: unknown): Promise<void> {
    const { error } = await db().from('match_moves').insert({ match_id: this.matchId, turn, side: this.side, payload })
    if (error && error.code !== '23505') throw new Error(errorText(error)) // 23505 = 이미 냄 (재시도)
  }

  waitOpponent<T>(turn: number, signal: AbortSignal): Promise<T> {
    const opp = this.side === 'A' ? 'B' : 'A'
    return waitUntil(
      async () => {
        const { data, error } = await db()
          .from('match_moves')
          .select('payload')
          .eq('match_id', this.matchId)
          .eq('turn', turn)
          .eq('side', opp)
          .maybeSingle()
        if (error) throw new Error(errorText(error))
        return data ? (data.payload as T) : null
      },
      (wake) => watchTable('match_moves', `match_id=eq.${this.matchId}`, wake),
      signal,
    )
  }
}

function watchTable(table: string, filter: string, onChange: () => void): () => void {
  const ch = db()
    .channel(`${table}:${filter}:${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter }, onChange)
    .subscribe()
  return () => void db().removeChannel(ch)
}

/** 실시간 알림 + 2초 주기 확인으로 조건이 만족될 때까지 기다림 */
async function waitUntil<T>(
  check: () => Promise<T | null>,
  watch: (wake: () => void) => () => void,
  signal: AbortSignal,
): Promise<T> {
  let wake: () => void = () => {}
  const stop = watch(() => wake())
  try {
    for (;;) {
      if (signal.aborted) throw new Error('취소됨')
      const v = await check()
      if (v !== null) return v
      await new Promise<void>((r) => {
        const t = setTimeout(r, 2000)
        wake = () => (clearTimeout(t), r())
        signal.addEventListener('abort', () => (clearTimeout(t), r()), { once: true })
      })
    }
  } finally {
    stop()
  }
}
