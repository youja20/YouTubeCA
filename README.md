# YouTubeCA — YouTube Comment Analytics

키워드 기반 YouTube 댓글 수집 → 태그(핵심 단어) 추출·강도 산출 → AI 감성/인식 분석 → 웹 시각화.

전체 설계는 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)를 참고하세요. 이 문서는 실행 방법만 다룹니다.

## 요구 사항

- **Node.js 22 LTS 이상** — `node -v`로 확인
- **pnpm 9** — `corepack enable && corepack prepare pnpm@9.12.0 --activate`
- YouTube Data API v3 키, Google Gemini API 키

> macOS에서 Homebrew로 설치했다면 PATH에 추가해야 합니다:
> `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`

## 설치

```bash
cp .env.example .env      # YOUTUBE_API_KEY, GEMINI_API_KEY 채우기
pnpm install
pnpm db:migrate           # data/youtubeca.db 생성
```

## 개발 서버

```bash
pnpm dev                  # api(3000) + daemon + web(5173) 동시 기동
```

- 웹: http://localhost:5173 (API는 `/api`로 프록시)
- API: http://localhost:3000/api/v1

개별 실행이 필요하면:

```bash
pnpm --filter @youtubeca/api dev
pnpm --filter @youtubeca/daemon dev
pnpm --filter @youtubeca/web dev
```

## 기본 키워드

최초 기동 시 아래 8개가 자동 등록됩니다 — 갤럭시 폴드 8, 아이폰 폴드, 뉴진스, 에스파,
BTS, 독도 토너, 호호바 오일, 클리오.

한 번만 등록되며(지운 키워드는 되살아나지 않음), **크롤링은 자동으로 걸지 않습니다.**
8개를 한꺼번에 돌리면 약 4,000 quota(일일 한도의 40%)를 기동만으로 쓰게 되기 때문입니다.
설정뷰 ②의 미수집 키워드 배너에서 `[이 N개만 실행]`을 누르거나 `pnpm crawl --all`로 시작하세요.

## 크롤링 실행

웹 **설정뷰 → ② 크롤링 실행**에서 버튼으로 실행하는 것이 기본입니다.
데몬이 `jobs` 테이블을 2초 간격으로 폴링해 처리합니다.

**키워드를 새로 등록하면 해당 키워드의 크롤링이 자동으로 큐에 들어갑니다.**
설정뷰 ④ 고급 설정의 `키워드 등록 시 자동 크롤링`으로 끌 수 있고,
API는 요청 본문의 `autoRun`으로 건별 override가 가능합니다.
한 번에 많이 등록하면 그만큼 quota를 즉시 예약하므로(키워드당 약 504u) 주의하세요.

CLI로 직접 돌릴 수도 있습니다 (데몬 없이 인라인 실행):

```bash
pnpm crawl --keyword "무선이어폰"                       # 전체 5단계
pnpm crawl --keyword "무선이어폰" --stages extract,score,analyze   # 재분석만 (quota 미소모)
pnpm crawl --all                                        # 활성 키워드 전체
```

DB 상태 확인:

```bash
pnpm --filter @youtubeca/daemon exec tsx src/cli/inspect.ts --keyword "무선이어폰"
```

## 테스트 · 타입 검사

```bash
pnpm test                 # vitest (강도 공식, 토크나이저, 감성, LLM 계약, API 통합)
pnpm build                # 전 패키지 타입 검사 + 웹 번들
```

## 운영 기동 (pm2)

```bash
pnpm build
pm2 start ecosystem.config.cjs
pm2 logs youtubeca-daemon
```

`NODE_ENV=production`인 API는 `apps/web/dist`의 SPA를 함께 서빙하므로
http://127.0.0.1:3000 하나만 열면 됩니다. 기본 바인딩은 루프백이며,
인증이 없으므로 외부에 그대로 노출하지 마세요 (계획서 §11).

## 구조

```
apps/api      Fastify REST + SSE 로그 스트림
apps/daemon   5단계 파이프라인 워커 (discover→collect→extract→score→analyze)
apps/web      React SPA (키워드 / 태그 / 커멘트 / 설정 뷰)
packages/db       Drizzle 스키마 · 마이그레이션 · 쿼리
packages/shared   공용 타입 · zod 스키마 · 텍스트/감성 유틸
packages/youtube  YouTube Data API 클라이언트 · quota 가드 · 영상 랭킹
packages/llm      Gemini 클라이언트 · 프롬프트 · 인젝션 가드
```

## 문제 해결

**`EADDRINUSE: address already in use 127.0.0.1:3000`**

이전에 띄운 API 서버가 남아 있다는 뜻입니다. 확인 후 종료하세요.

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

`PORT=3001 pnpm --filter @youtubeca/api dev`로 다른 포트를 쓸 수도 있지만,
웹 개발 서버의 프록시 대상이 3000이므로 `apps/web/vite.config.ts`도 함께 바꿔야 합니다.

`pnpm dev`를 Ctrl+C로 끊었는데 프로세스가 남는 경우:

```bash
pkill -f "tsx.*src/index.ts"   # api + daemon 종료
```

**`ERR_REQUIRE_ESM` 또는 `pnpm: command not found`**

셸의 `node`가 구버전입니다. Node 22를 PATH 앞에 두세요.

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
```

**AI 분석만 계속 실패**

설정뷰의 상태 배지나 `curl localhost:3000/api/v1/health`로 LLM 상태를 먼저 확인하세요.
`GEMINI_API_KEY`가 잘못됐거나 `LLM_MODEL`이 사용할 수 없는 모델이면 헬스체크가
그 이유를 그대로 알려줍니다. 태그·강도는 그대로 유지되므로
`pnpm crawl --keyword "..." --stages analyze`로 재크롤링 없이 분석만 다시 돌릴 수 있습니다.

## 운영 메모

- **quota**: 키워드 1개당 약 500 units(일일 10,000 → 하루 19개). 초과가 예상되면
  Run이 `paused_quota`로 보류되고 태평양 표준시 자정 리셋 후 자동 재개됩니다.
- **LLM 모델**: Google Gemini의 OpenAI 호환 엔드포인트를 씁니다. `LLM_MODEL`을 비우면
  `gemini-3.7-flash`가 쓰입니다. 항상 최신을 따라가려면 `gemini-flash-latest` 별칭도
  가능하지만, 재현성을 위해 버전 명시를 권장합니다.
- **부분 성공**: AI 분석(5단계)이 실패해도 태그·강도는 유지됩니다.
  이후 `--stages analyze`로 재분석하면 됩니다.
- **DB**: SQLite(WAL). 백업은 `data/youtubeca.db*` 세 파일을 함께 복사하세요.
