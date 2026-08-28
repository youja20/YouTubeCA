import { DEFAULT_SETTINGS, settingsSchema, type SettingKey, type Settings } from '@youtubeca/shared';
import type { DbContext } from '../client.js';

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function deserialize(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** 기본값을 config 테이블에 채운다 (이미 있으면 유지) */
export function seedDefaultSettings(ctx: DbContext): void {
  const stmt = ctx.sqlite.prepare('INSERT OR IGNORE INTO config(key, value) VALUES (?, ?)');
  const tx = ctx.sqlite.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) stmt.run(key, serialize(value));
  });
  tx();
}

/** 코드 기본값 위에 config 테이블 값을 덮어쓴 최종 설정 (부록 A-1) */
export function getSettings(ctx: DbContext): Settings {
  const rows = ctx.sqlite.prepare('SELECT key, value FROM config').all() as {
    key: string;
    value: string;
  }[];
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) merged[row.key] = deserialize(row.value);
  }
  const parsed = settingsSchema.safeParse(merged);
  // 잘못된 값이 저장돼 있어도 서비스는 기본값으로 계속 동작해야 한다
  return parsed.success ? parsed.data : settingsSchema.parse({ ...DEFAULT_SETTINGS });
}

export function updateSettings(ctx: DbContext, patch: Partial<Settings>): Settings {
  const stmt = ctx.sqlite.prepare(
    `INSERT INTO config(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  const tx = ctx.sqlite.transaction(() => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      stmt.run(key, serialize(value));
    }
  });
  tx();
  return getSettings(ctx);
}

export function getSetting<K extends SettingKey>(ctx: DbContext, key: K): Settings[K] {
  return getSettings(ctx)[key];
}

/** config 테이블의 임의 키(설정 스키마 외 내부 상태 보관용) */
export function getRawConfig(ctx: DbContext, key: string): string | null {
  const row = ctx.sqlite.prepare('SELECT value FROM config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setRawConfig(ctx: DbContext, key: string, value: string): void {
  ctx.sqlite
    .prepare(
      `INSERT INTO config(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .run(key, value);
}
