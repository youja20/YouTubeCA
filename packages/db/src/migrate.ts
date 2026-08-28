import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DbContext } from './client.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** 파일명 순으로 .sql 마이그레이션을 1회씩 적용한다 (idempotent) */
export function runMigrations(ctx: DbContext, dir = MIGRATIONS_DIR): MigrationResult {
  const { sqlite } = ctx;
  sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);

  const done = new Set(
    sqlite.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
  );

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = readFileSync(join(dir, file), 'utf8');
    // FTS5 가상 테이블/트리거가 포함되므로 exec로 스크립트 전체를 실행한다
    const tx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO _migrations(name) VALUES (?)').run(file);
    });
    tx();
    applied.push(file);
  }
  return { applied, skipped };
}
