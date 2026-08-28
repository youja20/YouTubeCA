import { loadAllTagVectors, replaceKeywordRelations, type DbContext } from '@youtubeca/db';
import { RELATION } from '@youtubeca/shared';
import { cosineSimilarity } from './scoring.js';

export interface RelateResult {
  keywords: number;
  relations: number;
}

/**
 * 관련 키워드 산출 (§4.3, 요구사항 6.1.3)
 * 태그 강도 벡터(raw_score)의 코사인 유사도 상위 K개 + 근거 태그를 함께 저장한다.
 */
/** 로거는 파이프라인 밖(테스트)에서도 쓸 수 있도록 최소 인터페이스만 요구한다 */
export interface RelateLogger {
  info(message: string, meta?: unknown): void;
}

export function computeRelations(ctx: { db: DbContext }, log: RelateLogger): RelateResult {
  const rows = loadAllTagVectors(ctx.db);
  const vectors = new Map<number, Map<number, number>>();
  const names = new Map<number, string>();

  for (const row of rows) {
    const vector = vectors.get(row.keywordId) ?? new Map<number, number>();
    vector.set(row.tagId, row.rawScore);
    vectors.set(row.keywordId, vector);
  }

  const keywordIds = [...vectors.keys()];
  if (keywordIds.length < RELATION.minKeywordsForSection) {
    log.info(`키워드가 ${keywordIds.length}개뿐이라 관련 키워드 계산을 건너뜁니다`);
    replaceKeywordRelations(ctx.db, []);
    return { keywords: keywordIds.length, relations: 0 };
  }

  const tagNames = new Map<number, string>(
    (
      ctx.db.sqlite.prepare('SELECT id, name FROM tags').all() as { id: number; name: string }[]
    ).map((r) => [r.id, r.name]),
  );
  for (const r of ctx.db.sqlite.prepare('SELECT id, name FROM keywords').all() as {
    id: number;
    name: string;
  }[]) {
    names.set(r.id, r.name);
  }

  const relations: {
    keywordId: number;
    relatedKeywordId: number;
    similarity: number;
    sharedTags: unknown;
  }[] = [];

  for (const keywordId of keywordIds) {
    const self = vectors.get(keywordId)!;
    const scored: { id: number; similarity: number }[] = [];

    for (const otherId of keywordIds) {
      if (otherId === keywordId) continue;
      const similarity = cosineSimilarity(self, vectors.get(otherId)!);
      if (similarity >= RELATION.minSimilarity) scored.push({ id: otherId, similarity });
    }

    scored.sort((a, b) => b.similarity - a.similarity);

    for (const { id: otherId, similarity } of scored.slice(0, RELATION.topK)) {
      const other = vectors.get(otherId)!;
      // "이 태그가 더 강하게 나타나는 다른 키워드"를 보여주기 위한 근거 (요구사항 6.1.3)
      const sharedTags = [...self.entries()]
        .filter(([tagId]) => other.has(tagId))
        .map(([tagId, selfRaw]) => {
          const otherRaw = other.get(tagId)!;
          return {
            tagId,
            name: tagNames.get(tagId) ?? String(tagId),
            selfRaw: Number(selfRaw.toFixed(6)),
            otherRaw: Number(otherRaw.toFixed(6)),
            stronger: otherRaw > selfRaw ? 'other' : 'self',
          };
        })
        .sort((a, b) => b.otherRaw - a.otherRaw)
        .slice(0, 8);

      relations.push({
        keywordId,
        relatedKeywordId: otherId,
        similarity: Number(similarity.toFixed(4)),
        sharedTags,
      });
    }
  }

  replaceKeywordRelations(ctx.db, relations);
  log.info(`관련 키워드 ${relations.length}쌍 산출 (키워드 ${keywordIds.length}개)`);
  return { keywords: keywordIds.length, relations: relations.length };
}
