import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase 연결. apps/mobile/.env 에 VITE_SUPABASE_URL · VITE_SUPABASE_ANON_KEY(공개 키)가 있으면 온라인 모드.
 * 없으면 null → 앱은 오프라인(AI 연습)으로 동작한다.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

/** 게스트(익명) 로그인. 이미 세션이 있으면 그대로 사용 */
export async function ensureSession(): Promise<string> {
  if (!supabase) throw new Error('온라인 설정이 없습니다')
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session.user.id
  const { data: signed, error } = await supabase.auth.signInAnonymously()
  if (error || !signed.user) throw new Error(`로그인 실패: ${error?.message ?? '알 수 없음'}`)
  return signed.user.id
}

/** Postgres 함수 오류 메시지를 사람이 읽을 문장으로 */
export function errorText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  return m.replace(/^.*?ERROR:\s*/, '')
}
