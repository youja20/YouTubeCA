# CentOS 7 서버에서 YouTubeCA용 Node 22를 쓰기 위한 환경 (이슈 #1)
#   . scripts/centos7/env.sh
#
# 서버의 시스템 node(/usr/bin/node v12)는 다른 서비스가 쓰므로 건드리지 않는다.
# ~/.bashrc에 넣지 말고, YouTubeCA 작업을 할 때만 source 한다.

export YOUTUBECA_NODE_HOME="${YOUTUBECA_NODE_HOME:-$HOME/.local/node22}"
export PATH="$YOUTUBECA_NODE_HOME/bin:$PATH"
export COREPACK_HOME="${COREPACK_HOME:-$HOME/.corepack}"
# node:sqlite의 ExperimentalWarning 억제
export NODE_OPTIONS="--disable-warning=ExperimentalWarning${NODE_OPTIONS:+ $NODE_OPTIONS}"
