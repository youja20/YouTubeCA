import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { REPO_ROOT } from '@youtubeca/shared/env';
import { createApiContext, type ApiContext, type CreateApiContextOptions } from './context.js';
import { sendError } from './errors.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerKeywordRoutes } from './routes/keywords.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerRunRoutes } from './routes/runs.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTagRoutes } from './routes/tags.js';

export const API_PREFIX = '/api/v1';

export interface BuildAppOptions extends CreateApiContextOptions {
  context?: ApiContext;
  logger?: boolean;
  /** 빌드된 SPA를 함께 서빙할지 (운영 기동 시 true) */
  serveWeb?: boolean;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const ctx = options.context ?? createApiContext(options);
  const app = Fastify({
    logger: options.logger ?? process.env.NODE_ENV !== 'test',
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });

  app.setErrorHandler((error, _request, reply) => sendError(reply, error));
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith(API_PREFIX)) {
      return reply.status(404).send({
        error: { code: 'NOT_FOUND', message: `경로를 찾을 수 없습니다: ${request.url}` },
      });
    }
    // SPA 히스토리 라우팅 폴백
    if (options.serveWeb) return reply.sendFile('index.html');
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not Found' } });
  });

  await app.register(
    async (instance) => {
      registerKeywordRoutes(instance, ctx);
      registerTagRoutes(instance, ctx);
      registerCommentRoutes(instance, ctx);
      registerRunRoutes(instance, ctx);
      registerLogRoutes(instance, ctx);
      registerSettingsRoutes(instance, ctx);
    },
    { prefix: API_PREFIX },
  );

  if (options.serveWeb) {
    const webRoot = join(REPO_ROOT, 'apps', 'web', 'dist');
    if (existsSync(webRoot)) {
      await app.register(fastifyStatic, { root: webRoot });
    } else {
      app.log.warn(`웹 빌드 산출물이 없습니다: ${webRoot} (pnpm --filter @youtubeca/web build)`);
    }
  }

  app.decorate('apiContext', ctx);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    apiContext: ApiContext;
  }
}
