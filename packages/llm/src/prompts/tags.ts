import { EXTRACTION, TAG_CATEGORIES, truncate } from '@youtubeca/shared';
import { INJECTION_GUARD, wrapComment } from './guard.js';

export interface TagCandidateInput {
  term: string;
  score: number;
  commentCount: number;
  samples: string[];
}

export interface TagPromptInput {
  keyword: string;
  candidates: TagCandidateInput[];
  totalComments: number;
}

export const TAG_SYSTEM_PROMPT = [
  '당신은 한국어 소셜 댓글 분석 전문가입니다.',
  '통계적으로 추출된 후보 단어 목록을 받아, 사람이 읽기 좋은 "태그 사전"으로 정리하는 것이 임무입니다.',
  '',
  INJECTION_GUARD,
].join('\n');

/** Stage 3-2: 후보 정규화 → 최종 태그 확정 (§4.2) */
export function buildTagPrompt(input: TagPromptInput): string {
  const lines: string[] = [];
  lines.push(`# 분석 키워드\n${input.keyword}`);
  lines.push(`# 전체 댓글 수\n${input.totalComments.toLocaleString('ko-KR')}건`);
  lines.push('');
  lines.push('# 통계 추출 후보 (TF-IDF 상위순)');
  lines.push('형식: 후보어 | 점수 | 등장 댓글 수');
  lines.push('');

  for (const [index, candidate] of input.candidates.entries()) {
    lines.push(`- ${candidate.term} | ${candidate.score.toFixed(4)} | ${candidate.commentCount}`);
    // 상위 후보에만 대표 댓글을 붙여 프롬프트 크기를 제한한다
    if (index >= EXTRACTION.sampleCandidateLimit) continue;
    for (const sample of candidate.samples.slice(0, EXTRACTION.sampleCommentsPerCandidate)) {
      lines.push(`  ${wrapComment(truncate(sample, 120))}`);
    }
  }

  lines.push('');
  lines.push('# 수행할 작업');
  lines.push('1. 동의어·표기 변형을 하나의 대표 태그로 병합하세요. (예: 가성비/가격대비/혜자 → "가성비")');
  lines.push('2. 각 태그에 감성 극성(polarity)을 -1.0(매우 부정) ~ +1.0(매우 긍정)으로 부여하세요.');
  lines.push(`3. 각 태그에 카테고리를 부여하세요. 반드시 다음 중 하나: ${TAG_CATEGORIES.join(', ')}`);
  lines.push('4. 스팸·무의미 토큰·키워드 자기 자신·채널명은 제외하세요.');
  lines.push(`5. 최종적으로 ${EXTRACTION.minTags}~${EXTRACTION.maxTags}개의 태그만 남기세요.`);
  lines.push('6. 태그 이름은 한국어 명사(구)로, 공백 없이 또는 2어절 이내로 간결하게 쓰세요.');
  lines.push('7. aliases에는 그 태그로 병합한 후보어들을 원문 그대로 넣으세요 (대표 태그명 자신은 제외 가능).');
  lines.push('');
  lines.push('# 출력 형식 (이 JSON 객체만 출력)');
  lines.push(
    JSON.stringify(
      {
        tags: [
          { name: '가성비', aliases: ['가격대비', '혜자'], category: '가격', polarity: 0.6 },
        ],
      },
      null,
      2,
    ),
  );
  return lines.join('\n');
}
