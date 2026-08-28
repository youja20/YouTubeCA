import pino from 'pino';
import { insertLog, type DbContext } from '@youtubeca/db';
import type { LogLevel, Stage } from '@youtubeca/shared';

export interface LogScope {
  runId?: number | null;
  keywordId?: number | null;
  stage?: Stage | null;
}

const base = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
});

/** stdout(JSON) + run_logs 테이블 미러링 (§3.2) */
export class Logger {
  constructor(
    private readonly db: DbContext,
    private readonly scope: LogScope = {},
  ) {}

  child(scope: LogScope): Logger {
    return new Logger(this.db, { ...this.scope, ...scope });
  }

  private write(level: LogLevel, message: string, meta?: unknown): void {
    base[level]({ ...this.scope, meta }, message);
    // DB 미러링 실패가 파이프라인을 죽이지 않도록 보호한다
    try {
      insertLog(this.db, {
        runId: this.scope.runId ?? null,
        keywordId: this.scope.keywordId ?? null,
        stage: this.scope.stage ?? null,
        level,
        message,
        meta,
      });
    } catch (error) {
      base.error({ err: error }, 'run_logs 기록 실패');
    }
  }

  debug(message: string, meta?: unknown): void {
    this.write('debug', message, meta);
  }
  info(message: string, meta?: unknown): void {
    this.write('info', message, meta);
  }
  warn(message: string, meta?: unknown): void {
    this.write('warn', message, meta);
  }
  error(message: string, meta?: unknown): void {
    this.write('error', message, meta);
  }
}

export const rawLogger = base;
