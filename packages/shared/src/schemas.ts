import { z } from 'zod';
import { LOG_LEVELS, STAGES, TAG_CATEGORIES } from './constants.js';

/* ─────────────────────────── 공통 ─────────────────────────── */

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const cursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/* ─────────────────────────── 키워드 ─────────────────────────── */

export const keywordNameSchema = z
  .string()
  .trim()
  .min(1, '키워드를 입력해주세요')
  .max(80, '키워드는 80자 이하여야 합니다');

export const createKeywordSchema = z.object({
  name: keywordNameSchema,
  note: z.string().trim().max(500).optional(),
  /** 미지정 시 crawl.autoRunOnRegister 설정을 따른다 */
  autoRun: z.boolean().optional(),
});

/** 설정뷰의 일괄 등록(줄바꿈 구분) */
export const createKeywordsBulkSchema = z.object({
  names: z.array(keywordNameSchema).min(1).max(200),
  autoRun: z.boolean().optional(),
});

export const updateKeywordSchema = z
  .object({
    name: keywordNameSchema.optional(),
    note: z.string().trim().max(500).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '변경할 필드가 없습니다' });

export const listKeywordsQuery = z.object({
  q: z.string().trim().optional(),
  sort: z.enum(['name', 'comments', 'updated']).default('updated'),
  activeOnly: z.coerce.boolean().optional(),
});

/* ─────────────────────────── 태그 / 댓글 ─────────────────────────── */

export const listTagsQuery = z.object({
  q: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const keywordTagsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30),
});

export const listCommentsQuery = cursorQuery
  .extend({
    tagId: z.coerce.number().int().positive().optional(),
    keywordId: z.coerce.number().int().positive().optional(),
    sort: z.enum(['likes', 'recent']).default('likes'),
    sentiment: z.enum(['all', 'positive', 'neutral', 'negative']).default('all'),
    q: z.string().trim().optional(),
  })
  .refine((v) => v.tagId !== undefined || v.keywordId !== undefined, {
    message: 'tagId 또는 keywordId 중 하나는 필수입니다',
  });

/* ─────────────────────────── 실행 / 로그 ─────────────────────────── */

export const createRunSchema = z.object({
  keywordIds: z.array(z.number().int().positive()).optional(),
  trigger: z.enum(['manual', 'scheduled']).default('manual'),
  /** 일부 스테이지만 실행 (재분석: extract~analyze). 미지정 시 전체 5단계 */
  stages: z.array(z.enum(STAGES)).min(1).optional(),
});

export const listRunsQuery = cursorQuery.extend({
  status: z.string().optional(),
});

export const listLogsQuery = cursorQuery.extend({
  runId: z.coerce.number().int().positive().optional(),
  keywordId: z.coerce.number().int().positive().optional(),
  level: z.enum(LOG_LEVELS).optional(),
  stage: z.enum(STAGES).optional(),
});

/* ─────────────────────────── 설정 ─────────────────────────── */

export const settingsSchema = z.object({
  'yt.dailyQuota': z.number().int().min(1000).max(1_000_000),
  'yt.maxVideosPerKeyword': z.number().int().min(1).max(200),
  'yt.maxCommentsPerVideo': z.number().int().min(50).max(10_000),
  'yt.minCommentCount': z.number().int().min(0).max(100_000),
  'yt.relevanceLanguage': z.string().min(2).max(5),
  'scoring.wFreq': z.number().min(0).max(1),
  'scoring.wDistinct': z.number().min(0).max(1),
  'scoring.wEngage': z.number().min(0).max(1),
  'scoring.wIntensity': z.number().min(0).max(1),
  'cron.enabled': z.boolean(),
  'cron.schedule': z.string().min(9).max(40),
  'crawl.autoRunOnRegister': z.boolean(),
});

export type Settings = z.infer<typeof settingsSchema>;
export const updateSettingsSchema = settingsSchema.partial();

/* ─────────────────────────── LLM 응답 스키마 (§4.2, §4.4) ─────────────────────────── */

/** Stage 3-2: 태그 정규화 & 대표 태그 선정 */
export const llmTagSchema = z.object({
  name: z.string().trim().min(1).max(30),
  aliases: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  category: z.string().transform((v): string => {
    const hit = (TAG_CATEGORIES as readonly string[]).find((c) => c === v.trim());
    return hit ?? '기타';
  }),
  polarity: z.coerce.number().min(-1).max(1),
});

export const llmTagsResponseSchema = z.object({
  tags: z.array(llmTagSchema).min(1).max(80),
});

export type LlmTag = z.infer<typeof llmTagSchema>;

/** Stage 5: AI 분석 */
export const perceptionSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(600),
  evidence_tags: z.array(z.string().trim().min(1)).max(10).default([]),
  confidence: z.coerce.number().min(0).max(1).default(0.5),
});

export const analysisPayloadSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  overall_sentiment: z.object({
    label: z.enum(['positive', 'mixed', 'negative', 'neutral']),
    score: z.coerce.number().min(-1).max(1),
  }),
  perceptions: z.array(perceptionSchema).max(8).default([]),
  strengths: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  concerns: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  audience_voice: z.string().trim().max(1000).default(''),
  notable_shift: z.string().trim().max(1000).nullable().default(null),
});

export type AnalysisPayload = z.infer<typeof analysisPayloadSchema>;
export type Perception = z.infer<typeof perceptionSchema>;
