#!/usr/bin/env bash
# 로컬(개발 PC)에서 실행: 웹 번들을 로컬에서 빌드해 올리고, 서버에서 의존성 설치·마이그레이션·pm2 재기동 (이슈 #1)
#   bash scripts/centos7/deploy.sh
#
# 서버(1.8G RAM, 스왑 없음)에서 tsc/vite 빌드를 돌리면 OOM 위험이 있어 빌드는 로컬에서만 한다.
# 서버에는 운영 의존성만 설치한다(pnpm install --prod). 서버 준비는 setup.sh 참고.
set -euo pipefail

REMOTE="${REMOTE:-lingo@lingotu.be}"
REMOTE_DIR="${REMOTE_DIR:-dev/YouTubeCA}"
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "커밋되지 않은 변경이 있습니다. 서버는 origin/${BRANCH}를 받으므로 먼저 커밋·푸시하세요." >&2
  exit 1
fi
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/${BRANCH}" 2>/dev/null)" ]; then
  echo "origin/${BRANCH}가 로컬 HEAD와 다릅니다. 먼저 푸시하세요." >&2
  exit 1
fi

echo "▶ [로컬] 타입 검사 + 웹 번들 빌드"
pnpm build

echo "▶ [서버] 코드 갱신 (${REMOTE}:${REMOTE_DIR} ← origin/${BRANCH})"
ssh "$REMOTE" "cd '$REMOTE_DIR' && git fetch origin && git checkout -B '$BRANCH' 'origin/$BRANCH'"

echo "▶ [서버] 웹 번들 업로드"
rsync -az --delete apps/web/dist/ "$REMOTE:$REMOTE_DIR/apps/web/dist/"

echo "▶ [서버] 의존성 설치 · 마이그레이션 · pm2 재기동"
ssh "$REMOTE" bash -s -- "$REMOTE_DIR" <<'EOF'
set -euo pipefail
cd "$1"
. scripts/centos7/env.sh
if [ ! -f .env ]; then
  echo ".env가 없습니다. .env.example을 복사해 API 키를 채운 뒤 다시 실행하세요." >&2
  exit 1
fi
mkdir -p logs data
pnpm install --prod --frozen-lockfile
pnpm db:migrate
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
pm2 status
EOF
