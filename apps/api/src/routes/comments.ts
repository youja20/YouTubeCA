import type { FastifyInstance } from 'fastify';
import { listComments } from '@youtubeca/db';
import { listCommentsQuery } from '@youtubeca/shared';
import type { ApiContext } from '../context.js';

export function registerCommentRoutes(app: FastifyInstance, ctx: ApiContext): void {
  /** 커멘트뷰 (§7.3) — cursor 기반 무한 스크롤 */
  app.get('/comments', async (request) => {
    const query = listCommentsQuery.parse(request.query);
    const result = listComments(ctx.db, query);
    return {
      data: result.comments,
      meta: { cursor: result.nextCursor, total: result.total, hasMore: result.nextCursor !== null },
    };
  });
}
