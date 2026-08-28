import { describe, expect, it } from 'vitest';
import { analysisPayloadSchema, llmTagsResponseSchema } from '@youtubeca/shared';
import { extractJson, isEmptyPayload, unwrapCandidates } from './json.js';

describe('extractJson', () => {
  it('순수 JSON을 그대로 파싱한다', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('코드펜스로 감싼 응답을 처리한다', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('설명 문장이 앞뒤에 붙어도 객체를 찾아낸다', () => {
    expect(extractJson('분석 결과입니다:\n{"a":1}\n감사합니다')).toEqual({ a: 1 });
  });

  it('트레일링 콤마를 복구한다', () => {
    expect(extractJson('{"a":1,}')).toEqual({ a: 1 });
  });

  it('JSON이 없으면 오류를 던진다', () => {
    expect(() => extractJson('그냥 텍스트')).toThrow();
    expect(() => extractJson('')).toThrow();
  });
});

describe('unwrapCandidates', () => {
  it('한 겹 감싼 객체를 벗겨낸다', () => {
    expect(unwrapCandidates({ analysis: { summary: 'x' } })).toEqual([{ summary: 'x' }]);
  });

  it('배열로 감싼 응답의 원소를 후보로 준다', () => {
    expect(unwrapCandidates([{ summary: 'x' }, 1])).toEqual([{ summary: 'x' }]);
  });

  it('원시값은 후보가 없다', () => {
    expect(unwrapCandidates('text')).toEqual([]);
  });
});

describe('isEmptyPayload', () => {
  it('빈 객체·빈 배열·null을 비었다고 본다', () => {
    expect(isEmptyPayload({})).toBe(true);
    expect(isEmptyPayload([])).toBe(true);
    expect(isEmptyPayload(null)).toBe(true);
    expect(isEmptyPayload({ a: 1 })).toBe(false);
  });
});

describe('LLM 응답 계약 (zod)', () => {
  it('태그 응답에서 알 수 없는 카테고리는 기타로 정규화된다', () => {
    const parsed = llmTagsResponseSchema.parse({
      tags: [{ name: '가성비', aliases: ['혜자'], category: '없는카테고리', polarity: '0.5' }],
    });
    expect(parsed.tags[0]).toMatchObject({ name: '가성비', category: '기타', polarity: 0.5 });
  });

  it('분석 응답의 선택 필드는 기본값으로 채워진다', () => {
    const parsed = analysisPayloadSchema.parse({
      summary: '요약',
      overall_sentiment: { label: 'mixed', score: 0.1 },
    });
    expect(parsed.perceptions).toEqual([]);
    expect(parsed.strengths).toEqual([]);
    expect(parsed.notable_shift).toBeNull();
  });

  it('범위를 벗어난 감성 점수는 거부한다', () => {
    expect(() =>
      analysisPayloadSchema.parse({
        summary: '요약',
        overall_sentiment: { label: 'positive', score: 5 },
      }),
    ).toThrow();
  });

  it('label이 정의되지 않은 값이면 거부한다', () => {
    expect(() =>
      analysisPayloadSchema.parse({ summary: 'x', overall_sentiment: { label: '좋음', score: 0 } }),
    ).toThrow();
  });
});
