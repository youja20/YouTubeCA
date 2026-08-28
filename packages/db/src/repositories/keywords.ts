import type {
  Keyword,
  KeywordAnalysis,
  KeywordStats,
  KeywordTag,
  RelatedKeyword,
} from '@youtubeca/shared';
import { analysisPayloadSchema } from '@youtubeca/shared';
import type { DbContext } from '../client.js';

interface KeywordRowRaw {
  id: number;
  name: string;
  note: string | null;
  is_active: number;
  last_crawled_at: string | null;
  comment_count: number;
  video_count: number;
  created_at: string;
  updated_at: string;
}

function toKeyword(row: KeywordRowRaw): Keyword {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    isActive: row.is_active === 1,
    lastCrawledAt: row.last_crawled_at,
    commentCount: row.comment_count,
    videoCount: row.video_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listKeywords(
  ctx: DbContext,
  params: { q?: string; sort: 'name' | 'comments' | 'updated'; activeOnly?: boolean },
): Keyword[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.q) {
    where.push('name LIKE ?');
    args.push(`%${params.q}%`);
  }
  if (params.activeOnly) where.push('is_active = 1');
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const order =
    params.sort === 'name'
      ? 'name COLLATE NOCASE ASC'
      : params.sort === 'comments'
        ? 'comment_count DESC, name ASC'
        : 'updated_at DESC, id DESC';
  const rows = ctx.sqlite.prepare(`SELECT * FROM keywords ${clause} ORDER BY ${order}`).all(...args) as KeywordRowRaw[];
  return rows.map(toKeyword);
}

export function getKeyword(ctx: DbContext, id: number): Keyword | null {
  const row = ctx.sqlite.prepare('SELECT * FROM keywords WHERE id = ?').get(id) as KeywordRowRaw | undefined;
  return row ? toKeyword(row) : null;
}

export function getKeywordByName(ctx: DbContext, name: string): Keyword | null {
  const row = ctx.sqlite.prepare('SELECT * FROM keywords WHERE name = ?').get(name) as KeywordRowRaw | undefined;
  return row ? toKeyword(row) : null;
}

export function createKeyword(ctx: DbContext, input: { name: string; note?: string }): Keyword {
  const row = ctx.sqlite
    .prepare('INSERT INTO keywords(name, note) VALUES (?, ?) RETURNING *')
    .get(input.name, input.note ?? null) as KeywordRowRaw;
  return toKeyword(row);
}

export function updateKeyword(
  ctx: DbContext,
  id: number,
  patch: { name?: string; note?: string | null; isActive?: boolean },
): Keyword | null {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    args.push(patch.name);
  }
  if (patch.note !== undefined) {
    sets.push('note = ?');
    args.push(patch.note);
  }
  if (patch.isActive !== undefined) {
    sets.push('is_active = ?');
    args.push(patch.isActive ? 1 : 0);
  }
  if (sets.length === 0) return getKeyword(ctx, id);
  sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  const row = ctx.sqlite
    .prepare(`UPDATE keywords SET ${sets.join(', ')} WHERE id = ? RETURNING *`)
    .get(...args, id) as KeywordRowRaw | undefined;
  return row ? toKeyword(row) : null;
}

/** 분석 데이터는 cascade 삭제, 댓글·영상 원본은 보존 (§6) */
export function deleteKeyword(ctx: DbContext, id: number): boolean {
  const info = ctx.sqlite.prepare('DELETE FROM keywords WHERE id = ?').run(id);
  return info.changes > 0;
}

/** 수집 결과를 키워드 요약 컬럼에 반영 */
export function refreshKeywordCounters(ctx: DbContext, keywordId: number): void {
  ctx.sqlite
    .prepare(
      `UPDATE keywords SET
         video_count = (SELECT COUNT(*) FROM keyword_videos WHERE keyword_id = ?),
         comment_count = (
           SELECT COUNT(*) FROM comments c
             JOIN keyword_videos kv ON kv.video_id = c.video_id
            WHERE kv.keyword_id = ?
         ),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
    )
    .run(keywordId, keywordId, keywordId);
}

export function markCrawled(ctx: DbContext, keywordId: number): void {
  ctx.sqlite
    .prepare(
      `UPDATE keywords SET last_crawled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
    .run(keywordId);
}

/* ─────────────────────────── 집계 ─────────────────────────── */

export function getKeywordStats(ctx: DbContext, keywordId: number): KeywordStats {
  const row = ctx.sqlite
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM keyword_videos WHERE keyword_id = @id) AS video_count,
         (SELECT COUNT(*) FROM keyword_tags WHERE keyword_id = @id) AS tag_count,
         (SELECT last_crawled_at FROM keywords WHERE id = @id) AS last_crawled_at`,
    )
    .get({ id: keywordId }) as { video_count: number; tag_count: number; last_crawled_at: string | null };

  const sentiment = ctx.sqlite
    .prepare(
      `SELECT COUNT(*) AS n,
              AVG(c.sentiment_score) AS avg_score,
              SUM(CASE WHEN c.sentiment_score >= 0.15 THEN 1 ELSE 0 END) AS pos,
              SUM(CASE WHEN c.sentiment_score <= -0.15 THEN 1 ELSE 0 END) AS neg
         FROM comments c
         JOIN keyword_videos kv ON kv.video_id = c.video_id
        WHERE kv.keyword_id = ?`,
    )
    .get(keywordId) as { n: number; avg_score: number | null; pos: number | null; neg: number | null };

  const total = sentiment.n ?? 0;
  const positive = sentiment.pos ?? 0;
  const negative = sentiment.neg ?? 0;
  return {
    commentCount: total,
    videoCount: row.video_count,
    tagCount: row.tag_count,
    avgSentiment: sentiment.avg_score === null ? null : Number(sentiment.avg_score.toFixed(4)),
    sentimentBreakdown: { positive, negative, neutral: Math.max(0, total - positive - negative) },
    lastCrawledAt: row.last_crawled_at,
  };
}

export function getKeywordTags(ctx: DbContext, keywordId: number, limit = 30): KeywordTag[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT kt.tag_id, t.name, t.category, kt.strength, kt.raw_score, kt.polarity,
              kt.comment_count, kt.freq, kt.distinct_score, kt.engage, kt.intensity
         FROM keyword_tags kt JOIN tags t ON t.id = kt.tag_id
        WHERE kt.keyword_id = ?
        ORDER BY kt.strength DESC, kt.raw_score DESC
        LIMIT ?`,
    )
    .all(keywordId, limit) as {
    tag_id: number;
    name: string;
    category: string | null;
    strength: number;
    raw_score: number;
    polarity: number;
    comment_count: number;
    freq: number;
    distinct_score: number;
    engage: number;
    intensity: number;
  }[];

  return rows.map((r) => ({
    tagId: r.tag_id,
    name: r.name,
    category: r.category,
    strength: r.strength,
    rawScore: r.raw_score,
    polarity: r.polarity,
    commentCount: r.comment_count,
    parts: { freq: r.freq, distinct: r.distinct_score, engage: r.engage, intensity: r.intensity },
  }));
}

