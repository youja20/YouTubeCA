import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities, matchKey, normalizeText, stripKoreanSuffix, tokenize } from './text.js';

describe('decodeHtmlEntities', () => {
  it('YouTube 댓글의 엔티티와 br 태그를 복원한다', () => {
    expect(decodeHtmlEntities('가격 &amp; 성능<br>최고&#39;s')).toBe("가격 & 성능\n최고's");
  });
});

describe('normalizeText', () => {
  it('URL과 이모지를 분리하고 공백을 정리한다', () => {
    const result = normalizeText('진짜  좋아요 😍 https://example.com/a?b=1 추천');
    expect(result.normalized).toBe('진짜 좋아요 추천');
    expect(result.urls).toEqual(['https://example.com/a?b=1']);
    expect(result.emojis).toContain('😍');
  });

  it('타임스탬프 언급을 제거한다', () => {
    expect(normalizeText('1:23 부분 음질 좋네').normalized).toBe('부분 음질 좋네');
  });
});

describe('stripKoreanSuffix', () => {
  it('조사를 절단해 어간을 남긴다', () => {
    expect(stripKoreanSuffix('가성비가')).toBe('가성비');
    expect(stripKoreanSuffix('배터리는')).toBe('배터리');
  });

  it('어간이 2글자 미만이 되는 절단은 하지 않는다', () => {
    expect(stripKoreanSuffix('나는')).toBe('나는');
  });
});

describe('tokenize', () => {
  it('불용어와 1글자 토큰을 제거한다', () => {
    const terms = tokenize('그리고 이 제품 음질 좋다');
    expect(terms).toContain('제품');
    expect(terms).toContain('음질');
    expect(terms).not.toContain('그리고');
    expect(terms).not.toContain('이');
  });

  it('키워드 자기 자신을 제외한다', () => {
    const terms = tokenize('무선이어폰 음질이 좋다', { extraStopwords: ['무선이어폰'] });
    expect(terms).not.toContain('무선이어폰');
    expect(terms).toContain('음질');
  });

  it('ㅋㅋㅋ 같은 자모 반복과 숫자를 걸러낸다', () => {
    const terms = tokenize('ㅋㅋㅋ 2024 배터리 ㅠㅠ');
    expect(terms).toEqual(expect.arrayContaining(['배터리']));
    expect(terms).not.toContain('ㅋㅋㅋ');
    expect(terms).not.toContain('2024');
  });

  it('인접 어절 bigram을 만든다', () => {
    expect(tokenize('노이즈 캔슬링 성능', { maxNgram: 2 })).toContain('노이즈 캔슬링');
  });
});

describe('matchKey', () => {
  it('공백과 대소문자를 무시한 비교 키를 만든다', () => {
    expect(matchKey('노이즈 캔슬링')).toBe(matchKey('노이즈캔슬링'));
    expect(matchKey('QCY')).toBe(matchKey('qcy'));
  });
});
