/**
 * 사전 기반 댓글 감성 점수 (-1 ~ +1)
 *
 * 계획서 §4.3의 Intensity 항과 커멘트뷰 감성 필터는 댓글 단위 감성 점수를 전제한다.
 * 댓글 전수(수만 건)에 LLM을 돌리는 것은 비용·시간상 불가하므로, 로컬 사전 기반으로
 * 산출한다. 태그 단위 극성은 §4.2 3-2에서 LLM이 별도로 부여하며, 두 값은 상호 보완적이다.
 */
import { hasHangul, splitWords, stripKoreanSuffix } from './text.js';

const POSITIVE: Record<string, number> = {
  좋: 0.6, 좋아: 0.7, 좋은: 0.7, 좋다: 0.7, 좋네: 0.7, 좋음: 0.7, 좋지: 0.6, 좋고: 0.6, 최고: 0.9, 짱: 0.8,
  대박: 0.8, 훌륭: 0.8, 멋지: 0.7, 멋있: 0.7, 예쁘: 0.6, 이쁘: 0.6, 귀엽: 0.6,
  만족: 0.8, 추천: 0.7, 감동: 0.8, 재밌: 0.7, 재미있: 0.7, 유익: 0.7, 완벽: 0.8,
  편하: 0.6, 편리: 0.6, 빠르: 0.4, 저렴: 0.6, 가성비: 0.6, 혜자: 0.7, 튼튼: 0.6,
  깔끔: 0.6, 부드럽: 0.5, 선명: 0.5, 시원: 0.5, 든든: 0.6, 뿌듯: 0.7, 행복: 0.8,
  사랑: 0.8, 고맙: 0.6, 감사: 0.6, 응원: 0.6, 존경: 0.7, 대단: 0.7, 굿: 0.6, 꿀: 0.6,
  잘: 0.3, 잘나: 0.5, 명작: 0.9, 갓: 0.7, 인정: 0.5, 참신: 0.6, 신선: 0.5, 안정: 0.5,
  good: 0.6, great: 0.8, best: 0.9, awesome: 0.9, amazing: 0.9, love: 0.8, nice: 0.6,
  perfect: 0.9, excellent: 0.9, thanks: 0.4, helpful: 0.6, beautiful: 0.7, worth: 0.5,
};

const NEGATIVE: Record<string, number> = {
  별로: -0.7, 최악: -0.9, 실망: -0.8, 후회: -0.8, 짜증: -0.8, 화나: -0.8, 열받: -0.8,
  불편: -0.6, 불만: -0.7, 불량: -0.8, 고장: -0.7, 발열: -0.5, 소음: -0.5, 느리: -0.5,
  비싸: -0.6, 비쌈: -0.6, 가격: -0.1, 창렬: -0.8, 사기: -0.9, 거짓: -0.8, 조작: -0.8,
  광고: -0.3, 뒷광고: -0.8, 억지: -0.6, 노잼: -0.7, 지루: -0.6, 답답: -0.6, 아쉽: -0.5,
  어렵: -0.4, 복잡: -0.4, 부실: -0.7, 조잡: -0.7, 싸구려: -0.7, 쓰레기: -0.9, 폐급: -0.9,
  구리: -0.7, 구림: -0.7, 망: -0.6, 망함: -0.8, 문제: -0.4, 오류: -0.5, 버그: -0.5,
  위험: -0.6, 무섭: -0.5, 슬프: -0.5, 안타깝: -0.5, 심각: -0.6, 논란: -0.5, 비판: -0.5,
  bad: -0.7, worst: -0.9, terrible: -0.9, awful: -0.9, hate: -0.8, boring: -0.6,
  disappointed: -0.8, broken: -0.7, expensive: -0.4, scam: -0.9, useless: -0.8, poor: -0.6,
};

const INTENSIFIERS: Record<string, number> = {
  너무: 1.4, 진짜: 1.3, 정말: 1.3, 완전: 1.4, 엄청: 1.4, 매우: 1.3, 아주: 1.3, 개: 1.5,
  존나: 1.6, 겁나: 1.4, 되게: 1.2, 좀: 0.8, 조금: 0.7, 약간: 0.7, 그냥: 0.8,
  very: 1.3, really: 1.3, so: 1.2, extremely: 1.5, slightly: 0.7, kinda: 0.8,
};

