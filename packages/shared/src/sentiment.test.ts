import { describe, expect, it } from 'vitest';
import { analyzeSentiment, sentimentLabel } from './sentiment.js';

describe('analyzeSentiment', () => {
  it('긍정 표현은 양수를 반환한다', () => {
    expect(analyzeSentiment('음질 진짜 좋아요 최고').score).toBeGreaterThan(0.3);
  });

  it('부정 표현은 음수를 반환한다', () => {
    expect(analyzeSentiment('배터리 최악이고 완전 실망').score).toBeLessThan(-0.3);
  });

  it('감성어가 없으면 중립(0)이다', () => {
    const result = analyzeSentiment('오늘 영상 봤습니다');
    expect(result.hits).toBe(0);
    expect(result.score).toBe(0);
  });

  it('부정어가 붙으면 극성이 뒤집힌다', () => {
    const positive = analyzeSentiment('좋아요').score;
    const negated = analyzeSentiment('안좋아요').score;
    expect(positive).toBeGreaterThan(0);
    expect(negated).toBeLessThan(0);
  });

  it('점수는 항상 -1~1 범위 안에 있다', () => {
    const extreme = analyzeSentiment('최고 최고 대박 완벽 사랑 감동 훌륭 짱 좋아요'.repeat(5));
    expect(extreme.score).toBeLessThanOrEqual(1);
    expect(extreme.score).toBeGreaterThanOrEqual(-1);
  });

  it('빈 문자열을 안전하게 처리한다', () => {
    expect(analyzeSentiment('')).toEqual({ score: 0, hits: 0 });
  });
});

describe('sentimentLabel', () => {
  it('임계값 0.15를 기준으로 분류한다', () => {
    expect(sentimentLabel(0.2)).toBe('positive');
    expect(sentimentLabel(0.1)).toBe('neutral');
    expect(sentimentLabel(-0.2)).toBe('negative');
    expect(sentimentLabel(null)).toBe('neutral');
  });
});
