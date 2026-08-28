import {
  aggregateTagStats,
  countKeywordComments,
  countKeywords,
  pruneOrphanTags,
  refreshTagCounters,
  replaceKeywordTags,
  tagDocumentFrequency,
} from '@youtubeca/db';
import { computeTagScores, type ScoringWeights } from './scoring.js';
import type { StageContext } from './types.js';

export interface ScoreResult {
  tags: number;
}

/** Stage 4 — 태그 강도 산출 (§4.3) */
export function scoreStage(stage: StageContext): ScoreResult {
  const { ctx, keyword, log } = stage;
  const settings = ctx.settings();

  stage.progress(10, '태그 집계');
  const aggregates = aggregateTagStats(ctx.db, keyword.id);
  if (aggregates.length === 0) {
    log.warn('강도를 산출할 태그가 없습니다');
    replaceKeywordTags(ctx.db, keyword.id, stage.runId, []);
    return { tags: 0 };
  }

  const totalComments = countKeywordComments(ctx.db, keyword.id);
  const totalKeywords = Math.max(1, countKeywords(ctx.db));
  const df = tagDocumentFrequency(ctx.db, keyword.id);

  const weights: ScoringWeights = {
    freq: settings['scoring.wFreq'],
    distinct: settings['scoring.wDistinct'],
    engage: settings['scoring.wEngage'],
    intensity: settings['scoring.wIntensity'],
  };

  stage.progress(50, '강도 계산');
  const scores = computeTagScores(
    aggregates.map((a) => ({
      tagId: a.tagId,
      commentCount: a.commentCount,
      likeSum: a.likeSum,
      sentimentSum: a.sentimentSum,
      absSentimentSum: a.absSentimentSum,
      sentimentCount: a.sentimentCount,
      documentFrequency: df.get(a.tagId) ?? 0,
    })),
    { totalComments, totalKeywords, weights },
  );

  replaceKeywordTags(ctx.db, keyword.id, stage.runId, scores);
  // 전역 태그 사전이므로 전체 카운터를 갱신하고, 어느 키워드에도 남지 않은 태그는 정리한다
  refreshTagCounters(ctx.db);
  const pruned = pruneOrphanTags(ctx.db);
  if (pruned > 0) log.info(`더 이상 사용되지 않는 태그 ${pruned}개 정리`);

  const top = [...scores].sort((a, b) => b.strength - a.strength).slice(0, 5);
  stage.progress(100, `태그 ${scores.length}개 강도 산출`);
  log.info(`강도 산출 완료: 태그 ${scores.length}개`, {
    weights,
    top: top.map((t) => ({ tagId: t.tagId, strength: t.strength, polarity: t.polarity })),
  });
  return { tags: scores.length };
}
