/** 통합 테스트용 인메모리 DB 시드 (§10) */
import {
  openDatabase,
  runMigrations,
  seedDefaultSettings,
  upsertComments,
  upsertTag,
  upsertVideos,
  createKeyword,
  linkKeywordVideos,
  replaceCommentTags,
  replaceKeywordTags,
  refreshKeywordCounters,
  refreshTagCounters,
  type DbContext,
} from '@youtubeca/db';
import { analyzeSentiment, normalizeText } from '@youtubeca/shared';
import type { ApiContext } from './context.js';

export interface SeedResult {
  ctx: ApiContext;
  db: DbContext;
  keywordId: number;
  tagIds: Record<string, number>;
}

export function createTestContext(): SeedResult {
  const db = openDatabase(':memory:');
  runMigrations(db);
  seedDefaultSettings(db);

  const keyword = createKeyword(db, { name: '무선이어폰', note: '테스트' });

  upsertVideos(db, [
    {
      id: 'vid1',
      title: '무선이어폰 비교 리뷰',
      channelId: 'ch1',
      channelTitle: '테크채널',
      publishedAt: '2026-06-01T00:00:00Z',
      viewCount: 100_000,
      likeCount: 2000,
      commentCount: 500,
      thumbnailUrl: null,
      videoScore: 3.2,
    },
  ]);
  linkKeywordVideos(db, keyword.id, [{ videoId: 'vid1', rank: 1, score: 3.2 }]);

  const samples = [
    { id: 'c1', text: '가성비 최고예요 음질도 좋고', likes: 300 },
    { id: 'c2', text: '배터리가 너무 빨리 닳아서 실망', likes: 120 },
    { id: 'c3', text: '음질은 준수한데 가격이 비싸요', likes: 40 },
    { id: 'c4', text: '가성비 하나는 인정', likes: 10 },
  ];
  upsertComments(
    db,
    samples.map((sample) => {
      const { normalized } = normalizeText(sample.text);
      return {
        id: sample.id,
        videoId: 'vid1',
        parentId: null,
        author: '작성자',
        authorChannelId: null,
        textOriginal: sample.text,
        textNormalized: normalized,
        likeCount: sample.likes,
        replyCount: 0,
        publishedAt: '2026-06-02T00:00:00Z',
        updatedAtSource: null,
        lang: 'ko',
        sentimentScore: analyzeSentiment(normalized).score,
      };
    }),
  );

  const tagIds: Record<string, number> = {
    가성비: upsertTag(db, { name: '가성비', category: '가격', polarity: 0.6, aliases: ['혜자'] }),
    음질: upsertTag(db, { name: '음질', category: '품질', polarity: 0.4 }),
    배터리: upsertTag(db, { name: '배터리', category: '성능', polarity: -0.3 }),
  };

  replaceKeywordTags(db, keyword.id, null, [
    { tagId: tagIds['가성비']!, strength: 100, rawScore: 0.82, polarity: 0.6, commentCount: 2, freq: 0.5, distinctScore: 1, engage: 0.9, intensity: 0.5 },
    { tagId: tagIds['음질']!, strength: 70, rawScore: 0.61, polarity: 0.4, commentCount: 2, freq: 0.5, distinctScore: 0.7, engage: 0.7, intensity: 0.4 },
    { tagId: tagIds['배터리']!, strength: 30, rawScore: 0.31, polarity: -0.3, commentCount: 1, freq: 0.25, distinctScore: 0.3, engage: 0.4, intensity: 0.6 },
  ]);

  replaceCommentTags(db, keyword.id, [
    { commentId: 'c1', tagId: tagIds['가성비']!, weight: 1 },
    { commentId: 'c1', tagId: tagIds['음질']!, weight: 1 },
    { commentId: 'c2', tagId: tagIds['배터리']!, weight: 1 },
    { commentId: 'c3', tagId: tagIds['음질']!, weight: 1 },
    { commentId: 'c4', tagId: tagIds['가성비']!, weight: 1 },
  ]);

  refreshKeywordCounters(db, keyword.id);
  refreshTagCounters(db);

  return { ctx: { db, llm: null }, db, keywordId: keyword.id, tagIds };
}
