import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { CODE_DEFAULTS } from '@youtubeca/shared';
import { REPO_ROOT } from '@youtubeca/shared/env';
import { Database } from './sqlite.js';

export { Database, Statement, type RunResult } from './sqlite.js';

export interface DbContext {
  /** node:sqlite 핸들(better-sqlite3 호환 래퍼) — 모든 쿼리는 이쪽을 사용 */
  sqlite: Database;
  path: string;
  close(): void;
}

export function resolveDatabasePath(input?: string): string {
  const raw = input ?? process.env.DATABASE_URL ?? CODE_DEFAULTS.databaseUrl;
  if (raw === ':memory:') return raw;
  return isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
}

export function openDatabase(input?: string): DbContext {
  const path = resolveDatabasePath(input);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('temp_store = MEMORY');
  sqlite.pragma('cache_size = -64000');

  return { sqlite, path, close: () => sqlite.close() };
}

let shared: DbContext | undefined;

/** 프로세스당 하나의 연결을 공유한다 */
export function getDb(input?: string): DbContext {
  if (!shared) shared = openDatabase(input);
  return shared;
}

export function closeDb(): void {
  shared?.close();
  shared = undefined;
}