const NEGATIONS = ['안', '않', '못', '없', '아니', 'not', 'never', "don't", 'no'];

const EMOJI_SENTIMENT: [RegExp, number][] = [
  [/[😍🥰😊😁😄👍🔥💯❤️🥳✨👏]/u, 0.5],
  [/[😡🤬😠👎💩😤🤮😰😭]/u, -0.5],
];

/** 어절 앞에 붙는 부정 접두사 (안좋아, 못쓰겠다) */
const NEGATION_PREFIXES = ['안', '못'];

function lookup(term: string): number {
  if (term in POSITIVE) return POSITIVE[term]!;
  if (term in NEGATIVE) return NEGATIVE[term]!;
  // 한국어는 어미 변화가 많아 접두 일치로 보완 (좋았어요 → 좋아)
  if (hasHangul(term)) {
    for (const [word, score] of Object.entries(POSITIVE)) {
      if (word.length >= 2 && term.startsWith(word)) return score;
    }
    for (const [word, score] of Object.entries(NEGATIVE)) {
      if (word.length >= 2 && term.startsWith(word)) return score;
    }
  }
  return 0;
}

/** 어절 하나의 감성 점수와, 부정 접두사가 이미 반영됐는지 여부 */
function baseScore(term: string): { score: number; negated: boolean } {
  const direct = lookup(term);
  if (direct !== 0) return { score: direct, negated: false };

  // "안좋아" 처럼 부정 접두사가 어절 내부에 붙은 경우
  if (term.length >= 3 && hasHangul(term)) {
    for (const prefix of NEGATION_PREFIXES) {
      if (!term.startsWith(prefix)) continue;
      const rest = lookup(term.slice(prefix.length));
      if (rest !== 0) return { score: -rest * 0.8, negated: true };
    }
  }
  return { score: 0, negated: false };
}

function hasNegation(word: string): boolean {
  return NEGATIONS.some((n) => word.includes(n));
}

export interface SentimentResult {
  /** -1 ~ +1 */
  score: number;
  /** 감성 단어 매칭 수 (0이면 중립·근거 없음) */
  hits: number;
}

export function analyzeSentiment(text: string): SentimentResult {
  if (!text) return { score: 0, hits: 0 };

  const words = splitWords(text);
  let sum = 0;
  let hits = 0;

  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i]!;
    const term = hasHangul(raw) ? stripKoreanSuffix(raw) : raw.toLowerCase();
    const base = baseScore(term);
    let score = base.score;
    if (score === 0) continue;

    const prev = words[i - 1];
    if (prev) {
      const prevTerm = hasHangul(prev) ? prev : prev.toLowerCase();
      const multiplier = INTENSIFIERS[stripKoreanSuffix(prevTerm)] ?? INTENSIFIERS[prevTerm];
      if (multiplier) score *= multiplier;
      if (hasNegation(prevTerm)) score *= -0.8;
    }
    // 어절 내부에 붙은 부정어 (좋지않아). 접두사 부정은 baseScore에서 이미 반영했다.
    if (!base.negated && hasNegation(raw) && !NEGATIONS.includes(term)) score *= -0.8;

    sum += score;
    hits += 1;
  }

  for (const [re, score] of EMOJI_SENTIMENT) {
    const matches = text.match(new RegExp(re, 'gu'));
    if (matches) {
      sum += score * Math.min(matches.length, 3);
      hits += 1;
    }
  }

  if (hits === 0) return { score: 0, hits: 0 };
  // 길이에 따른 과대평가 방지: 평균 대신 완만한 포화 함수 사용
  const avg = sum / Math.sqrt(hits);
  const score = Math.max(-1, Math.min(1, avg / 1.5));
  return { score: Number(score.toFixed(4)), hits };
}

export function sentimentLabel(score: number | null): 'positive' | 'neutral' | 'negative' {
  if (score === null) return 'neutral';
  if (score >= 0.15) return 'positive';
  if (score <= -0.15) return 'negative';
  return 'neutral';
}
