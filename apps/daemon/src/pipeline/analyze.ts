import {
  analysisSamples,
  getKeywordStats,
  getKeywordTags,
  saveAnalysis,
} from '@youtubeca/db';
import { ANALYSIS_SYSTEM_PROMPT, buildAnalysisPrompt, type AnalysisTagInput } from '@youtubeca/llm';
import { analysisPayloadSchema } from '@youtubeca/shared';
import { CancelledError, isCancellation, type StageContext } from './types.js';

export interface AnalyzeResult {
  saved: boolean;
  model?: string;
  reason?: string;
}

/**
 * 프롬프트에 포함할 상위 태그 수 (§4.4).
 * 추론형 로컬 모델은 프롬프트가 길수록 추론 토큰을 많이 써 응답이 잘리므로
 * 계획서 기준(25개 × 3샘플)에서 다소 보수적으로 잡는다.
 */
const TOP_TAGS = 20;
const SAMPLES_PER_TAG = 2;

/** Stage 5 — AI 분석 (§4.4). 실패해도 태그·강도는 유지되는 부분 성공 전략 (§8.3) */
export async function analyzeStage(stage: StageContext): Promise<AnalyzeResult> {
  const { ctx, keyword, log } = stage;

  if (stage.isCancelled()) throw new CancelledError();
  stage.progress(10, '프롬프트 구성');
  const tags = getKeywordTags(ctx.db, keyword.id, TOP_TAGS);
  if (tags.length === 0) {
    log.warn('태그가 없어 AI 분석을 건너뜁니다');
    return { saved: false, reason: 'no-tags' };
  }

  const stats = getKeywordStats(ctx.db, keyword.id);
  const promptTags: AnalysisTagInput[] = tags.map((tag) => ({
    tag: tag.name,
    strength: tag.strength,
    polarity: tag.polarity,
    category: tag.category,
    commentCount: tag.commentCount,
    samples: analysisSamples(ctx.db, keyword.id, tag.tagId, SAMPLES_PER_TAG),
  }));

  stage.progress(30, 'LLM 분석 요청');
  try {
    const response = await ctx.llm.chatJson(analysisPayloadSchema, {
      system: ANALYSIS_SYSTEM_PROMPT,
      user: buildAnalysisPrompt({
        keyword: keyword.name,
        tags: promptTags,
        stats: {
          totalComments: stats.commentCount,
          totalVideos: stats.videoCount,
          avgSentiment: stats.avgSentiment,
          positive: stats.sentimentBreakdown.positive,
          neutral: stats.sentimentBreakdown.neutral,
          negative: stats.sentimentBreakdown.negative,
        },
      }),
      maxTokens: 12_000,
      signal: stage.signal,
    });

    saveAnalysis(ctx.db, {
      keywordId: keyword.id,
      runId: stage.runId,
      model: response.model,
      payload: response.data,
      promptTokens: response.promptTokens,
      completionTokens: response.completionTokens,
    });

    stage.progress(100, 'AI 분석 저장 완료');
    log.info(`AI 분석 완료 (모델 ${response.model})`, {
      perceptions: response.data.perceptions.length,
      sentiment: response.data.overall_sentiment,
      tokens: { prompt: response.promptTokens, completion: response.completionTokens },
    });
    return { saved: true, model: response.model };
  } catch (error) {
    // 취소는 "부분 성공"이 아니다 — 그대로 올려 Run을 취소로 끝낸다
    if (isCancellation(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    log.error(`AI 분석 실패 — 태그·강도는 유지됩니다: ${message}`);
    return { saved: false, reason: message };
  }
}
