/**
 * pm2 운영 기동 설정 (계획서 §3.2, 부록 B)
 *   pnpm build && pm2 start ecosystem.config.cjs
 *
 * API는 NODE_ENV=production 일 때 apps/web/dist 의 SPA를 함께 서빙한다.
 */
const { resolve } = require('node:path');

const root = __dirname;
const tsx = resolve(root, 'node_modules/.bin/tsx');

module.exports = {
  apps: [
    {
      name: 'youtubeca-api',
      script: tsx,
      args: 'src/index.ts',
      cwd: resolve(root, 'apps/api'),
      env: { NODE_ENV: 'production', PORT: '3000', HOST: '127.0.0.1' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      max_memory_restart: '500M',
      out_file: resolve(root, 'logs/api.out.log'),
      error_file: resolve(root, 'logs/api.err.log'),
    },
    {
      name: 'youtubeca-daemon',
      script: tsx,
      args: 'src/index.ts',
      cwd: resolve(root, 'apps/daemon'),
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      // 데몬은 SIGTERM 수신 후 현재 잡을 커밋하고 종료한다 (§8.1)
      kill_timeout: 30000,
      max_memory_restart: '1G',
      out_file: resolve(root, 'logs/daemon.out.log'),
      error_file: resolve(root, 'logs/daemon.err.log'),
    },
  ],
};
