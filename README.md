# Grid Tactics (가칭) — 동시 턴 전술 카드 대전 MVP

## 구조

```
packages/engine   순수 TS 게임 엔진 (DOM/Node 의존 없음 → 서버·Deno 에서 그대로 실행)
packages/ai       규칙 기반 AI (engine 의 query 만 사용) + 밸런스 시뮬레이션
packages/core     Repository 인터페이스·localStorage 구현·마이그레이션·GameService
apps/mobile       React + Vite UI, Capacitor(Android)
```

| 엔진 모듈 | 역할 |
|---|---|
| `config.ts` | 밸런스·규칙 수치 전부 (확률 상한, 행동 수, 이동 범위, 제한시간, 최대 턴 …) |
| `rng.ts` | 시드 기반 난수 (상태 직렬화 가능) |
| `cards/catalog.ts` | 카드 원본 데이터 (효과도 데이터로 정의) |
| `cards/instance.ts` | 가챠 개체 생성 (기본값 ± 랜덤 폭, 사거리·범위는 고정) |
| `trajectory.ts` | 직사·대각·곡사·범위 명중 계산 |
| `probability.ts` / `hit.ts` | 방어·관통·반사 공식, 상한 / 효과 반영한 최종 수치 (판정·UI·AI 공용) |
| `effects.ts` | `{발동 시점, 조건, 효과}` 인터프리터 |
| `validate.ts` | 팀·배치·턴 입력 검증 (UI·AI·서버 공용) |
| `resolve.ts` | 턴 처리: 스텝마다 이동 → 공격(방어→반사→피해 누적) → 동시 사망 → 로그 |
| `query.ts` | 이동 가능 칸, 공격 미리보기, 위협 계산 (읽기 전용) |
| `controller.ts` | `PlayerController` — 사람·AI·(추후) 원격 공통 입력 인터페이스 |

## 명령

```bash
npm install
npm test            # 엔진 + AI 단위 테스트
npm run typecheck
npm run dev         # 브라우저에서 플레이 (모바일 세로 기준)
npm run build

# Android (Android Studio 필요)
cd apps/mobile && npx cap add android   # 최초 1회
npm run cap:sync -w @war/mobile && npm run cap:android -w @war/mobile
```

## 확정된 규칙 해석
- 이동: 목표 칸은 스텝 시작 시 비어 있어야 함 → 비워지는 칸 진입·맞바꾸기 불가, 같은 칸 동시 이동은 둘 다 실패
- 공격 조준: 직사·대각 = 방향, 곡사·범위 = 칸 (빈 칸 가능). 명중은 **이동 후** 위치 기준
- 직사·대각은 아군에 막히되 아군 피해 없음. 범위·곡사도 적에게만 피해
- 거리: 맨해튼. 직사는 4방향
- 방어 확률 = `min(상한, 방어 × (1 − 관통/2))`. 관통은 반사에 영향 없음
- 반사: 원래 피해 그대로 공격자에게, 방어·재반사 없음. 범위 공격은 맞은 카드마다 따로 반사 판정
- 판정마다 방어·반사 난수를 항상 2개 소비 (난수 흐름 고정)
- `wait` 행동 존재. 최대 20턴 초과 시 남은 체력 비율로 판정
- 확률은 정수 bp(1% = 100)로 계산

## 온라인 전환 시 주의
- `resolveTurn(state, plans, { turnSeed })` — 온라인에서는 **양쪽 제출 후 서버가 비밀 시드를 생성**해 주입.
  클라이언트가 시드를 알면 행동안별 결과를 미리 시뮬레이션해 유리한 것만 제출할 수 있음.
- `GameState` 는 JSON 직렬화 가능 → 서버 저장·재개 가능.

## 2단계: 능력치 · 뽑기 · 리롤
- 확률표·비용: `packages/engine/src/gacha/table.ts` (이 파일 한 곳). 확률 화면은 `describeTable()`로 자동 생성
- 뽑기·리롤 순수 함수: `packages/engine/src/gacha/index.ts`
- 저장: UI → `GameService` → `UnitOfWork`/Repository → localStorage 키 `gamewar:save` 하나 (스키마 버전 + 마이그레이션)
- `DEV_UNLIMITED_RESOURCES`: `packages/core/src/config.ts`
- 밸런스 시뮬레이션: `SIM=1 npx vitest run packages/ai/test/balance.sim.test.ts`
- 위험지대(교착 방지): config `dangerZone*` — 기본 6턴부터 뒷줄, 11턴부터 2줄, 턴 끝 최대 HP 25% (방어력·보호막 무시)
- 직사·대각 관통: config `lineFalloffBp` (기본 50%씩 감소, 0 = 첫 적에서 멈춤), 챔프별 `trajectory.falloffBp`
