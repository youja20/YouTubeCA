import { matchKey } from '@youtubeca/shared';
import type { TagSummary, TagViewResponse } from '@youtubeca/shared';
import type { DbContext } from '../client.js';

interface TagRowRaw {
  id: number;
  name: string;
  category: string | null;
  polarity: number | null;
  total_comment_count: number;
  keyword_count: number;
}

function toSummary(row: TagRowRaw): TagSummary {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    polarity: row.polarity,
    totalCommentCount: row.total_comment_count,
    keywordCount: row.keyword_count,
  };
}

export function listTags(ctx: DbContext, params: { q?: string; limit: number }): TagSummary[] {
  const where = params.q ? 'WHERE name LIKE ?' : '';
  const args: unknown[] = params.q ? [`%${params.q}%`] : [];
  const rows = ctx.sqlite
    .prepare(
      `SELECT * FROM tags ${where}
        ORDER BY total_comment_count DESC, keyword_count DESC, name ASC LIMIT ?`,
    )
    .all(...args, params.limit) as TagRowRaw[];
  return rows.map(toSummary);
}

export function getTag(ctx: DbContext, id: number): TagSummary | null {
  const row = ctx.sqlite.prepare('SELECT * FROM tags WHERE id = ?').get(id) as TagRowRaw | undefined;
  return row ? toSummary(row) : null;
}

/** 태그뷰 ① — 이 태그가 나타난 키워드 (raw_score DESC) */
export function keywordsForTag(ctx: DbContext, tagId: number, limit = 20): TagViewResponse['keywords'] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT kt.keyword_id, k.name, kt.strength, kt.raw_score, kt.polarity, kt.comment_count
         FROM keyword_tags kt JOIN keywords k ON k.id = kt.keyword_id
        WHERE kt.tag_id = ?
        ORDER BY kt.raw_score DESC
        LIMIT ?`,
    )
    .all(tagId, limit) as {
    keyword_id: number;
    name: string;
    strength: number;
    raw_score: number;
    polarity: number;
    comment_count: number;
  }[];
  return rows.map((r) => ({
    keywordId: r.keyword_id,
    name: r.name,
    strength: r.strength,
    rawScore: r.raw_score,
    polarity: r.polarity,
    commentCount: r.comment_count,
  }));
}

export interface UpsertTagInput {
  name: string;
  category?: string | null;
  polarity?: number | null;
  aliases?: string[];
}

/** 태그 사전 upsert — 별칭까지 함께 등록 (§4.2 3-2) */
export function upsertTag(ctx: DbContext, input: UpsertTagInput): number {
  const existing = ctx.sqlite.prepare('SELECT id FROM tags WHERE name = ?').get(input.name) as
    | { id: number }
    | undefined;

  let tagId: number;
  if (existing) {
    tagId = existing.id;
    ctx.sqlite
      .prepare(
        `UPDATE tags SET category = COALESCE(?, category),
           polarity = CASE WHEN ? IS NULL THEN polarity
                           WHEN polarity IS NULL THEN ?
                           ELSE (polarity + ?) / 2 END
         WHERE id = ?`,
      )
      .run(input.category ?? null, input.polarity ?? null, input.polarity ?? null, input.polarity ?? null, tagId);
  } else {
    const row = ctx.sqlite
      .prepare('INSERT INTO tags(name, category, polarity) VALUES (?, ?, ?) RETURNING id')
      .get(input.name, input.category ?? null, input.polarity ?? null) as { id: number };
    tagId = row.id;
  }

  const aliasStmt = ctx.sqlite.prepare(
    'INSERT OR IGNORE INTO tag_aliases(tag_id, alias, match_key) VALUES (?, ?, ?)',
  );
  aliasStmt.run(tagId, input.name, matchKey(input.name));
  for (const alias of input.aliases ?? []) {
    if (!alias.trim()) continue;
    aliasStmt.run(tagId, alias, matchKey(alias));
  }
  return tagId;
}

export interface AliasEntry {
  tagId: number;
  alias: string;
  matchKey: string;
}

export function loadAliases(ctx: DbContext): AliasEntry[] {
  const rows = ctx.sqlite.prepare('SELECT tag_id, alias, match_key FROM tag_aliases').all() as {
    tag_id: number;
    alias: string;
    match_key: string;
  }[];
  return rows.map((r) => ({ tagId: r.tag_id, alias: r.alias, matchKey: r.match_key }));
}

/** 전역 태그 통계 재계산 */
export function refreshTagCounters(ctx: DbContext, tagIds?: number[]): void {
  const filter = tagIds && tagIds.length > 0 ? `WHERE id IN (${tagIds.map(() => '?').join(',')})` : '';
  const args = tagIds && tagIds.length > 0 ? tagIds : [];
  ctx.sqlite
    .prepare(
      `UPDATE tags SET
         total_comment_count = (SELECT COUNT(DISTINCT comment_id) FROM comment_tags WHERE tag_id = tags.id),
         keyword_count = (SELECT COUNT(*) FROM keyword_tags WHERE tag_id = tags.id),
         polarity = COALESCE((SELECT AVG(polarity) FROM keyword_tags WHERE tag_id = tags.id), polarity)
       ${filter}`,
    )
    .run(...args);
}

/** 어떤 키워드에도 연결되지 않은 태그 정리 */
export function pruneOrphanTags(ctx: DbContext): number {
  const info = ctx.sqlite
    .prepare(
      `DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM keyword_tags)
         AND id NOT IN (SELECT DISTINCT tag_id FROM comment_tags)`,
    )
    .run();
  return info.changes;
}
