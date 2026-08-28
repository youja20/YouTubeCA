import { CODE_DEFAULTS } from '@youtubeca/shared';
import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? CODE_DEFAULTS.port);
const host = process.env.HOST ?? '127.0.0.1'; // v1은 로컬/사내망 전제 (§11)

const app = await buildApp({ serveWeb: process.env.NODE_ENV === 'production' });

try {
  await app.listen({ port, host });
  app.log.info(`API 서버 기동: http://${host}:${port}/api/v1`);
} catch (error) {
  // 포트 충돌은 가장 흔한 기동 실패라 원인과 해결책을 바로 보여준다
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      [
        '',
        `✗ ${port} 포트가 이미 사용 중이라 API 서버를 띄우지 못했습니다.`,
        '',
        '  사용 중인 프로세스 확인:',
        `    lsof -nP -iTCP:${port} -sTCP:LISTEN`,
        '',
        '  이전에 띄운 서버가 남아 있다면 종료하거나, 다른 포트를 쓰세요:',
        `    PORT=3001 pnpm --filter @youtubeca/api dev`,
        '',
      ].join('\n'),
    );
    process.exit(1);
  }
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    app.log.info(`${signal} 수신 — 서버를 종료합니다`);
    void app.close().then(() => process.exit(0));
  });
}
