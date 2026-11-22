import { makeGachaContext } from '@war/engine'
import { LocalGameService, LocalSaveStore, type GameService } from '@war/core'

/**
 * 앱 전역 서비스. UI 는 이 GameService 만 사용한다 (localStorage 직접 접근 금지).
 * 서버 전환 시 여기서 RemoteGameService 로 교체.
 */
export const gachaCtx = makeGachaContext()

const store = new LocalSaveStore(window.localStorage, {
  newSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
})

export const service: GameService = new LocalGameService({ ctx: gachaCtx, uow: store })
