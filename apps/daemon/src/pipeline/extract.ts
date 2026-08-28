import {
  loadAliases,
  loadKeywordCorpus,
  keywordVideoTitles,
  refreshTagCounters,
  replaceCommentTags,
  replaceKeywordTerms,
  termDocumentFrequency,
  upsertTag,
  type CorpusComment,
} from '@youtubeca/db';
import { buildTagPrompt, TAG_SYSTEM_PROMPT, type TagCandidateInput } from '@youtubeca/llm';
import {
  countKeywords,
} from '@youtubeca/db';
import {
  EXTRACTION,
  llmTagsResponseSchema,
  matchKey,
  tokenize,
  type LlmTag,
} from '@youtubeca/shared';
import { CancelledError, isCancellation, type StageContext } from './types.js';

export interface ExtractResult {
  candidates: number;
  tags: number;
  mappings: number;
  llmUsed: boolean;
}

interface TermStat {
  term: string;
  commentCount: number;
  score: number;
}

/** Stage 3 — 태그(핵심 단어) 추출: 통계 후보 → LLM 정규화 → 전수 역인덱싱 (§4.2) */
export async function extractStage(stage: StageContext): Promise<ExtractResult> {
  const { ctx, keyword, log } = stage;

  stage.progress(5, '코퍼스 로드 중');
  const corpus = loadKeywordCorpus(ctx.db, keyword.id);
  if (corpus.length === 0) {
    log.warn('분석할 댓글이 없습니다');
    return { candidates: 0, tags: 0, mappings: 0, llmUsed: false };
  }

  /* 3-1. 통계적 후보 추출 (로컬) */
  const extraStopwords = buildExtraStopwords(ctx, keyword.id, keyword.name);
  stage.progress(15, '토크나이징');

  const commentTerms = new Map<string, Set<string>>();
  const termComments = new Map<string, string[]>();

  for (const comment of corpus) {
    const terms = new Set(tokenize(comment.text, { extraStopwords, maxNgram: 2 }));
    commentTerms.set(comment.id, terms);
    for (const term of terms) {
      const list = termComments.get(term);
      if (list) list.push(comment.id);
      else termComments.set(term, [comment.id]);
    }
  }

  if (stage.isCancelled()) throw new CancelledError();
  stage.progress(35, 'TF-IDF 산출');

  const totalKeywords = Math.max(1, countKeywords(ctx.db));
  const df = termDocumentFrequency(ctx.db, keyword.id);

  const stats: TermStat[] = [];
  for (const [term, ids] of termComments) {
    if (ids.length < 2) continue; // 1회성 토큰 제거
    const tf = ids.length / corpus.length;
    const idf = Math.log((totalKeywords + 1) / (1 + (df.get(term) ?? 0)));
    stats.push({ term, commentCount: ids.length, score: tf * Math.max(idf, 0.1) });
  }
  stats.sort((a, b) => b.score - a.score);

  // 다음 실행의 IDF 계산을 위해 상위 term 통계를 보존한다
  replaceKeywordTerms(
    ctx.db,
    keyword.id,
    stats.slice(0, 2000).map((s) => ({
      term: s.term,
      commentCount: s.commentCount,
      tf: s.commentCount / corpus.length,
      score: s.score,
    })),
  );

  const candidates = stats.slice(0, EXTRACTION.candidateLimit);
  log.info(`통계 후보 ${candidates.length}개 추출 (전체 term ${stats.length})`);

  /* 3-2. LLM 정규화 & 대표 태그 선정 */
  stage.progress(50, 'LLM 태그 정규화');
  const byId = new Map(corpus.map((c) => [c.id, c]));
  const promptCandidates: TagCandidateInput[] = candidates.map((candidate, index) => ({
    term: candidate.term,
    score: candidate.score,
    commentCount: candidate.commentCount,
    samples: index >= EXTRACTION.sampleCandidateLimit
      ? []
      : (termComments.get(candidate.term) ?? [])
          .map((id) => byId.get(id))
          .filter((c): c is CorpusComment => c !== undefined)
          .sort((a, b) => b.likeCount - a.likeCount)
          .slice(0, EXTRACTION.sampleCommentsPerCandidate)
          .map((c) => c.text),
  }));

  let finalTags: LlmTag[];
  let llmUsed = true;
  try {
    const response = await ctx.llm.chatJson(llmTagsResponseSchema, {
      system: TAG_SYSTEM_PROMPT,
      user: buildTagPrompt({
        keyword: keyword.name,
        candidates: promptCandidates,
        totalComments: corpus.length,
      }),
      maxTokens: 6000,
      signal: stage.signal,
    });
    finalTags = response.data.tags.slice(0, EXTRACTION.maxTags);
    log.info(`LLM이 태그 ${finalTags.length}개 확정 (모델 ${response.model})`);
  } catch (error) {
    // 취소를 통계 폴백으로 흘려보내면 취소가 무시된 것처럼 보인다
    if (isCancellation(error)) throw error;
    llmUsed = false;
    log.warn(
      `LLM 태그 정규화 실패 → 통계 결과로 폴백합니다: ${error instanceof Error ? error.message : String(error)}`,
    );
    finalTags = statisticalFallback(candidates, termComments, byId);
  }

  if (stage.isCancelled()) throw new CancelledError();
  stage.progress(70, '태그 사전 저장');

  const tagIds = new Map<string, number>();
  for (const tag of finalTags) {
    const id = upsertTag(ctx.db, {
      name: tag.name,
      category: tag.category,
      polarity: tag.polarity,
      aliases: tag.aliases,
    });
    tagIds.set(tag.name, id);
  }

  /* 3-3. 댓글–태그 역인덱싱 (LLM 호출 없이 전수 커버리지) */
  stage.progress(80, '댓글 역인덱싱');
  const aliasMap = buildAliasMap(ctx, new Set(tagIds.values()));
  const mappings = reverseIndex(corpus, commentTerms, aliasMap);

  replaceCommentTags(ctx.db, keyword.id, mappings);
  refreshTagCounters(ctx.db, [...tagIds.values()]);

  stage.progress(100, `태그 ${tagIds.size}개 · 매핑 ${mappings.length}건`);
  log.info(`태그 ${tagIds.size}개, 댓글-태그 매핑 ${mappings.length.toLocaleString('ko-KR')}건`);
  return { candidates: candidates.length, tags: tagIds.size, mappings: mappings.length, llmUsed };
}

