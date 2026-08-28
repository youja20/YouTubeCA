#!/usr/bin/env bash
#
# YouTubeCA — Docker 기반 실행 스크립트
#
#   ./run.sh up            빌드 + 마이그레이션 + api/daemon 기동
#   ./run.sh logs daemon   로그 추적
#   ./run.sh crawl --all   크롤링 CLI (일회성 컨테이너)
#   ./run.sh down          중지 + 컨테이너 제거
#
# 자세한 사용법은 `./run.sh help`.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# 호스트 노출 포트 — 셸 환경변수 > .env > 3000 (compose 보간 규칙과 동일)
PORT="${PORT:-$(sed -n 's/^[[:space:]]*PORT=[[:space:]]*\([0-9][0-9]*\).*/\1/p' .env 2>/dev/null | tail -1)}"
PORT="${PORT:-3000}"

# ─── 출력 헬퍼 ────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_DIM=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

info()  { printf '%s▸%s %s\n' "$C_BLUE" "$C_RESET" "$*"; }
ok()    { printf '%s✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn()  { printf '%s!%s %s\n' "$C_YELLOW" "$C_RESET" "$*" >&2; }
die()   { printf '%s✗%s %s\n' "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# ─── 사전 점검 ────────────────────────────────────────────
COMPOSE=()

require_docker() {
  command -v docker >/dev/null 2>&1 \
    || die "docker가 설치돼 있지 않습니다. Docker Desktop 또는 docker engine을 먼저 설치하세요."

  docker info >/dev/null 2>&1 \
    || die "docker 데몬에 연결할 수 없습니다. Docker Desktop이 실행 중인지 확인하세요."

  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
  else
    die "docker compose(v2) 또는 docker-compose가 필요합니다."
  fi
}

require_env() {
  if [[ ! -f .env ]]; then
    warn ".env가 없어 .env.example에서 생성합니다."
    cp .env.example .env
    die ".env에 YOUTUBE_API_KEY와 GEMINI_API_KEY를 채운 뒤 다시 실행하세요."
  fi

  # 컨테이너 안에서 죽기 전에 여기서 먼저 잡아준다 (env.ts가 기동 시 검증)
  local missing=()
  local key
  for key in YOUTUBE_API_KEY GEMINI_API_KEY; do
    grep -Eq "^[[:space:]]*${key}=[[:space:]]*[^[:space:]]" .env || missing+=("$key")
  done
  if (( ${#missing[@]} > 0 )); then
    die ".env의 다음 값이 비어 있습니다: ${missing[*]}  (.env.example 참고)"
  fi

  # 볼륨 마운트 대상 — 없으면 docker가 root 소유로 만들어버린다
  mkdir -p data logs
}

setup() { require_docker; require_env; }

compose() { "${COMPOSE[@]}" "$@"; }

# 일회성 잡: 서비스 컨테이너를 건드리지 않고 같은 이미지로 실행
run_once() { compose run --rm --no-deps "$@"; }

wait_healthy() {
  local tries=60 cid status
  info "API 기동 대기 중..."
  while (( tries-- > 0 )); do
    cid="$(compose ps -q api 2>/dev/null || true)"
    if [[ -n "$cid" ]]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      case "$status" in
        healthy)     return 0 ;;
        exited|dead) return 1 ;;
      esac
    fi
    sleep 2
  done
  return 1
}

# ─── 명령 ────────────────────────────────────────────────
cmd_build() {
  setup
  info "이미지 빌드 (youtubeca:local)"
  compose build "$@"
  ok "빌드 완료"
}

cmd_up() {
  setup
  info "이미지 준비 · 마이그레이션 · 서비스 기동"
  compose up -d --build "$@"

  if wait_healthy; then
    ok "기동 완료"
  else
    warn "API 헬스체크가 통과하지 못했습니다. 로그를 확인하세요: ./run.sh logs api"
  fi

  printf '\n'
  printf '  웹  : %shttp://127.0.0.1:%s%s\n' "$C_DIM" "$PORT" "$C_RESET"
  printf '  API : %shttp://127.0.0.1:%s/api/v1%s\n' "$C_DIM" "$PORT" "$C_RESET"
  printf '\n'
  printf '  로그: ./run.sh logs        중지: ./run.sh down\n'
  printf '\n'
  printf '  %s기본 키워드는 등록만 되고 크롤링은 자동으로 걸지 않습니다.%s\n' "$C_DIM" "$C_RESET"
  printf '  %s설정뷰에서 실행하거나 ./run.sh crawl --all 을 쓰세요.%s\n' "$C_DIM" "$C_RESET"
}

cmd_down() {
  setup
  # 데몬이 진행 중인 잡을 커밋할 시간을 준다 (stop_grace_period 30s)
  info "서비스 중지"
  compose down "$@"
  ok "중지 완료 (data/ 의 DB는 그대로 유지됩니다)"
}

cmd_restart() {
  setup
  (( $# > 0 )) || set -- api daemon
  compose restart "$@"
  ok "재시작 완료"
}

cmd_logs() {
  setup
  compose logs -f --tail=100 "$@"
}

cmd_ps() {
  setup
  compose ps
}

cmd_migrate() {
  setup
  info "마이그레이션 실행"
  run_once migrate
}

cmd_crawl() {
  setup
  (( $# > 0 )) || die '인자가 필요합니다. 예: ./run.sh crawl --all  |  ./run.sh crawl --keyword "무선이어폰"'
  # 데몬 없이 인라인으로 5단계를 돌린다 (§크롤링 실행)
  run_once daemon pnpm crawl "$@"
}

cmd_inspect() {
  setup
  run_once daemon pnpm --filter @youtubeca/daemon exec tsx src/cli/inspect.ts "$@"
}

cmd_health() {
  setup
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:${PORT}/api/v1/health" || die "API에 연결하지 못했습니다. ./run.sh ps 로 상태를 확인하세요."
    printf '\n'
  else
    run_once api node -e \
      "fetch('http://api:3000/api/v1/health').then(r=>r.text()).then(t=>console.log(t))"
  fi
}

cmd_shell() {
  setup
  run_once "${1:-api}" bash
}

cmd_clean() {
  setup
  warn "컨테이너·이미지·익명 볼륨을 제거합니다. data/ 의 DB는 남습니다."
  read -r -p "계속할까요? [y/N] " reply
  [[ "$reply" == [yY] ]] || { info "취소했습니다."; return 0; }
  compose down --rmi local --volumes --remove-orphans
  ok "정리 완료"
}

cmd_help() {
  cat <<'USAGE'
YouTubeCA — Docker 실행 스크립트

  ./run.sh up [옵션]        빌드 → 마이그레이션 → api + daemon 기동 (백그라운드)
  ./run.sh down             서비스 중지 및 컨테이너 제거 (DB는 유지)
  ./run.sh restart [서비스] 서비스 재시작 (기본: api daemon)
  ./run.sh build [옵션]     이미지만 빌드 (예: ./run.sh build --no-cache)
  ./run.sh logs [서비스]    로그 추적 (예: ./run.sh logs daemon)
  ./run.sh ps               컨테이너 상태
  ./run.sh migrate          마이그레이션 + 기본 키워드/설정 시드만 실행
  ./run.sh crawl <인자>     크롤링 CLI
                              ./run.sh crawl --all
                              ./run.sh crawl --keyword "무선이어폰"
                              ./run.sh crawl --keyword "무선이어폰" --stages analyze
  ./run.sh inspect <인자>   DB 점검 CLI (예: ./run.sh inspect --keyword "무선이어폰")
  ./run.sh health           /api/v1/health 조회 (DB·LLM·quota·데몬 상태)
  ./run.sh shell [서비스]   컨테이너 셸 진입 (기본: api)
  ./run.sh clean            컨테이너·로컬 이미지 제거

환경
  .env       YOUTUBE_API_KEY, GEMINI_API_KEY 필요 (없으면 .env.example에서 생성)
  data/      SQLite DB (호스트 볼륨) — 백업은 data/youtubeca.db* 세 파일을 함께
  logs/      컨테이너 로그 마운트 지점
  PORT       호스트 노출 포트 (기본 3000). 예: PORT=3001 ./run.sh up

API는 127.0.0.1에만 노출됩니다. 인증이 없으므로 외부에 그대로 열지 마세요.
USAGE
}

main() {
  local cmd="${1:-help}"
  shift || true
  case "$cmd" in
    up|start)      cmd_up "$@" ;;
    down|stop)     cmd_down "$@" ;;
    restart)       cmd_restart "$@" ;;
    build)         cmd_build "$@" ;;
    logs|log)      cmd_logs "$@" ;;
    ps|status)     cmd_ps "$@" ;;
    migrate)       cmd_migrate "$@" ;;
    crawl)         cmd_crawl "$@" ;;
    inspect)       cmd_inspect "$@" ;;
    health)        cmd_health "$@" ;;
    shell|sh|bash) cmd_shell "$@" ;;
    clean)         cmd_clean "$@" ;;
    help|-h|--help) cmd_help ;;
    *)             printf '알 수 없는 명령: %s\n\n' "$cmd" >&2; cmd_help; exit 1 ;;
  esac
}

main "$@"
