import type { DbContext } from '../client.js';

/* ─────────────────────────── 영상 ─────────────────────────── */

export interface VideoUpsert {
  id: string;
  title: string | null;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  thumbnailUrl: string | null;
  videoScore?: number | null;
  commentsDisabled?: boolean;
}

export function upsertVideos(ctx: DbContext, videos: VideoUpsert[]): void {
  if (videos.length === 0) return;
  const stmt = ctx.sqlite.prepare(
    `INSERT INTO videos(id, title, channel_id, channel_title, published_at, view_count,
       like_count, comment_count, thumbnail_url, video_score, comments_disabled, fetched_at)
     VALUES (@id, @title, @channelId, @channelTitle, @publishedAt, @viewCount,
       @likeCount, @commentCount, @thumbnailUrl, @videoScore, @commentsDisabled,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, channel_title = excluded.channel_title,
       view_count = excluded.view_count, like_count = excluded.like_count,
       comment_count = excluded.comment_count, thumbnail_url = excluded.thumbnail_url,
       video_score = COALESCE(excluded.video_score, videos.video_score),
       comments_disabled = excluded.comments_disabled,
       fetched_at = excluded.fetched_at`,
  );
  const tx = ctx.sqlite.transaction((rows: VideoUpsert[]) => {
    for (const v of rows) {
      stmt.run({
        ...v,
        videoScore: v.videoScore ?? null,
        commentsDisabled: v.commentsDisabled ? 1 : 0,
      });
    }
  });
  tx(videos);
}

export function linkKeywordVideos(
  ctx: DbContext,
  keywordId: number,
  links: { videoId: string; rank: number; score: number }[],
): void {
  const stmt = ctx.sqlite.prepare(
    `INSERT INTO keyword_videos(keyword_id, video_id, rank, score) VALUES (?, ?, ?, ?)
     ON CONFLICT(keyword_id, video_id) DO UPDATE SET rank = excluded.rank, score = excluded.score`,
  );
  const tx = ctx.sqlite.transaction(() => {
    for (const link of links) stmt.run(keywordId, link.videoId, link.rank, link.score);
  });
  tx();
}

export function markCommentsCollected(ctx: DbContext, videoId: string): void {
  ctx.sqlite
    .prepare(`UPDATE videos SET last_collected_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .run(videoId);
}

export function getVideoCollectionState(
  ctx: DbContext,
  videoId: string,
): { lastCollectedAt: string | null; storedComments: number } {
  const row = ctx.sqlite
    .prepare(
      `SELECT v.last_collected_at,
              (SELECT COUNT(*) FROM comments c WHERE c.video_id = v.id) AS stored
         FROM videos v WHERE v.id = ?`,
    )
    .get(videoId) as { last_collected_at: string | null; stored: number } | undefined;
  return { lastCollectedAt: row?.last_collected_at ?? null, storedComments: row?.stored ?? 0 };
}

export function keywordVideoIds(ctx: DbContext, keywordId: number): string[] {
  const rows = ctx.sqlite
    .prepare('SELECT video_id FROM keyword_videos WHERE keyword_id = ? ORDER BY rank')
    .all(keywordId) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}

/* ─────────────────────────── 댓글 ─────────────────────────── */

export interface CommentUpsert {
  id: string;
  videoId: string;
  parentId: string | null;
  author: string | null;
  authorChannelId: string | null;
  textOriginal: string;
  textNormalized: string;
  likeCount: number;
  replyCount: number;
  publishedAt: string | null;
  updatedAtSource: string | null;
  lang: string | null;
  sentimentScore: number | null;
}

/** 1000행 단위 배치 트랜잭션 (§5.2) */
export function upsertComments(ctx: DbContext, rows: CommentUpsert[], batchSize = 1000): number {
  if (rows.length === 0) return 0;
  const stmt = ctx.sqlite.prepare(
    `INSERT INTO comments(id, video_id, parent_id, author, author_channel_id, text_original,
       text_normalized, like_count, reply_count, published_at, updated_at_source, lang, sentiment_score)
     VALUES (@id, @videoId, @parentId, @author, @authorChannelId, @textOriginal,
       @textNormalized, @likeCount, @replyCount, @publishedAt, @updatedAtSource, @lang, @sentimentScore)
     ON CONFLICT(id) DO UPDATE SET
       text_original = excluded.text_original,
       text_normalized = excluded.text_normalized,
       like_count = excluded.like_count,
       reply_count = excluded.reply_count,
       sentiment_score = excluded.sentiment_score`,
  );
  const tx = ctx.sqlite.transaction((batch: CommentUpsert[]) => {
    for (const row of batch) stmt.run(row);
  });
  for (let i = 0; i < rows.length; i += batchSize) tx(rows.slice(i, i + batchSize));
  return rows.length;
}

export interface CorpusComment {
  id: string;
  text: string;
  likeCount: number;
  sentimentScore: number | null;
}

/** 태그 추출·강도 산출용 코퍼스 로드 */
export function loadKeywordCorpus(ctx: DbContext, keywordId: number): CorpusComment[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT DISTINCT c.id, c.text_normalized, c.like_count, c.sentiment_score
         FROM comments c
         JOIN keyword_videos kv ON kv.video_id = c.video_id
        WHERE kv.keyword_id = ? AND c.text_normalized IS NOT NULL AND length(c.text_normalized) > 1`,
    )
    .all(keywordId) as {
    id: string;
    text_normalized: string;
    like_count: number;
    sentiment_score: number | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    text: r.text_normalized,
    likeCount: r.like_count,
    sentimentScore: r.sentiment_score,
  }));
}

