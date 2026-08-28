import type { FastifyInstance } from 'fastify';
import { getTag, keywordsForTag, listTags, topCommentsForTag } from '@youtubeca/db';
import { idParam, listTagsQuery, type TagViewResponse } from '@youtubeca/shared';
import type { ApiContext } from '../context.js';
import { notFound } from '../errors.js';

export function registerTagRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/tags', async (request) => {
    const query = listTagsQuery.parse(request.query);
    const data = listTags(ctx.db, query);
    return { data, meta: { total: data.length } };
  });

  /** 태그뷰 응답 (§7.2) — ① 관련 키워드 ② 대표 댓글 20개 */
  app.get('/tags/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const tag = getTag(ctx.db, id);
    if (!tag) throw notFound('태그를 찾을 수 없습니다');

    const response: TagViewResponse = {
      tag,
      keywords: keywordsForTag(ctx.db, id, 20),
      topComments: topCommentsForTag(ctx.db, id, 20),
    };
    return { data: response };
  });
}
