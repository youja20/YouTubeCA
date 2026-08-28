import type { FastifyInstance } from 'fastify';
import {
  createKeyword,
  createRun,
  deleteKeyword,
  getKeyword,
  getKeywordByName,
  getKeywordStats,
  getKeywordTags,
  getLatestAnalysis,
  getRelatedKeywords,
  getSettings,
  listKeywords,
  sampleCommentsByTag,
  updateKeyword,
} from '@youtubeca/db';
import {
  createKeywordSchema,
  createKeywordsBulkSchema,
  idParam,
  keywordTagsQuery,
  listKeywordsQuery,
  updateKeywordSchema,
  type Keyword,
  type KeywordViewResponse,
  type RunDto,
} from '@youtubeca/shared';
import type { ApiContext } from '../context.js';
import { badRequest, conflict, notFound } from '../errors.js';

/** 키워드뷰 ④에 노출할 태그 수 */
const SAMPLE_TAG_LIMIT = 8;

/**
 * 등록된 키워드에 대해 크롤링 Run을 큐에 넣는다 (§7.4 ①).
 * `autoRun`이 없으면 crawl.autoRunOnRegister 설정을 따른다.
 * 데몬이 떠 있지 않아도 jobs 테이블에 쌓였다가 기동 시 처리된다.
 */
function autoRunFor(
  ctx: ApiContext,
  keywords: Keyword[],
  override: boolean | undefined,
): RunDto | null {
  if (keywords.length === 0) return null;
  const enabled = override ?? getSettings(ctx.db)['crawl.autoRunOnRegister'];
  if (!enabled) return null;
  return createRun(ctx.db, { keywordIds: keywords.map((k) => k.id), trigger: 'manual' });
}

export function registerKeywordRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/keywords', async (request) => {
    const query = listKeywordsQuery.parse(request.query);
    const data = listKeywords(ctx.db, query);
    return { data, meta: { total: data.length } };
  });

  app.post('/keywords', async (request, reply) => {
    const body = createKeywordSchema.parse(request.body);
    if (getKeywordByName(ctx.db, body.name)) {
      throw conflict(`이미 등록된 키워드입니다: ${body.name}`);
    }
    const keyword = createKeyword(ctx.db, { name: body.name, note: body.note });
    const run = autoRunFor(ctx, [keyword], body.autoRun);
    return reply.status(201).send({ data: keyword, meta: { runId: run?.id ?? null } });
  });

  /** 설정뷰의 일괄 등록 (줄바꿈 구분) */
  app.post('/keywords/bulk', async (request, reply) => {
    const body = createKeywordsBulkSchema.parse(request.body);
    const created: Keyword[] = [];
    const duplicated: string[] = [];
    for (const name of body.names) {
      if (getKeywordByName(ctx.db, name)) {
        duplicated.push(name);
        continue;
      }
      created.push(createKeyword(ctx.db, { name }));
    }
    // 여러 개를 등록해도 Run은 하나로 묶는다 (스테이지가 키워드별로 나뉘어 진행률이 보인다)
    const run = autoRunFor(ctx, created, body.autoRun);
    return reply.status(201).send({
      data: created,
      meta: { total: created.length, runId: run?.id ?? null },
      duplicated,
    });
  });

  app.patch('/keywords/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const body = updateKeywordSchema.parse(request.body);
    if (!getKeyword(ctx.db, id)) throw notFound('키워드를 찾을 수 없습니다');
    if (body.name) {
      const existing = getKeywordByName(ctx.db, body.name);
      if (existing && existing.id !== id) throw conflict(`이미 등록된 키워드입니다: ${body.name}`);
    }
    const keyword = updateKeyword(ctx.db, id, body);
    return { data: keyword };
  });

  app.delete('/keywords/:id', async (request, reply) => {
    const { id } = idParam.parse(request.params);
    if (!deleteKeyword(ctx.db, id)) throw notFound('키워드를 찾을 수 없습니다');
    return reply.status(204).send();
  });

  /** 키워드뷰 집계 응답 (§6, §7.1) */
  app.get('/keywords/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const keyword = getKeyword(ctx.db, id);
    if (!keyword) throw notFound('키워드를 찾을 수 없습니다');

    const tags = getKeywordTags(ctx.db, id, 30);
    const response: KeywordViewResponse = {
      keyword,
      stats: getKeywordStats(ctx.db, id),
      tags,
      analysis: getLatestAnalysis(ctx.db, id),
      related: getRelatedKeywords(ctx.db, id),
      sampleComments: sampleCommentsByTag(
        ctx.db,
        id,
        tags.slice(0, SAMPLE_TAG_LIMIT).map((t) => t.tagId),
      ),
    };
    return { data: response };
  });

  app.get('/keywords/:id/tags', async (request) => {
    const { id } = idParam.parse(request.params);
    const { limit } = keywordTagsQuery.parse(request.query);
    if (!getKeyword(ctx.db, id)) throw notFound('키워드를 찾을 수 없습니다');
    return { data: getKeywordTags(ctx.db, id, limit) };
  });

  app.get('/keywords/:id/related', async (request) => {
    const { id } = idParam.parse(request.params);
    if (!getKeyword(ctx.db, id)) throw notFound('키워드를 찾을 수 없습니다');
    return { data: getRelatedKeywords(ctx.db, id) };
  });

  app.get('/keywords/:id/samples', async (request) => {
    const { id } = idParam.parse(request.params);
    const raw = request.query as { tagIds?: string };
    if (!raw.tagIds) throw badRequest('tagIds 쿼리 파라미터가 필요합니다');
    const tagIds = raw.tagIds
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v));
    return { data: sampleCommentsByTag(ctx.db, id, tagIds) };
  });
}
