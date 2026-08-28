import { describe, expect, it } from 'vitest';
import { computeTagScores, cosineSimilarity, normalizeWeights } from './scoring.js';

const WEIGHTS = { freq: 0.4, distinct: 0.25, engage: 0.15, intensity: 0.2 };

const base = {
  likeSum: 0,
  sentimentSum: 0,
  absSentimentSum: 0,
  sentimentCount: 0,
  documentFrequency: 0,
};

describe('normalizeWeights', () => {
  it('합이 1이 아니어도 비율을 유지하며 정규화한다', () => {
    const result = normalizeWeights({ freq: 2, distinct: 1, engage: 0.5, intensity: 0.5 });
    expect(result.freq + result.distinct + result.engage + result.intensity).toBeCloseTo(1);
    expect(result.freq).toBeCloseTo(0.5);
  });

  it('합이 0이면 계획서 기본 가중치로 되돌린다', () => {
    expect(normalizeWeights({ freq: 0, distinct: 0, engage: 0, intensity: 0 })).toEqual(WEIGHTS);
  });
});

describe('computeTagScores', () => {
  it('강도를 키워드 내에서 0~100으로 정규화한다', () => {
    const scores = computeTagScores(
      [
        { ...base, tagId: 1, commentCount: 500, likeSum: 5000 },
        { ...base, tagId: 2, commentCount: 100, likeSum: 400 },
        { ...base, tagId: 3, commentCount: 10, likeSum: 5 },
      ],
      { totalComments: 1000, totalKeywords: 5, weights: WEIGHTS },
    );

    expect(scores.map((s) => s.strength)).toEqual([100, expect.any(Number), 0]);
    expect(scores[0]!.strength).toBeGreaterThan(scores[1]!.strength);
    expect(scores[1]!.strength).toBeGreaterThan(scores[2]!.strength);
    for (const score of scores) {
      expect(score.strength).toBeGreaterThanOrEqual(0);
      expect(score.strength).toBeLessThanOrEqual(100);
    }
  });

  it('극성은 감성 점수 평균, 세기는 절댓값 평균이다', () => {
    const [score] = computeTagScores(
      [{ ...base, tagId: 1, commentCount: 4, sentimentSum: -1.2, absSentimentSum: 2.0, sentimentCount: 4 }],
      { totalComments: 100, totalKeywords: 1, weights: WEIGHTS },
    );
    expect(score!.polarity).toBeCloseTo(-0.3);
    expect(score!.intensity).toBeCloseTo(0.5);
  });

  it('희소한 태그(다른 키워드에 적게 등장)가 더 높은 변별력을 갖는다', () => {
    const scores = computeTagScores(
      [
        { ...base, tagId: 1, commentCount: 100, documentFrequency: 0 },
        { ...base, tagId: 2, commentCount: 100, documentFrequency: 9 },
      ],
      { totalComments: 1000, totalKeywords: 10, weights: WEIGHTS },
    );
    expect(scores[0]!.distinctScore).toBeGreaterThan(scores[1]!.distinctScore);
  });

  it('태그가 하나뿐이면 강도 100을 부여한다', () => {
    const scores = computeTagScores([{ ...base, tagId: 1, commentCount: 10 }], {
      totalComments: 100,
      totalKeywords: 1,
      weights: WEIGHTS,
    });
    expect(scores[0]!.strength).toBe(100);
  });

  it('빈 입력은 빈 결과를 낸다', () => {
    expect(computeTagScores([], { totalComments: 0, totalKeywords: 0, weights: WEIGHTS })).toEqual([]);
  });
});

describe('cosineSimilarity', () => {
  it('동일 벡터의 유사도는 1이다', () => {
    const v = new Map([
      [1, 0.5],
      [2, 0.3],
    ]);
    expect(cosineSimilarity(v, new Map(v))).toBeCloseTo(1);
  });

  it('공유 태그가 없으면 0이다', () => {
    expect(cosineSimilarity(new Map([[1, 1]]), new Map([[2, 1]]))).toBe(0);
  });

  it('빈 벡터는 0을 반환한다', () => {
    expect(cosineSimilarity(new Map(), new Map([[1, 1]]))).toBe(0);
  });
});
