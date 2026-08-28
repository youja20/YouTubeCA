import type { DbContext } from '../client.js';

/** YouTube quota는 태평양 표준시 자정에 리셋된다 */
export function quotaDate(now = new Date()): string {
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const y = pacific.getFullYear();
  const m = String(pacific.getMonth() + 1).padStart(2, '0');
  const d = String(pacific.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getQuotaUsed(ctx: DbContext, date = quotaDate()): number {
  const row = ctx.sqlite.prepare('SELECT units_used FROM quota_usage WHERE date = ?').get(date) as
    | { units_used: number }
    | undefined;
  return row?.units_used ?? 0;
}

export function addQuotaUsage(ctx: DbContext, units: number, date = quotaDate()): number {
  const row = ctx.sqlite
    .prepare(
      `INSERT INTO quota_usage(date, units_used) VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET units_used = units_used + excluded.units_used
       RETURNING units_used`,
    )
    .get(date, units) as { units_used: number };
  return row.units_used;
}

export function quotaRemaining(ctx: DbContext, dailyQuota: number): number {
  return Math.max(0, dailyQuota - getQuotaUsed(ctx));
}
