# syntax=docker/dockerfile:1
#
# YouTubeCA 컨테이너 이미지 (api / daemon 공용)
#
#   api    : pnpm --filter @youtubeca/api start   (NODE_ENV=production 이면 web/dist도 서빙)
#   daemon : pnpm --filter @youtubeca/daemon start
#
# 런타임이 tsx(=devDependency)를 그대로 쓰므로 prod prune 없이 node_modules를 통째로 옮긴다.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# ─── 빌드 스테이지 ────────────────────────────────────────
FROM base AS build

# better-sqlite3 prebuilt 바이너리를 못 받는 아키텍처에서 소스 빌드로 폴백한다
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# 매니페스트만 먼저 복사해 install 레이어를 캐시한다 (소스 수정 시 재설치 안 함)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json      apps/api/
COPY apps/daemon/package.json   apps/daemon/
COPY apps/web/package.json      apps/web/
COPY packages/db/package.json      packages/db/
COPY packages/llm/package.json     packages/llm/
COPY packages/shared/package.json  packages/shared/
COPY packages/youtube/package.json packages/youtube/
RUN pnpm install --frozen-lockfile

COPY . .

# SPA 번들 생성 → API가 NODE_ENV=production에서 apps/web/dist를 서빙한다
RUN pnpm --filter @youtubeca/web build

# ─── 런타임 스테이지 ──────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production \
    DATABASE_URL=/app/data/youtubeca.db

COPY --from=build /app /app

# 볼륨이 마운트되지 않은 경우에도 기동되도록 미리 만들어 둔다
RUN mkdir -p /app/data /app/logs

EXPOSE 3000
CMD ["pnpm", "--filter", "@youtubeca/api", "start"]
