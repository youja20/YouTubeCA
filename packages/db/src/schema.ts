import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/* ─────────────────────────── 키워드 ─────────────────────────── */

export const keywords = sqliteTable(
  'keywords',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    note: text('note'),
    isActive: integer('is_active').notNull().default(1),
    lastCrawledAt: text('last_crawled_at'),
    commentCount: integer('comment_count').notNull().default(0),
    videoCount: integer('video_count').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({ nameUnique: uniqueIndex('idx_keywords_name').on(t.name) }),
);

/* ─────────────────────────── 영상 ─────────────────────────── */

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(), // YouTube videoId
  title: text('title'),
  channelId: text('channel_id'),
  channelTitle: text('channel_title'),
  publishedAt: text('published_at'),
  viewCount: integer('view_count').notNull().default(0),
  likeCount: integer('like_count').notNull().default(0),
  commentCount: integer('comment_count').notNull().default(0),
  thumbnailUrl: text('thumbnail_url'),
  videoScore: real('video_score'),
  commentsDisabled: integer('comments_disabled').notNull().default(0),
  lastCollectedAt: text('last_collected_at'),
  fetchedAt: text('fetched_at').notNull().default(now),
});

export const keywordVideos = sqliteTable(
  'keyword_videos',
  {
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    rank: integer('rank').notNull().default(0),
    score: real('score'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.keywordId, t.videoId] }),
    byVideo: index('idx_kv_video').on(t.videoId),
  }),
);

/* ─────────────────────────── 댓글 ─────────────────────────── */

export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(), // YouTube commentId
    videoId: text('video_id')
      .notNull()
      .references(() => videos.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    author: text('author'),
    authorChannelId: text('author_channel_id'),
    textOriginal: text('text_original').notNull(),
    textNormalized: text('text_normalized'),
    likeCount: integer('like_count').notNull().default(0),
    replyCount: integer('reply_count').notNull().default(0),
    publishedAt: text('published_at'),
    updatedAtSource: text('updated_at_source'),
    lang: text('lang'),
    sentimentScore: real('sentiment_score'),
    collectedAt: text('collected_at').notNull().default(now),
  },
  (t) => ({
    byVideo: index('idx_comments_video').on(t.videoId),
    byLikes: index('idx_comments_likes').on(t.likeCount),
  }),
);

/* ─────────────────────────── 태그 ─────────────────────────── */

export const tags = sqliteTable(
  'tags',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull(),
    category: text('category'),
    polarity: real('polarity'),
    totalCommentCount: integer('total_comment_count').notNull().default(0),
    keywordCount: integer('keyword_count').notNull().default(0),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({ nameUnique: uniqueIndex('idx_tags_name').on(t.name) }),
);

export const tagAliases = sqliteTable(
  'tag_aliases',
  {
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    matchKey: text('match_key').notNull(),
  },
  (t) => ({
    aliasUnique: uniqueIndex('idx_tag_aliases_key').on(t.matchKey),
    byTag: index('idx_tag_aliases_tag').on(t.tagId),
  }),
);

/* ─────────────────────────── 키워드 × 태그 (강도) ─────────────────────────── */

export const keywordTags = sqliteTable(
  'keyword_tags',
  {
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    strength: integer('strength').notNull().default(0),
    rawScore: real('raw_score').notNull().default(0),
    polarity: real('polarity').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    freq: real('freq').notNull().default(0),
    distinctScore: real('distinct_score').notNull().default(0),
    engage: real('engage').notNull().default(0),
    intensity: real('intensity').notNull().default(0),
    runId: integer('run_id'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.keywordId, t.tagId] }),
    byTagRaw: index('idx_kt_tag_raw').on(t.tagId, t.rawScore),
    byKeywordStrength: index('idx_kt_keyword_strength').on(t.keywordId, t.strength),
  }),
);

/* ─────────────────────────── 댓글 × 태그 ─────────────────────────── */

export const commentTags = sqliteTable(
  'comment_tags',
  {
    commentId: text('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    weight: real('weight').notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.commentId, t.tagId, t.keywordId] }),
    byTagKeyword: index('idx_ct_tag_kw').on(t.tagId, t.keywordId),
    byKeyword: index('idx_ct_keyword').on(t.keywordId),
  }),
);

/* ─────────────────────────── 관련 키워드 ─────────────────────────── */

export const keywordRelations = sqliteTable(
  'keyword_relations',
  {
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    relatedKeywordId: integer('related_keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    similarity: real('similarity').notNull(),
    sharedTags: text('shared_tags').notNull().default('[]'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({ pk: primaryKey({ columns: [t.keywordId, t.relatedKeywordId] }) }),
);

/* ─────────────────────────── AI 분석 ─────────────────────────── */

export const keywordAnalyses = sqliteTable(
  'keyword_analyses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    keywordId: integer('keyword_id')
      .notNull()
      .references(() => keywords.id, { onDelete: 'cascade' }),
    runId: integer('run_id'),
    model: text('model').notNull(),
    payload: text('payload').notNull(),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({ byKeyword: index('idx_analyses_keyword').on(t.keywordId, t.createdAt) }),
);

/* ─────────────────────────── 실행 관리 ─────────────────────────── */

export const runs = sqliteTable('runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  trigger: text('trigger').notNull().default('manual'),
  status: text('status').notNull().default('queued'),
  keywordIds: text('keyword_ids').notNull().default('[]'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  error: text('error'),
  cancelRequested: integer('cancel_requested').notNull().default(0),
  createdAt: text('created_at').notNull().default(now),
});

export const runStages = sqliteTable(
  'run_stages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    keywordId: integer('keyword_id'),
    stage: text('stage').notNull(),
    status: text('status').notNull().default('pending'),
    progress: integer('progress').notNull().default(0),
    message: text('message'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
  },
  (t) => ({
    byRun: index('idx_run_stages_run').on(t.runId),
    unique: uniqueIndex('idx_run_stages_unique').on(t.runId, t.keywordId, t.stage),
  }),
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id').references(() => runs.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: text('payload').notNull().default('{}'),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    lockedAt: text('locked_at'),
    lockedBy: text('locked_by'),
    availableAt: text('available_at').notNull().default(now),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({ byStatus: index('idx_jobs_status').on(t.status, t.availableAt) }),
);

export const runLogs = sqliteTable(
  'run_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    runId: integer('run_id'),
    keywordId: integer('keyword_id'),
    stage: text('stage'),
    level: text('level').notNull().default('info'),
    message: text('message').notNull(),
    meta: text('meta'),
    ts: text('ts').notNull().default(now),
  },
  (t) => ({
    byRun: index('idx_run_logs_run').on(t.runId, t.id),
    byTs: index('idx_run_logs_ts').on(t.id),
  }),
);

export const quotaUsage = sqliteTable('quota_usage', {
  date: text('date').primaryKey(),
  unitsUsed: integer('units_used').notNull().default(0),
});

export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

/** 데몬 하트비트 (헬스체크용) */
export const daemonState = sqliteTable('daemon_state', {
  id: integer('id').primaryKey(),
  lastSeenAt: text('last_seen_at'),
  currentJobId: integer('current_job_id'),
  version: text('version'),
});

export type KeywordRow = typeof keywords.$inferSelect;
export type VideoRow = typeof videos.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type KeywordTagRow = typeof keywordTags.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
