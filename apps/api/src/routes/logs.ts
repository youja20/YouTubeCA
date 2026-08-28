import type { FastifyInstance } from 'fastify';
import { latestLogId, listLogs } from '@youtubeca/db';
import { listLogsQuery } from '@youtubeca/shared';
import type { ApiContext } from '../context.js';

const SSE_POLL_MS = 1000;

export function registerLogRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get('/logs', async (request) => {
    const query = listLogsQuery.parse(request.query);
    const data = listLogs(ctx.db, {
      runId: query.runId,
      keywordId: query.keywordId,
      level: query.level,
      stage: query.stage,
      cursor: query.cursor ? Number(query.cursor) : undefined,
      limit: query.limit,
    });
    const last = data[data.length - 1];
    return {
      data,
      meta: { cursor: data.length === query.limit && last ? String(last.id) : null },
    };
  });

  /**
   * 실시간 로그 스트림 (SSE)
   * run_logs 테이블을 1초 간격으로 tail 한다 — 데몬이 별도 프로세스이므로
   * 이벤트 버스 대신 DB 폴링이 가장 단순하고 안전하다.
   */
  app.get('/logs/stream', (request, reply) => {
    const query = listLogsQuery.partial().parse(request.query);
    const runId = query.runId;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let lastId = query.cursor ? Number(query.cursor) : latestLogId(ctx.db);
    let closed = false;

    const send = (event: string, payload: unknown) => {
      if (closed) return;
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    send('ready', { lastId });

    const timer = setInterval(() => {
      try {
        const logs = listLogs(ctx.db, {
          runId,
          keywordId: query.keywordId,
          level: query.level,
          stage: query.stage,
          afterId: lastId,
          limit: 200,
        });
        if (logs.length > 0) {
          lastId = logs[logs.length - 1]!.id;
          for (const log of logs) send('log', log);
        } else {
          // 프록시 타임아웃 방지용 keep-alive
          if (!closed) reply.raw.write(': ping\n\n');
        }
      } catch (error) {
        send('error', { message: error instanceof Error ? error.message : String(error) });
      }
    }, SSE_POLL_MS);

    const cleanup = () => {
      closed = true;
      clearInterval(timer);
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}
