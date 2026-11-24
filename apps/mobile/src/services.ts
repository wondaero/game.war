import { LocalGameService, LocalSaveStore, type GameService } from '@war/core'
import { makeV2Config } from '@war/v2'
import { RemoteGameService } from './online/remoteService.ts'

/**
 * 앱 전역 서비스. UI 는 이 GameService 만 사용한다 (localStorage 직접 접근 금지).
 * - 오프라인: 이 기기에 저장 (LocalGameService)
 * - 온라인: 서버 함수 game 이 판정·저장 (RemoteGameService)
 * 게임 입장 때 setServiceMode 로 바꾼다. 화면은 항상 같은 `service` 를 쓴다.
 */
export const V2_CFG = makeV2Config()

const store = new LocalSaveStore(window.localStorage, {
  newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
})

const local = new LocalGameService({ uow: store, config: V2_CFG })
const remote = new RemoteGameService(V2_CFG)
let current: GameService = local

export function setServiceMode(mode: 'online' | 'offline') {
  current = mode === 'online' ? remote : local
}

/** 현재 모드의 서비스로 전달하는 대리 객체 */
export const service: GameService = new Proxy({} as GameService, {
  get: (_t, prop) => {
    const v = (current as unknown as Record<string | symbol, unknown>)[prop]
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(current) : v
  },
})
