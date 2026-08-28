/**
 * 텍스트 정규화 · 토크나이징 · 감성 사전
 *
 * 계획서 §4.2 3-1은 형태소 분석기(WASM) 사용을 권장하되 미가용 환경에서는
 * n-gram 폴백을 쓰도록 규정한다. 외부 네이티브 의존 없이 동작해야 하므로
 * 여기서는 "조사/어미 절단 + n-gram" 방식을 기본 구현으로 둔다.
 */

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#039': "'", '#34': '"',
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
      const key = entity.toLowerCase();
      if (key in HTML_ENTITIES) return HTML_ENTITIES[key]!;
      if (key.startsWith('#x')) {
        const code = Number.parseInt(key.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      if (key.startsWith('#')) {
        const code = Number.parseInt(key.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : match;
      }
      return match;
    });
}

const URL_RE = /https?:\/\/[^\s<>()"']+/gi;
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;
/** 유튜브 댓글의 타임스탬프 언급 (0:32 형태) */
const TIMESTAMP_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

export interface NormalizedText {
  normalized: string;
  urls: string[];
  emojis: string[];
}

/** 원문은 보존하고, 분석용 정규화 텍스트/URL/이모지를 분리한다 (§4.1 ②) */
export function normalizeText(original: string): NormalizedText {
  const decoded = decodeHtmlEntities(original);
  const urls = decoded.match(URL_RE) ?? [];
  const emojis = decoded.match(EMOJI_RE) ?? [];
  const normalized = decoded
    .replace(URL_RE, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(TIMESTAMP_RE, ' ')
    .replace(/[​-‍﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { normalized, urls: [...new Set(urls)], emojis: [...new Set(emojis)] };
}

const HANGUL_RE = /[가-힣㄰-㆏]/;
export function hasHangul(text: string): boolean {
  return HANGUL_RE.test(text);
}

export function detectLang(text: string): 'ko' | 'en' | 'other' {
  if (hasHangul(text)) return 'ko';
  if (/[a-zA-Z]/.test(text)) return 'en';
  return 'other';
}

/** 한국어 조사/어미 — 어절 끝에서 절단해 어간 후보를 만든다 (긴 것부터) */
const KO_SUFFIXES = [
  '으로부터', '이라고', '라고는', '에서는', '에게서', '으로는', '이라는', '까지도', '부터는',
  '에서도', '한테는', '이라도', '으로써', '으로서',
  '에게', '한테', '보다', '까지', '부터', '처럼', '으로', '이라', '라는', '이나', '이란',
  '조차', '마저', '만큼', '에는', '에서', '에도', '이고', '하고', '이면', '지만', '는데',
  '이다', '입니', '했다', '한다', '이야', '이지', '네요', '더라', '거든', '구나',
  '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '로', '랑', '요', '임', '음',
];

export function stripKoreanSuffix(word: string): string {
  if (!hasHangul(word) || word.length <= 2) return word;
  for (const suffix of KO_SUFFIXES) {
    if (word.length - suffix.length >= 2 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

export const KO_STOPWORDS = new Set([
  '그리고', '그러나', '하지만', '그래서', '그런데', '그러면', '때문', '위해', '통해', '대해', '관해',
  '이거', '저거', '그거', '여기', '거기', '저기', '이건', '그건', '저건', '뭔가', '진짜', '정말',
  '너무', '아주', '매우', '조금', '약간', '거의', '완전', '엄청', '완벽', '그냥', '역시', '아직',
  '이제', '다시', '먼저', '나중', '지금', '오늘', '내일', '어제', '요즘', '항상', '언제', '어디',
  '누구', '무엇', '어떤', '어떻', '이렇', '그렇', '저렇', '하는', '하고', '해서', '해도', '하면',
  '있는', '있다', '없는', '없다', '되는', '된다', '같은', '같다', '같아', '보다', '보면', '보니',
  '사람', '사람들', '우리', '저희', '제가', '내가', '너가', '니가', '자기', '본인', '여러분',
  '영상', '유튜브', '채널', '구독', '좋아요', '댓글', '알고리즘', '조회수', '업로드', '방송',
  '감사합니다', '감사', '축하', '수고', '화이팅', '구독자', '님들', '형님', '언니', '누나', '오빠',
  '입니다', '습니다', '했어요', '해요', '이런', '그런', '저런', '무슨', '얼마', '정도', '경우',
  '부분', '자체', '자꾸', '계속', '결국', '역시나', '심지어', '오히려', '차라리', '그리', '이나',
]);

export const EN_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was', 'were', 'have', 'has',
  'had', 'but', 'not', 'all', 'can', 'from', 'they', 'them', 'their', 'there', 'here', 'what',
  'when', 'who', 'how', 'why', 'about', 'just', 'like', 'more', 'most', 'some', 'any', 'out',
  'get', 'got', 'one', 'two', 'its', 'his', 'her', 'she', 'him', 'our', 'been', 'being', 'does',
  'did', 'doing', 'will', 'would', 'should', 'could', 'than', 'then', 'these', 'those', 'video',
  'youtube', 'channel', 'subscribe', 'comment', 'watch', 'watching', 'thanks', 'thank', 'please',
]);

export function isStopword(term: string): boolean {
  const lower = term.toLowerCase();
  return KO_STOPWORDS.has(term) || EN_STOPWORDS.has(lower);
}

export interface TokenizeOptions {
  /** 키워드 자기 자신 · 채널명 등 제외 토큰 */
  extraStopwords?: Iterable<string>;
  maxNgram?: number;
}

/** 어절 단위 분해 (한글/영문/숫자만 유지) */
export function splitWords(text: string): string[] {
  return text
    .split(/[^0-9A-Za-z가-힣㄰-㆏]+/)
    .filter((w) => w.length > 0);
}

function isMeaningfulTerm(term: string): boolean {
  if (term.length < 2) return false;
  if (/^\d+$/.test(term)) return false;
  if (/^[㄰-㆏]+$/.test(term)) return false; // ㅋㅋㅋ, ㅠㅠ 등 자모만
  if (/^(.)\1+$/.test(term)) return false; // 같은 글자 반복
  if (term.length > 20) return false;
  return true;
}

/**
 * 후보 term 목록을 만든다.
 * - 한국어: 조사 절단 어간 + 인접 어절 bigram
 * - 영어: 소문자 unigram + bigram
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
  const maxNgram = Math.max(1, Math.min(options.maxNgram ?? 2, 3));
  const extra = new Set<string>();
  for (const s of options.extraStopwords ?? []) {
    extra.add(s);
    extra.add(s.toLowerCase());
    extra.add(s.replace(/\s+/g, ''));
  }

  const words = splitWords(text);
  const stems = words.map((w) => (hasHangul(w) ? stripKoreanSuffix(w) : w.toLowerCase()));

  const terms: string[] = [];
  const push = (term: string) => {
    if (!isMeaningfulTerm(term)) return;
    if (isStopword(term) || extra.has(term) || extra.has(term.toLowerCase())) return;
    terms.push(term);
  };

  for (let i = 0; i < stems.length; i += 1) {
    push(stems[i]!);
    for (let n = 2; n <= maxNgram && i + n <= stems.length; n += 1) {
      const parts = stems.slice(i, i + n);
      if (parts.some((p) => p.length < 2 || isStopword(p))) continue;
      const joined = parts.join(' ');
      if (joined.length > 24) continue;
      push(joined);
    }
  }
  return terms;
}

/** 태그 사전 역인덱싱용: 정규화된 비교 키 */
export function matchKey(term: string): string {
  return term.toLowerCase().replace(/\s+/g, '');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