/** 키워드 자기 자신 + 영상 제목/채널명 토큰은 후보에서 제외 (§4.2 3-1) */
function buildExtraStopwords(
  ctx: StageContext['ctx'],
  keywordId: number,
  keywordName: string,
): Set<string> {
  const stopwords = new Set<string>();
  for (const token of tokenize(keywordName, { maxNgram: 2 })) stopwords.add(token);
  stopwords.add(keywordName);
  stopwords.add(keywordName.replace(/\s+/g, ''));

  const titles = keywordVideoTitles(ctx.db, keywordId);
  const channelCounts = new Map<string, number>();
  for (const { title, channel } of titles) {
    for (const token of tokenize(channel, { maxNgram: 1 })) stopwords.add(token);
    // 제목 토큰은 여러 영상에 반복 등장할 때만 제거 (주제어까지 지우지 않도록)
    for (const token of new Set(tokenize(title, { maxNgram: 1 }))) {
      channelCounts.set(token, (channelCounts.get(token) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(titles.length * 0.5));
  for (const [token, count] of channelCounts) {
    if (count >= threshold) stopwords.add(token);
  }
  return stopwords;
}

/** LLM 실패 시 통계 상위 후보를 그대로 태그로 사용 (§4.2 3-2 폴백) */
function statisticalFallback(
  candidates: TermStat[],
  termComments: Map<string, string[]>,
  byId: Map<string, CorpusComment>,
): LlmTag[] {
  return candidates.slice(0, EXTRACTION.minTags).map((candidate) => {
    const ids = termComments.get(candidate.term) ?? [];
    const scores = ids
      .map((id) => byId.get(id)?.sentimentScore)
      .filter((s): s is number => typeof s === 'number');
    const polarity = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return {
      name: candidate.term,
      aliases: [],
      category: '기타',
      polarity: Number(polarity.toFixed(3)),
    };
  });
}

interface AliasIndex {
  /** matchKey → tagId */
  exact: Map<string, number>;
  /** 부분 문자열 탐색용 (2글자 이상) */
  substrings: { key: string; tagId: number }[];
}

function buildAliasMap(ctx: StageContext['ctx'], tagIds: Set<number>): AliasIndex {
  const exact = new Map<string, number>();
  const substrings: { key: string; tagId: number }[] = [];
  for (const entry of loadAliases(ctx.db)) {
    if (!tagIds.has(entry.tagId)) continue;
    exact.set(entry.matchKey, entry.tagId);
    if (entry.matchKey.length >= 2) substrings.push({ key: entry.matchKey, tagId: entry.tagId });
  }
  return { exact, substrings };
}

/**
 * 토큰 정확 매칭 + 본문 부분 문자열 매칭을 합쳐 재현율을 확보한다.
 * (토큰만 쓰면 조사/띄어쓰기 변형을 놓치고, 부분 문자열만 쓰면 오탐이 는다)
 */
function reverseIndex(
  corpus: CorpusComment[],
  commentTerms: Map<string, Set<string>>,
  aliases: AliasIndex,
): { commentId: string; tagId: number; weight: number }[] {
  const out: { commentId: string; tagId: number; weight: number }[] = [];

  for (const comment of corpus) {
    const matched = new Map<number, number>();

    for (const term of commentTerms.get(comment.id) ?? []) {
      const tagId = aliases.exact.get(matchKey(term));
      if (tagId !== undefined) matched.set(tagId, Math.max(matched.get(tagId) ?? 0, 1));
    }

    const compact = matchKey(comment.text);
    for (const { key, tagId } of aliases.substrings) {
      if (matched.has(tagId)) continue;
      if (compact.includes(key)) matched.set(tagId, 0.6);
    }

    for (const [tagId, weight] of matched) {
      out.push({ commentId: comment.id, tagId, weight });
    }
  }
  return out;
}
