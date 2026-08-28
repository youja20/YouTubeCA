import type { CommentDto } from '@youtubeca/shared';
import type { DbContext } from '../client.js';

interface CommentJoinRow {
  id: string;
  video_id: string;
  video_title: string | null;
  channel_title: string | null;
  author: string | null;
  text_original: string;
  like_count: number;
  reply_count: number;
  published_at: string | null;
  sentiment_score: number | null;
  keyword_id?: number | null;
  keyword_name?: string | null;
}

export function youtubeCommentUrl(videoId: string, commentId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`;
}

const COMMENT_COLUMNS = `
  c.id, c.video_id, v.title AS video_title, v.channel_title, c.author,
  c.text_original, c.like_count, c.reply_count, c.published_at, c.sentiment_score`;

function toDto(row: CommentJoinRow, matchedTags: { id: number; name: string }[] = []): CommentDto {
  return {
    id: row.id,
    videoId: row.video_id,
    videoTitle: row.video_title,
    channelTitle: row.channel_title,
    author: row.author,
    text: row.text_original,
    likeCount: row.like_count,
    replyCount: row.reply_count,
    publishedAt: row.published_at,
    sentimentScore: row.sentiment_score,
    url: youtubeCommentUrl(row.video_id, row.id),
    matchedTags,
    keywordId: row.keyword_id ?? undefined,
    keywordName: row.keyword_name ?? undefined,
  };
}

/** 여러 댓글의 매칭 태그를 한 번에 조회 (N+1 방지) */
function loadMatchedTags(
  ctx: DbContext,
  commentIds: string[],
  keywordId?: number,
): Map<string, { id: number; name: string }[]> {
  const map = new Map<string, { id: number; name: string }[]>();
  if (commentIds.length === 0) return map;
  const placeholders = commentIds.map(() => '?').join(',');
  const args: unknown[] = [...commentIds];
  let keywordClause = '';
  if (keywordId !== undefined) {
    keywordClause = 'AND ct.keyword_id = ?';
    args.push(keywordId);
  }
  const rows = ctx.sqlite
    .prepare(
      `SELECT DISTINCT ct.comment_id, t.id, t.name
         FROM comment_tags ct JOIN tags t ON t.id = ct.tag_id
        WHERE ct.comment_id IN (${placeholders}) ${keywordClause}`,
    )
    .all(...args) as { comment_id: string; id: number; name: string }[];
  for (const row of rows) {
    const list = map.get(row.comment_id) ?? [];
    list.push({ id: row.id, name: row.name });
    map.set(row.comment_id, list);
  }
  return map;
}

export interface ListCommentsParams {
  tagId?: number;
  keywordId?: number;
  sort: 'likes' | 'recent';
  sentiment: 'all' | 'positive' | 'neutral' | 'negative';
  q?: string;
  cursor?: string;
  limit: number;
}

export interface ListCommentsResult {
  comments: CommentDto[];
  nextCursor: string | null;
  total: number;
}

function parseCursor(cursor: string | undefined): { value: string; id: string } | null {
  if (!cursor) return null;
  const idx = cursor.indexOf('|');
  if (idx < 0) return null;
  return { value: cursor.slice(0, idx), id: cursor.slice(idx + 1) };
}

/** 커멘트뷰 목록 (§7.3) — tagId / keywordId 중 최소 하나 필수 */
export function listComments(ctx: DbContext, params: ListCommentsParams): ListCommentsResult {
  const where: string[] = [];
  const args: unknown[] = [];

  // comment_tags 조인 여부 결정
  const needsJoin = params.tagId !== undefined || params.keywordId !== undefined;
  let from = 'FROM comments c JOIN videos v ON v.id = c.video_id';
  if (needsJoin) {
    from = `FROM comment_tags ct
            JOIN comments c ON c.id = ct.comment_id
            JOIN videos v ON v.id = c.video_id`;
    if (params.tagId !== undefined) {
      where.push('ct.tag_id = ?');
      args.push(params.tagId);
    }
    if (params.keywordId !== undefined) {
      where.push('ct.keyword_id = ?');
      args.push(params.keywordId);
    }
  }

  if (params.sentiment === 'positive') where.push('c.sentiment_score >= 0.15');
  else if (params.sentiment === 'negative') where.push('c.sentiment_score <= -0.15');
  else if (params.sentiment === 'neutral')
    where.push('(c.sentiment_score IS NULL OR (c.sentiment_score > -0.15 AND c.sentiment_score < 0.15))');

  if (params.q) {
    where.push('c.text_normalized LIKE ?');
    args.push(`%${params.q}%`);
  }

  const baseWhere = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const distinct = needsJoin && params.tagId === undefined ? 'DISTINCT' : '';

  const totalRow = ctx.sqlite
    .prepare(`SELECT COUNT(${distinct ? 'DISTINCT c.id' : '*'}) AS n ${from} ${baseWhere}`)
    .get(...args) as { n: number };

  // 커서 조건 (정렬 키 + id 복합)
  const cursor = parseCursor(params.cursor);
  const cursorWhere = [...where];
  const cursorArgs = [...args];
  if (cursor) {
    if (params.sort === 'likes') {
      cursorWhere.push('(c.like_count < ? OR (c.like_count = ? AND c.id > ?))');
      cursorArgs.push(Number(cursor.value), Number(cursor.value), cursor.id);
    } else {
      cursorWhere.push(`(COALESCE(c.published_at,'') < ? OR (COALESCE(c.published_at,'') = ? AND c.id > ?))`);
      cursorArgs.push(cursor.value, cursor.value, cursor.id);
    }
  }
  const finalWhere = cursorWhere.length > 0 ? `WHERE ${cursorWhere.join(' AND ')}` : '';
  const orderBy =
    params.sort === 'likes'
      ? 'c.like_count DESC, c.id ASC'
      : `COALESCE(c.published_at,'') DESC, c.id ASC`;

  const selectKeyword = params.tagId !== undefined && params.keywordId === undefined
    ? ', ct.keyword_id AS keyword_id, (SELECT name FROM keywords k WHERE k.id = ct.keyword_id) AS keyword_name'
    : '';

  const rows = ctx.sqlite
    .prepare(
      `SELECT ${distinct} ${COMMENT_COLUMNS} ${selectKeyword}
       ${from} ${finalWhere}
       ORDER BY ${orderBy} LIMIT ?`,
    )
    .all(...cursorArgs, params.limit + 1) as CommentJoinRow[];

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;
  const tagMap = loadMatchedTags(ctx, page.map((r) => r.id), params.keywordId);

  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? `${params.sort === 'likes' ? last.like_count : (last.published_at ?? '')}|${last.id}`
      : null;

  return {
    comments: page.map((row) => toDto(row, tagMap.get(row.id) ?? [])),
    nextCursor,
    total: totalRow.n,
  };
}

/**
 * 키워드뷰 ④ — 태그별 랜덤 5개 (요구사항 6.1.4)
 * 대량 테이블에서 ORDER BY RANDOM()은 느리므로 좋아요 상위 50개 후보에서 무작위 추출한다 (§5.2)
 */
export function sampleCommentsByTag(
  ctx: DbContext,
  keywordId: number,
  tagIds: number[],
  perTag = 5,
  candidatePool = 50,
): Record<number, CommentDto[]> {
  const result: Record<number, CommentDto[]> = {};
  if (tagIds.length === 0) return result;

  const stmt = ctx.sqlite.prepare(
    `SELECT * FROM (
       SELECT ${COMMENT_COLUMNS}
         FROM comment_tags ct
         JOIN comments c ON c.id = ct.comment_id
         JOIN videos v ON v.id = c.video_id
        WHERE ct.tag_id = ? AND ct.keyword_id = ?
        ORDER BY c.like_count DESC
        LIMIT ?
     ) ORDER BY RANDOM() LIMIT ?`,
  );

  for (const tagId of tagIds) {
    const rows = stmt.all(tagId, keywordId, candidatePool, perTag) as CommentJoinRow[];
    const tagMap = loadMatchedTags(ctx, rows.map((r) => r.id), keywordId);
    result[tagId] = rows.map((row) => toDto(row, tagMap.get(row.id) ?? []));
  }
  return result;
}

/** 태그뷰 ② — 이 태그가 추출된 대표 댓글 (최대 20개, 좋아요 상위) */
export function topCommentsForTag(ctx: DbContext, tagId: number, limit = 20): CommentDto[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT ${COMMENT_COLUMNS}, ct.keyword_id AS keyword_id, k.name AS keyword_name
         FROM comment_tags ct
         JOIN comments c ON c.id = ct.comment_id
         JOIN videos v ON v.id = c.video_id
         JOIN keywords k ON k.id = ct.keyword_id
        WHERE ct.tag_id = ?
        ORDER BY c.like_count DESC, c.id ASC
        LIMIT ?`,
    )
    .all(tagId, limit) as CommentJoinRow[];
  const tagMap = loadMatchedTags(ctx, rows.map((r) => r.id));
  return rows.map((row) => toDto(row, tagMap.get(row.id) ?? []));
}
