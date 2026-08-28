import type { FastifyInstance } from 'fastify';
import {
  createRun,
  getRunDetail,
  listKeywords,
  listRuns,
  reconcileOrphanedRuns,
  requestCancel,
} from '@youtubeca/db';
import { createRunSchema, idParam, listRunsQuery } from '@youtubeca/shared';
import type { ApiContext } from '../context.js';
import { badRequest, notFound } from '../errors.js';

export function registerRunRoutes(app: FastifyInstance, ctx: ApiContext): void {
  /** 크롤링 실행 — 데몬이 jobs 테이블을 폴링해 처리한다 (§8.1) */
  app.post('/runs', async (request, reply) => {
    const body = createRunSchema.parse(request.body ?? {});
    let keywordIds = body.keywordIds;
    if (!keywordIds || keywordIds.length === 0) {
      keywordIds = listKeywords(ctx.db, { sort: 'updated', activeOnly: true }).map((k) => k.id);
    }
    if (keywordIds.length === 0) throw badRequest('실행할 활성 키워드가 없습니다');

    const run = createRun(ctx.db, { keywordIds, trigger: body.trigger, stages: body.stages });
    return reply.status(201).send({ data: run });
  });

  app.get('/runs', async (request) => {
    const query = listRunsQuery.parse(request.query);
    // 데몬이 떠 있지 않아도 고아 Run이 목록을 "대기"로 막지 않도록 여기서도 정리한다
    reconcileOrphanedRuns(ctx.db);
    const data = listRuns(ctx.db, {
      limit: query.limit,
      cursor: query.cursor ? Number(query.cursor) : undefined,
      status: query.status,
    });
    const last = data[data.length - 1];
    return {
      data,
      meta: { cursor: data.length === query.limit && last ? String(last.id) : null },
    };
  });

  app.get('/runs/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const detail = getRunDetail(ctx.db, id);
    if (!detail) throw notFound('실행 이력을 찾을 수 없습니다');
    return { data: detail };
  });

  app.post('/runs/:id/cancel', async (request) => {
    const { id } = idParam.parse(request.params);
    if (!getRunDetail(ctx.db, id)) throw notFound('실행 이력을 찾을 수 없습니다');
    const cancelled = requestCancel(ctx.db, id);
    if (!cancelled) throw badRequest('이미 종료된 실행입니다');
    return { data: { cancelled: true } };
  });
}
