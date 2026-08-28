import type { LogDto, LogLevel } from '@youtubeca/shared';
import type { DbContext } from '../client.js';

export interface LogInput {
  runId?: number | null;
  keywordId?: number | null;
  stage?: string | null;
  level?: LogLevel;
  message: string;
  meta?: unknown;
}

interface LogRow {
  id: number;
  run_id: number | null;
  keyword_id: number | null;
  stage: string | null;
  level: string;
  message: string;
  meta: string | null;
  ts: string;
}

function toDto(row: LogRow): LogDto {
  let meta: unknown = null;
  if (row.meta) {
    try {
      meta = JSON.parse(row.meta);
    } catch {
      meta = row.meta;
    }
  }
  return {
    id: row.id,
    runId: row.run_id,
    keywordId: row.keyword_id,
    stage: row.stage,
    level: row.level as LogLevel,
    message: row.message,
    meta,
    ts: row.ts,
  };
}

export function insertLog(ctx: DbContext, input: LogInput): LogDto {
  const row = ctx.sqlite
    .prepare(
      `INSERT INTO run_logs(run_id, keyword_id, stage, level, message, meta)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .get(
      input.runId ?? null,
      input.keywordId ?? null,
      input.stage ?? null,
      input.level ?? 'info',
      input.message,
      input.meta === undefined ? null : JSON.stringify(input.meta),
    ) as LogRow;
  return toDto(row);
}

export interface ListLogsParams {
  runId?: number;
  keywordId?: number;
  level?: LogLevel;
  stage?: string;
  /** 이 id 미만(과거 방향)으로 페이징 */
  cursor?: number;
  /** 이 id 초과(실시간 tail 방향) */
  afterId?: number;
  limit?: number;
}

export function listLogs(ctx: DbContext, params: ListLogsParams): LogDto[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.runId !== undefined) {
    where.push('run_id = ?');
    args.push(params.runId);
  }
  if (params.keywordId !== undefined) {
    where.push('keyword_id = ?');
    args.push(params.keywordId);
  }
  if (params.level) {
    // 지정 레벨 이상만 (debug < info < warn < error)
    const order = ['debug', 'info', 'warn', 'error'];
    const min = order.indexOf(params.level);
    const allowed = order.slice(min);
    where.push(`level IN (${allowed.map(() => '?').join(',')})`);
    args.push(...allowed);
  }
  if (params.stage) {
    where.push('stage = ?');
    args.push(params.stage);
  }
  if (params.cursor !== undefined) {
    where.push('id < ?');
    args.push(params.cursor);
  }
  if (params.afterId !== undefined) {
    where.push('id > ?');
    args.push(params.afterId);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(params.limit ?? 100, 500);
  const direction = params.afterId !== undefined ? 'ASC' : 'DESC';
  const rows = ctx.sqlite
    .prepare(`SELECT * FROM run_logs ${clause} ORDER BY id ${direction} LIMIT ?`)
    .all(...args, limit) as LogRow[];
  return rows.map(toDto);
}

export function latestLogId(ctx: DbContext): number {
  const row = ctx.sqlite.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM run_logs').get() as {
    id: number;
  };
  return row.id;
}
