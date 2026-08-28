import type { FastifyInstance } from 'fastify';
import {
  countComments,
  countKeywords,
  getDaemonState,
  getQuotaUsed,
  getSettings,
  updateSettings,
} from '@youtubeca/db';
import { updateSettingsSchema, type HealthResponse } from '@youtubeca/shared';
import type { ApiContext } from '../context.js';

/** 데몬 하트비트가 이 시간 안에 갱신되면 살아있다고 본다 */
const DAEMON_ALIVE_MS = 30_000;

export function registerSettingsRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/settings', async () => ({ data: getSettings(ctx.db) }));

  app.patch('/settings', async (request) => {
    const patch = updateSettingsSchema.parse(request.body);
    return { data: updateSettings(ctx.db, patch) };
  });

  /** DB / LLM / quota / 데몬 상태 (§6) */
  app.get('/health', async () => {
    const settings = getSettings(ctx.db);
    const daemon = getDaemonState(ctx.db);
    const alive =
      daemon.lastSeenAt !== null &&
      Date.now() - new Date(daemon.lastSeenAt).getTime() < DAEMON_ALIVE_MS;

    const llm = ctx.llm
      ? await ctx.llm.health()
      : { ok: false, model: null, error: 'LLM 자격증명이 설정되지 않았습니다' };

    const response: HealthResponse = {
      ok: true,
      db: { ok: true, comments: countComments(ctx.db), keywords: countKeywords(ctx.db) },
      llm,
      youtube: {
        ok: true,
        quotaUsed: getQuotaUsed(ctx.db),
        quotaLimit: settings['yt.dailyQuota'],
      },
      daemon: { alive, lastSeenAt: daemon.lastSeenAt },
    };
    return { data: response };
  });
}
