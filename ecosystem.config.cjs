/**
 * pm2 운영 기동 설정 (계획서 §3.2, 부록 B)
 *   pnpm build && pm2 start ecosystem.config.cjs
 *
 * API는 NODE_ENV=production 일 때 apps/web/dist 의 SPA를 함께 서빙한다.
 *
 * tsx CLI(자식 node를 한 번 더 띄움) 대신 `node --import tsx`로 한 프로세스에서 돌린다.
 * 소형 서버(CentOS 7, 1.8G RAM, 스왑 없음 — 이슈 #1)에서 프로세스당 수십 MB를 아끼고,
 * pm2의 max_memory_restart가 실제 작업 프로세스의 메모리를 보게 하기 위해서다.
 */
const { resolve } = require('node:path');

const root = __dirname;

// node:sqlite의 ExperimentalWarning은 매 기동마다 찍히므로 끈다
const NODE_OPTIONS = '--disable-warning=ExperimentalWarning';

module.exports = {
  apps: [
    {
      name: 'youtubeca-api',
      script: 'src/index.ts',
      interpreter: 'node',
      node_args: '--import tsx --max-old-space-size=192',
      cwd: resolve(root, 'apps/api'),
      env: { NODE_ENV: 'production', NODE_OPTIONS, PORT: '3200', HOST: '127.0.0.1' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '300M',
      out_file: resolve(root, 'logs/api.out.log'),
      error_file: resolve(root, 'logs/api.err.log'),
    },
    {
      name: 'youtubeca-daemon',
      script: 'src/index.ts',
      interpreter: 'node',
      node_args: '--import tsx --max-old-space-size=320',
      cwd: resolve(root, 'apps/daemon'),
      env: { NODE_ENV: 'production', NODE_OPTIONS },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // 데몬은 SIGTERM 수신 후 현재 잡을 커밋하고 종료한다 (§8.1)
      kill_timeout: 30000,
      max_memory_restart: '450M',
      out_file: resolve(root, 'logs/daemon.out.log'),
      error_file: resolve(root, 'logs/daemon.err.log'),
    },
  ],
};
