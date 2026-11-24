# 작업 규칙 (모든 컴퓨터·모든 세션 공통)

## 시작할 때
1. **[docs/worklog.md](docs/worklog.md) 를 먼저 읽는다.** 다른 컴퓨터에서 받은 요청·결정·남은 일이 모두 여기 있다.
2. 규칙 기준은 [docs/design.md](docs/design.md), 특수능력 원문은 [docs/spec](docs/spec).

## 요청을 받을 때마다
- **docs/worklog.md 맨 아래(해당 날짜)에 요청 요약 → 결과·결정·남은 일을 추가한다.** 작은 요청도 빠짐없이.
- 규칙이 확정·변경되면 docs/design.md 도 같이 고친다.
- 다른 컴퓨터에서 보려면 커밋·푸시가 필요하다. 푸시는 사용자가 요청할 때만 하되, 기록이 쌓였으면 올릴지 물어본다.

## 소통
- 사용자에게 보이는 글은 **항상 한국어**. 코드·명령·파일 경로만 영어.
- 용어: 턴 · 행동(한 턴 3번) · 이동 · 액션(이동 외 전부) · 대기.

## 구조
- `packages/v2` 게임 규칙 엔진 (현재 규칙). `packages/engine` 은 예전 규칙 (난수 Rng 만 v2 가 사용)
- `packages/core` 저장·뽑기·합성·리롤 서비스 (앱과 서버 함수가 같이 씀)
- `apps/mobile` React 앱 (Vercel 배포, Root Directory = apps/mobile)
- `supabase/` DB 마이그레이션 + 서버 함수 `game` (배포 전 `node scripts/sync-functions.mjs`)
- 확인: `npm run typecheck`, `npx vitest run`, `npm run build`. 시뮬레이션: `SIM=1 npx vitest run packages/v2/test/rs-`

## 금지
- Supabase 비밀 키(service_role / sb_secret)를 앱·대화·커밋에 넣지 않는다
- `supabase config push` 는 사용자 동의 없이 실행하지 않는다 (원격 인증 설정을 덮어씀)
