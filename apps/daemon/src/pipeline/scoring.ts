/**
 * 강도(Strength) 산출 공식 — 계획서 §4.3
 *
 *   raw = w1·Freq + w2·Distinct + w3·Engage + w4·Intensity
 *   strength = round(100 × minmax_normalize(raw, 키워드 내 태그 집합))
 *
 * 순수 함수로 분리해 단위 테스트가 가능하도록 한다 (§10).
 */

export interface ScoringWeights {
  freq: number;
  distinct: number;
  engage: number;
  intensity: number;
}

export interface TagScoreInput {
  tagId: number;
  /** 이 태그가 매칭된 댓글 수 */
  commentCount: number;
  /** 매칭 댓글 좋아요 합 */
  likeSum: number;
  /** 감성 점수 합 (극성 계산용) */
  sentimentSum: number;
  /** 감성 점수 절댓값 합 (세기 계산용) */
  absSentimentSum: number;
  /** 감성 점수가 존재하는 댓글 수 */
  sentimentCount: number;
  /** 다른 키워드 중 이 태그를 가진 키워드 수 */
  documentFrequency: number;
}

export interface TagScoreOutput {
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

export function normalizeWeights(weights: ScoringWeights): ScoringWeights {
  const sum = weights.freq + weights.distinct + weights.engage + weights.intensity;
  if (sum <= 0) return { freq: 0.4, distinct: 0.25, engage: 0.15, intensity: 0.2 };
  return {
    freq: weights.freq / sum,
    distinct: weights.distinct / sum,
    engage: weights.engage / sum,
    intensity: weights.intensity / sum,
  };
}

function minmax(values: number[]): (value: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-9) {
    // 태그가 1개이거나 값이 모두 같으면 전부 최대 강도로 본다
    return () => 1;
  }
  return (value) => (value - min) / (max - min);
}

export function computeTagScores(
  inputs: TagScoreInput[],
  options: {
    totalComments: number;
    totalKeywords: number;
    weights: ScoringWeights;
  },
): TagScoreOutput[] {
  if (inputs.length === 0) return [];

  const w = normalizeWeights(options.weights);
  const totalComments = Math.max(1, options.totalComments);
  const maxLikeSum = Math.max(1, ...inputs.map((i) => i.likeSum));
  const logTotal = Math.log10(totalComments + 1);

  const intermediate = inputs.map((input) => {
    const freq = logTotal > 0 ? Math.log10(input.commentCount + 1) / logTotal : 0;

    const tf = input.commentCount / totalComments;
    const idf = Math.log((options.totalKeywords + 1) / (1 + input.documentFrequency));
    const tfidf = tf * Math.max(idf, 0.1);

    const engage = Math.log10(input.likeSum + 1) / Math.log10(maxLikeSum + 1);
    const intensity =
      input.sentimentCount > 0 ? input.absSentimentSum / input.sentimentCount : 0;
    const polarity = input.sentimentCount > 0 ? input.sentimentSum / input.sentimentCount : 0;

    return { input, freq, tfidf, engage, intensity, polarity };
  });

  // Distinct는 키워드 내에서 0~1로 정규화한 TF-IDF
  const normalizeDistinct = minmax(intermediate.map((i) => i.tfidf));

  const scored = intermediate.map((item) => {
    const distinct = normalizeDistinct(item.tfidf);
    const raw =
      w.freq * item.freq +
      w.distinct * distinct +
      w.engage * item.engage +
      w.intensity * item.intensity;
    return { ...item, distinct, raw };
  });

  const normalizeRaw = minmax(scored.map((s) => s.raw));

  return scored.map((item) => ({
    tagId: item.input.tagId,
    strength: Math.round(100 * normalizeRaw(item.raw)),
    rawScore: Number(item.raw.toFixed(6)),
    polarity: Number(item.polarity.toFixed(4)),
    commentCount: item.input.commentCount,
    freq: Number(item.freq.toFixed(6)),
    distinctScore: Number(item.distinct.toFixed(6)),
    engage: Number(item.engage.toFixed(6)),
    intensity: Number(item.intensity.toFixed(6)),
  }));
}

/* ─────────────────────────── 관련 키워드 (§4.3) ─────────────────────────── */

export function cosineSimilarity(a: Map<number, number>, b: Map<number, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  if (normA === 0 || normB === 0) return 0;

  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [tagId, value] of small) {
    const other = large.get(tagId);
    if (other !== undefined) dot += value * other;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
