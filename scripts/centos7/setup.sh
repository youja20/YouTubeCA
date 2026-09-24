#!/usr/bin/env bash
# CentOS 7 서버에 YouTubeCA 런타임을 사용자 로컬로 설치한다 (이슈 #1). root 불필요, 재실행 안전.
#   bash scripts/centos7/setup.sh
#
# - Node 22: 공식 바이너리는 glibc 2.28+가 필요해 CentOS 7(glibc 2.17)에서 실행되지 않는다.
#   Node.js 프로젝트의 unofficial-builds가 배포하는 linux-x64-glibc-217 빌드를 쓴다.
# - pnpm: Node에 포함된 corepack으로 package.json의 packageManager 버전을 활성화한다.
# - pm2: 위 Node의 전역 prefix(~/.local/node22)에 설치한다.
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-v22.23.2}"
PNPM_VERSION="${PNPM_VERSION:-9.12.0}"
BASE_URL="https://unofficial-builds.nodejs.org/download/release/${NODE_VERSION}"
TARBALL="node-${NODE_VERSION}-linux-x64-glibc-217.tar.xz"
INSTALL_DIR="$HOME/.local/node-${NODE_VERSION}-glibc-217"
LINK="$HOME/.local/node22"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "$(uname -m)" != "x86_64" ]; then
  echo "x86_64 전용입니다 (현재: $(uname -m))" >&2
  exit 1
fi

if [ ! -x "$INSTALL_DIR/bin/node" ]; then
  echo "▶ Node ${NODE_VERSION} (glibc-217) 설치 → ${INSTALL_DIR}"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/$TARBALL" "$BASE_URL/$TARBALL"
  curl -fsSL -o "$tmp/SHASUMS256.txt" "$BASE_URL/SHASUMS256.txt"
  (cd "$tmp" && grep " ${TARBALL}\$" SHASUMS256.txt | sha256sum -c -)
  mkdir -p "$INSTALL_DIR"
  tar -xJf "$tmp/$TARBALL" -C "$INSTALL_DIR" --strip-components=1
else
  echo "✓ Node ${NODE_VERSION} 이미 설치됨"
fi
ln -sfn "$INSTALL_DIR" "$LINK"

# shellcheck source=env.sh
. "$here/env.sh"
echo "  node $(node -v) ($(command -v node))"

echo "▶ pnpm ${PNPM_VERSION} (corepack)"
corepack enable --install-directory "$LINK/bin" pnpm
corepack prepare "pnpm@${PNPM_VERSION}" --activate
echo "  pnpm $(pnpm -v)"

if [ ! -x "$LINK/bin/pm2" ]; then
  echo "▶ pm2 설치"
  npm install -g pm2 --no-fund --no-audit
fi
# `pm2 -v`는 pm2 데몬을 띄우므로 버전은 package.json에서 읽는다
echo "  pm2 $(node -p "require('$LINK/lib/node_modules/pm2/package.json').version")"

swap_kb="$(awk '/SwapTotal/ {print $2}' /proc/meminfo)"
if [ "${swap_kb:-0}" -eq 0 ]; then
  cat <<'EOF'

⚠ 스왑이 없습니다. 메모리 1.8G 서버에서는 pnpm install 중 OOM이 날 수 있으니
  관리자 권한으로 스왑을 추가하는 것을 권장합니다:
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
    sudo mkswap /swapfile && sudo swapon /swapfile
    echo '/swapfile none swap defaults 0 0' | sudo tee -a /etc/fstab
EOF
fi

echo
echo "완료. 작업 셸에서:  . scripts/centos7/env.sh"
