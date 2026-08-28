import type { AnalysisPayload } from './schemas.js';
import type { LogLevel, RunStatus, Stage } from './constants.js';

/* API 공통 응답 포맷 (§6) */
export interface ApiMeta {
  cursor?: string | null;
  total?: number;
  hasMore?: boolean;
  /** 키워드 등록 시 자동으로 큐에 넣은 크롤링 Run (§7.4 ①) */
  runId?: number | null;
}
export interface ApiOk<T> {
  data: T;
  meta?: ApiMeta;
}
export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

/* ─────────────────────────── 도메인 DTO ─────────────────────────── */

export interface Keyword {
  id: number;
  name: string;
  note: string | null;
  isActive: boolean;
  lastCrawledAt: string | null;
  commentCount: number;
  videoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TagSummary {
  id: number;
  name: string;
  category: string | null;
  polarity: number | null;
  totalCommentCount: number;
  keywordCount: number;
}

/** 키워드뷰 ①: 태그 & 강도 */
export interface KeywordTag {
  tagId: number;
  name: string;
  category: string | null;
  strength: number; // 0~100 (키워드 내 정규화)
  rawScore: number; // 키워드 간 비교용
  polarity: number; // -1 ~ +1
  commentCount: number;
  parts: { freq: number; distinct: number; engage: number; intensity: number };
}

export interface CommentDto {
  id: string;
  videoId: string;
  videoTitle: string | null;
  channelTitle: string | null;
  author: string | null;
  text: string;
  likeCount: number;
  replyCount: number;
  publishedAt: string | null;
  sentimentScore: number | null;
  /** https://www.youtube.com/watch?v={videoId}&lc={commentId} */
  url: string;
  matchedTags: { id: number; name: string }[];
  keywordId?: number;
  keywordName?: string;
}

export interface RelatedKeyword {
  keywordId: number;
  name: string;
  similarity: number;
  /** 상대 키워드에서 더 강하게 나타나는 공유 태그 */
  sharedTags: { tagId: number; name: string; selfRaw: number; otherRaw: number; stronger: 'self' | 'other' }[];
}

export interface KeywordAnalysis {
  id: number;
  runId: number | null;
  model: string;
  payload: AnalysisPayload;
  createdAt: string;
}

export interface KeywordStats {
  commentCount: number;
  videoCount: number;
  tagCount: number;
  avgSentiment: number | null;
  sentimentBreakdown: { positive: number; neutral: number; negative: number };
  lastCrawledAt: string | null;
}

/** GET /keywords/:id — 키워드뷰 집계 응답 (§6) */
export interface KeywordViewResponse {
  keyword: Keyword;
  stats: KeywordStats;
  tags: KeywordTag[];
  analysis: KeywordAnalysis | null;
  related: RelatedKeyword[];
  /** 태그별 랜덤 5개 (요구사항 6.1.4) — key = tagId */
  sampleComments: Record<number, CommentDto[]>;
}

/** GET /tags/:id — 태그뷰 응답 (§6, §7.2) */
export interface TagViewResponse {
  tag: TagSummary;
  keywords: {
    keywordId: number;
    name: string;
    strength: number;
    rawScore: number;
    polarity: number;
    commentCount: number;
  }[];
  topComments: CommentDto[];
}

/* ─────────────────────────── 실행/로그 DTO ─────────────────────────── */

export interface RunStageDto {
  id: number;
  keywordId: number | null;
  keywordName?: string | null;
  stage: Stage;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  progress: number;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RunDto {
  id: number;
  trigger: string;
  status: RunStatus;
  keywordIds: number[];
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
}

export interface RunDetail extends RunDto {
  stages: RunStageDto[];
  keywords: { id: number; name: string }[];
}

export interface LogDto {
  id: number;
  runId: number | null;
  keywordId: number | null;
  stage: string | null;
  level: LogLevel;
  message: string;
  meta: unknown;
  ts: string;
}

export interface HealthResponse {
  ok: boolean;
  db: { ok: boolean; comments: number; keywords: number };
  llm: { ok: boolean; model: string | null; error?: string };
  youtube: { ok: boolean; quotaUsed: number; quotaLimit: number; error?: string };
  daemon: { alive: boolean; lastSeenAt: string | null };
}