/** 영상 채널명·제목 토큰은 태그 후보에서 제외한다 */
export function keywordVideoTitles(ctx: DbContext, keywordId: number): { title: string; channel: string }[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT COALESCE(v.title,'') AS title, COALESCE(v.channel_title,'') AS channel
         FROM videos v JOIN keyword_videos kv ON kv.video_id = v.id
        WHERE kv.keyword_id = ?`,
    )
    .all(keywordId) as { title: string; channel: string }[];
  return rows;
}

/* ─────────────────────────── 태그 매핑 ─────────────────────────── */

export interface KeywordTagUpsert {
  tagId: number;
  strength: number;
  rawScore: number;
  polarity: number;
  commentCount: number;
  freq: number;
  distinctScore: number;
  engage: number;
  intensity: number;
}

export function replaceKeywordTags(
  ctx: DbContext,
  keywordId: number,
  runId: number | null,
  rows: KeywordTagUpsert[],
): void {
  const insert = ctx.sqlite.prepare(
    `INSERT INTO keyword_tags(keyword_id, tag_id, strength, raw_score, polarity, comment_count,
       freq, distinct_score, engage, intensity, run_id, updated_at)
     VALUES (@keywordId, @tagId, @strength, @rawScore, @polarity, @commentCount,
       @freq, @distinctScore, @engage, @intensity, @runId, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(keyword_id, tag_id) DO UPDATE SET
       strength = excluded.strength, raw_score = excluded.raw_score, polarity = excluded.polarity,
       comment_count = excluded.comment_count, freq = excluded.freq,
       distinct_score = excluded.distinct_score, engage = excluded.engage,
       intensity = excluded.intensity, run_id = excluded.run_id, updated_at = excluded.updated_at`,
  );
  const tx = ctx.sqlite.transaction(() => {
    ctx.sqlite.prepare('DELETE FROM keyword_tags WHERE keyword_id = ?').run(keywordId);
    for (const row of rows) insert.run({ ...row, keywordId, runId });
  });
  tx();
}

export function replaceCommentTags(
  ctx: DbContext,
  keywordId: number,
  rows: { commentId: string; tagId: number; weight: number }[],
  batchSize = 2000,
): void {
  const insert = ctx.sqlite.prepare(
    `INSERT INTO comment_tags(comment_id, tag_id, keyword_id, weight) VALUES (?, ?, ?, ?)
     ON CONFLICT(comment_id, tag_id, keyword_id) DO UPDATE SET weight = excluded.weight`,
  );
  ctx.sqlite.prepare('DELETE FROM comment_tags WHERE keyword_id = ?').run(keywordId);
  const tx = ctx.sqlite.transaction((batch: typeof rows) => {
    for (const row of batch) insert.run(row.commentId, row.tagId, keywordId, row.weight);
  });
  for (let i = 0; i < rows.length; i += batchSize) tx(rows.slice(i, i + batchSize));
}

/* ─────────────────────────── 관련 키워드 ─────────────────────────── */

export interface TagVectorRow {
  keywordId: number;
  tagId: number;
  rawScore: number;
}

export function loadAllTagVectors(ctx: DbContext): TagVectorRow[] {
  const rows = ctx.sqlite
    .prepare('SELECT keyword_id, tag_id, raw_score FROM keyword_tags')
    .all() as { keyword_id: number; tag_id: number; raw_score: number }[];
  return rows.map((r) => ({ keywordId: r.keyword_id, tagId: r.tag_id, rawScore: r.raw_score }));
}

export function replaceKeywordRelations(
  ctx: DbContext,
  rows: { keywordId: number; relatedKeywordId: number; similarity: number; sharedTags: unknown }[],
): void {
  const insert = ctx.sqlite.prepare(
    `INSERT INTO keyword_relations(keyword_id, related_keyword_id, similarity, shared_tags, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(keyword_id, related_keyword_id) DO UPDATE SET
       similarity = excluded.similarity, shared_tags = excluded.shared_tags,
       updated_at = excluded.updated_at`,
  );
  const tx = ctx.sqlite.transaction(() => {
    ctx.sqlite.prepare('DELETE FROM keyword_relations').run();
    for (const row of rows) {
      insert.run(row.keywordId, row.relatedKeywordId, row.similarity, JSON.stringify(row.sharedTags));
    }
  });
  tx();
}

/** IDF 계산용: 키워드별 태그 등장 문서 수 */
export function tagDocumentFrequency(ctx: DbContext, excludeKeywordId?: number): Map<number, number> {
  const rows = (
    excludeKeywordId === undefined
      ? ctx.sqlite
          .prepare('SELECT tag_id, COUNT(DISTINCT keyword_id) AS df FROM keyword_tags GROUP BY tag_id')
          .all()
      : ctx.sqlite
          .prepare(
            `SELECT tag_id, COUNT(DISTINCT keyword_id) AS df FROM keyword_tags
              WHERE keyword_id != ? GROUP BY tag_id`,
          )
          .all(excludeKeywordId)
  ) as { tag_id: number; df: number }[];
  return new Map(rows.map((r) => [r.tag_id, r.df]));
}

export function countComments(ctx: DbContext): number {
  const row = ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM comments').get() as { n: number };
  return row.n;
}

/* ─────────────────────────── term 통계 (IDF용) ─────────────────────────── */

export interface KeywordTermRow {
  term: string;
  commentCount: number;
  tf: number;
  score: number;
}

/** 이 키워드를 제외한 다른 키워드들의 term 문서빈도 */
export function termDocumentFrequency(ctx: DbContext, excludeKeywordId: number): Map<string, number> {
  const rows = ctx.sqlite
    .prepare(
      `SELECT term, COUNT(DISTINCT keyword_id) AS df FROM keyword_terms
        WHERE keyword_id != ? GROUP BY term`,
    )
    .all(excludeKeywordId) as { term: string; df: number }[];
  return new Map(rows.map((r) => [r.term, r.df]));
}

export function replaceKeywordTerms(ctx: DbContext, keywordId: number, rows: KeywordTermRow[]): void {
  const insert = ctx.sqlite.prepare(
    `INSERT INTO keyword_terms(keyword_id, term, comment_count, tf, score)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(keyword_id, term) DO UPDATE SET
       comment_count = excluded.comment_count, tf = excluded.tf, score = excluded.score,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  );
  const tx = ctx.sqlite.transaction(() => {
    ctx.sqlite.prepare('DELETE FROM keyword_terms WHERE keyword_id = ?').run(keywordId);
    for (const row of rows) insert.run(keywordId, row.term, row.commentCount, row.tf, row.score);
  });
  tx();
}

/** 강도 산출용 태그별 집계 (§4.3) */
export interface TagAggregate {
  tagId: number;
  commentCount: number;
  likeSum: number;
  sentimentSum: number;
  absSentimentSum: number;
  sentimentCount: number;
}

export function aggregateTagStats(ctx: DbContext, keywordId: number): TagAggregate[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT ct.tag_id,
              COUNT(DISTINCT c.id) AS comment_count,
              COALESCE(SUM(c.like_count), 0) AS like_sum,
              COALESCE(SUM(c.sentiment_score), 0) AS sentiment_sum,
              COALESCE(SUM(ABS(c.sentiment_score)), 0) AS abs_sentiment_sum,
              SUM(CASE WHEN c.sentiment_score IS NOT NULL THEN 1 ELSE 0 END) AS sentiment_count
         FROM comment_tags ct JOIN comments c ON c.id = ct.comment_id
        WHERE ct.keyword_id = ?
        GROUP BY ct.tag_id`,
    )
    .all(keywordId) as {
    tag_id: number;
    comment_count: number;
    like_sum: number;
    sentiment_sum: number;
    abs_sentiment_sum: number;
    sentiment_count: number;
  }[];
  return rows.map((r) => ({
    tagId: r.tag_id,
    commentCount: r.comment_count,
    likeSum: r.like_sum,
    sentimentSum: r.sentiment_sum,
    absSentimentSum: r.abs_sentiment_sum,
    sentimentCount: r.sentiment_count,
  }));
}

export function countKeywordComments(ctx: DbContext, keywordId: number): number {
  const row = ctx.sqlite
    .prepare(
      `SELECT COUNT(DISTINCT c.id) AS n FROM comments c
         JOIN keyword_videos kv ON kv.video_id = c.video_id
        WHERE kv.keyword_id = ?`,
    )
    .get(keywordId) as { n: number };
  return row.n;
}

/** AI 분석 프롬프트용: 태그별 대표 댓글 (좋아요 상위 + 랜덤 혼합) */
export function analysisSamples(
  ctx: DbContext,
  keywordId: number,
  tagId: number,
  limit: number,
): { text: string; likeCount: number }[] {
  const top = ctx.sqlite
    .prepare(
      `SELECT c.text_original AS text, c.like_count FROM comment_tags ct
         JOIN comments c ON c.id = ct.comment_id
        WHERE ct.keyword_id = ? AND ct.tag_id = ?
        ORDER BY c.like_count DESC LIMIT ?`,
    )
    .all(keywordId, tagId, Math.ceil(limit / 2) + 1) as { text: string; like_count: number }[];

  const random = ctx.sqlite
    .prepare(
      `SELECT * FROM (
         SELECT c.text_original AS text, c.like_count FROM comment_tags ct
           JOIN comments c ON c.id = ct.comment_id
          WHERE ct.keyword_id = ? AND ct.tag_id = ?
          ORDER BY c.like_count DESC LIMIT 200
       ) ORDER BY RANDOM() LIMIT ?`,
    )
    .all(keywordId, tagId, limit) as { text: string; like_count: number }[];

  const seen = new Set<string>();
  const out: { text: string; likeCount: number }[] = [];
  for (const row of [...top, ...random]) {
    if (out.length >= limit) break;
    if (seen.has(row.text)) continue;
    seen.add(row.text);
    out.push({ text: row.text, likeCount: row.like_count });
  }
  return out;
}