export function getLatestAnalysis(ctx: DbContext, keywordId: number): KeywordAnalysis | null {
  const row = ctx.sqlite
    .prepare(
      `SELECT id, run_id, model, payload, created_at FROM keyword_analyses
        WHERE keyword_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(keywordId) as
    | { id: number; run_id: number | null; model: string; payload: string; created_at: string }
    | undefined;
  if (!row) return null;
  const parsed = analysisPayloadSchema.safeParse(JSON.parse(row.payload));
  if (!parsed.success) return null;
  return {
    id: row.id,
    runId: row.run_id,
    model: row.model,
    payload: parsed.data,
    createdAt: row.created_at,
  };
}

export function saveAnalysis(
  ctx: DbContext,
  input: {
    keywordId: number;
    runId: number | null;
    model: string;
    payload: unknown;
    promptTokens?: number;
    completionTokens?: number;
  },
): number {
  const row = ctx.sqlite
    .prepare(
      `INSERT INTO keyword_analyses(keyword_id, run_id, model, payload, prompt_tokens, completion_tokens)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get(
      input.keywordId,
      input.runId,
      input.model,
      JSON.stringify(input.payload),
      input.promptTokens ?? null,
      input.completionTokens ?? null,
    ) as { id: number };
  return row.id;
}

export function getRelatedKeywords(ctx: DbContext, keywordId: number): RelatedKeyword[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT kr.related_keyword_id, k.name, kr.similarity, kr.shared_tags
         FROM keyword_relations kr JOIN keywords k ON k.id = kr.related_keyword_id
        WHERE kr.keyword_id = ?
        ORDER BY kr.similarity DESC`,
    )
    .all(keywordId) as {
    related_keyword_id: number;
    name: string;
    similarity: number;
    shared_tags: string;
  }[];

  return rows.map((r) => {
    let sharedTags: RelatedKeyword['sharedTags'] = [];
    try {
      sharedTags = JSON.parse(r.shared_tags) as RelatedKeyword['sharedTags'];
    } catch {
      sharedTags = [];
    }
    return {
      keywordId: r.related_keyword_id,
      name: r.name,
      similarity: r.similarity,
      sharedTags,
    };
  });
}

export function countKeywords(ctx: DbContext): number {
  const row = ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM keywords').get() as { n: number };
  return row.n;
}

/* ─────────────────────────── 기본 키워드 시드 ─────────────────────────── */

const SEED_MARKER = 'seed.defaultKeywordsAt';

export interface SeedKeywordsResult {
  applied: boolean;
  created: Keyword[];
  skipped: string[];
}

/**
 * 최초 1회만 기본 키워드를 등록한다 (§7.4 ①).
 *
 * config에 마커를 남겨 두 번 다시 실행되지 않게 한다. 매 기동마다 upsert하면
 * 사용자가 의도적으로 지운 키워드가 계속 되살아나기 때문이다.
 * 크롤링은 걸지 않는다 — quota 소모가 크므로 실행 시점은 사용자가 정한다.
 */
export function seedDefaultKeywords(
  ctx: DbContext,
  names: readonly string[],
  options: { force?: boolean } = {},
): SeedKeywordsResult {
  const marker = ctx.sqlite.prepare('SELECT value FROM config WHERE key = ?').get(SEED_MARKER) as
    | { value: string }
    | undefined;
  if (marker && !options.force) return { applied: false, created: [], skipped: [...names] };

  const created: Keyword[] = [];
  const skipped: string[] = [];

  const tx = ctx.sqlite.transaction(() => {
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      if (getKeywordByName(ctx, name)) {
        skipped.push(name);
        continue;
      }
      created.push(createKeyword(ctx, { name }));
    }
    ctx.sqlite
      .prepare(
        `INSERT INTO config(key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run(SEED_MARKER, JSON.stringify(new Date().toISOString()));
  });
  tx();

  return { applied: true, created, skipped };
}
