// 게임 서버 함수 (Deno). 앱의 LocalGameService(새 규칙 v2)를 그대로 서버에서 실행하고, 저장만 DB(saves)로 한다.
// → 뽑기 판정과 재화가 서버에만 있으므로 앱에서 결과를 조작할 수 없다.
// 대전 결과도 여기서 행동 기록을 다시 계산해 확인한 뒤 기록한다.
//
// 배포:  node scripts/sync-functions.mjs && npx supabase functions deploy game --use-api --no-verify-jwt
// (로그인 확인은 함수 안에서 직접 함)

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  createGame,
  deploy,
  makeV2Config,
  resolveTurn,
  sanitizePlan,
  validateDeployment,
  type AbilityKind,
  type GameState,
  type Pos,
  type UnitInstance,
} from '../_shared/v2/index.ts'
import { LocalGameService, LocalSaveStore, MemoryStorage, type Wallet } from '../_shared/core/index.ts'

const URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
/** 개발 단계: 비용 차감 없음 + 개발 메뉴 허용. 정식 서비스 때 GAME_DEV_MODE=false */
const DEV_MODE = (Deno.env.get('GAME_DEV_MODE') ?? 'true') !== 'false'

const cfg = makeV2Config()
const SAVE_KEY = 'gamewar:save'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body ?? null), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } })
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await admin.auth.getUser(token)
    if (!auth.user) throw new HttpError(401, '로그인이 필요합니다')
    const uid = auth.user.id
    const { action, args = {} } = (await req.json()) as { action: string; args?: Record<string, unknown> }

    switch (action) {
      case 'state':
        return json(
          await withSave(admin, uid, async (s) => ({
            wallet: await s.getWallet(),
            units: await s.listUnits(),
            deck: await s.getDeck(),
            chargesResources: s.chargesResources,
            devMode: DEV_MODE,
          })),
        )
      case 'pull':
        return json(await withSave(admin, uid, (s) => s.pull(args.count === 10 ? 10 : 1)))
      case 'setDeck':
        return json(await withSave(admin, uid, (s) => s.setDeck((args.unitIds as string[]) ?? [])))
      case 'dev.addResources':
        devOnly()
        return json(await withSave(admin, uid, (s) => s.dev.addResources(args.delta as Partial<Wallet>)))
      case 'dev.resetInventory':
        devOnly()
        return json(await withSave(admin, uid, (s) => s.dev.resetInventory()))
      case 'dev.grantUnit':
        devOnly()
        return json(await withSave(admin, uid, (s) => s.dev.grantUnit((args.ability as AbilityKind | null) ?? null)))
      case 'finishMatch':
        return json(await finishMatch(admin, uid, String(args.matchId)))
      default:
        throw new HttpError(400, `알 수 없는 요청: ${action}`)
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 400
    return json({ error: (e as Error).message }, status)
  }
})

function devOnly() {
  if (!DEV_MODE) throw new HttpError(403, '개발 기능이 꺼져 있습니다')
}

/**
 * 사용자 저장 한 줄을 불러와 LocalGameService 로 처리하고, 바뀌었으면 저장.
 * 동시에 두 요청이 오면 version 으로 충돌을 감지해 다시 시도 (최대 3번).
 */
async function withSave<T>(admin: SupabaseClient, uid: string, fn: (s: LocalGameService) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await admin.from('saves').select('data, version').eq('user_id', uid).maybeSingle()
    if (error) throw new Error(error.message)
    const mem = new MemoryStorage()
    const before = row ? JSON.stringify(row.data) : null
    if (before) mem.setItem(SAVE_KEY, before)
    const store = new LocalSaveStore(mem, { newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]! })
    const service = new LocalGameService({ config: cfg, uow: store, unlimitedResources: DEV_MODE })
    const result = await fn(service)
    const after = mem.getItem(SAVE_KEY)
    if (!after || after === before) return result

    const data = JSON.parse(after)
    if (row) {
      const { data: upd, error: e2 } = await admin
        .from('saves')
        .update({ data, version: row.version + 1, updated_at: new Date().toISOString() })
        .eq('user_id', uid)
        .eq('version', row.version)
        .select('user_id')
      if (e2) throw new Error(e2.message)
      if (upd && upd.length === 1) return result
    } else {
      const { error: e3 } = await admin.from('saves').insert({ user_id: uid, data })
      if (!e3) return result
      if (e3.code !== '23505') throw new Error(e3.message)
    }
    // 다른 요청이 먼저 저장함 → 최신 상태로 다시
  }
  throw new HttpError(409, '잠시 후 다시 시도하세요')
}

/**
 * 대전 결과 확인: 저장된 덱 + 양쪽 행동 기록으로 처음부터 다시 계산해서 승패를 정한다.
 * (앱과 같은 규칙: sanitizePlan 으로 정리)
 */
async function finishMatch(admin: SupabaseClient, uid: string, matchId: string) {
  const { data: m, error } = await admin.from('matches').select('*').eq('id', matchId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!m || (m.host_id !== uid && m.guest_id !== uid)) throw new HttpError(403, '참가자가 아닙니다')
  if (m.status === 'over') return { winner: m.winner, verified: true }
  if (!m.guest_deck) throw new HttpError(409, '대전이 시작되지 않았습니다')

  const { data: moves, error: e2 } = await admin
    .from('match_moves')
    .select('turn, side, payload')
    .eq('match_id', matchId)
    .order('turn')
  if (e2) throw new Error(e2.message)
  const at = (turn: number, side: 'A' | 'B') => moves?.find((x) => x.turn === turn && x.side === side)?.payload

  let s: GameState = createGame({ A: m.host_deck as UnitInstance[], B: m.guest_deck as UnitInstance[] }, cfg)
  const depA = at(0, 'A') as Pos[] | undefined
  const depB = at(0, 'B') as Pos[] | undefined
  if (!depA || !depB) return { pending: true }
  if (!validateDeployment(s, 'A', depA).ok || !validateDeployment(s, 'B', depB).ok)
    throw new HttpError(409, '배치 기록이 올바르지 않습니다')
  s = deploy(s, { A: depA, B: depB })

  while (s.phase === 'plan') {
    const a = at(s.turn, 'A')
    const b = at(s.turn, 'B')
    if (a === undefined || b === undefined) return { pending: true, turn: s.turn }
    // 앱과 같은 규칙으로 정리 (규칙에 안 맞는 계획은 앱도 서버도 똑같이 바꿈)
    const plans = { A: sanitizePlan(s, 'A', a), B: sanitizePlan(s, 'B', b) }
    s = resolveTurn(s, plans).state
  }
  const winner = s.result!.winner
  const { error: e3 } = await admin.rpc('finish_match_verified', { p_match_id: matchId, p_winner: winner })
  if (e3) throw new Error(e3.message)
  return { winner, verified: true }
}
