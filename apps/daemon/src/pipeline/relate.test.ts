import { describe, expect, it } from 'vitest';
import {
  createKeyword,
  getRelatedKeywords,
  openDatabase,
  replaceKeywordTags,
  runMigrations,
  upsertTag,
  type DbContext,
} from '@youtubeca/db';
import { computeRelations } from './relate.js';

const silentLog = { info: () => undefined };

function tagRow(tagId: number, rawScore: number) {
  return {
    tagId,
    strength: Math.round(rawScore * 100),
    rawScore,
    polarity: 0,
    commentCount: 10,
    freq: 0,
    distinctScore: 0,
    engage: 0,
    intensity: 0,
  };
}

function seed(): { db: DbContext; ids: Record<string, number> } {
  const db = openDatabase(':memory:');
  runMigrations(db);

  const 이어폰 = createKeyword(db, { name: '무선이어폰' });
  const 스피커 = createKeyword(db, { name: '블루투스스피커' });
  const 노트북 = createKeyword(db, { name: '노트북' });

  const 음질 = upsertTag(db, { name: '음질' });
  const 가성비 = upsertTag(db, { name: '가성비' });
  const 배터리 = upsertTag(db, { name: '배터리' });
  const 키보드 = upsertTag(db, { name: '키보드' });

  // 이어폰과 스피커는 음질·가성비를 공유하고, 스피커 쪽 음질이 더 강하다
  replaceKeywordTags(db, 이어폰.id, null, [tagRow(음질, 0.5), tagRow(가성비, 0.4), tagRow(배터리, 0.3)]);
  replaceKeywordTags(db, 스피커.id, null, [tagRow(음질, 0.9), tagRow(가성비, 0.35)]);
  replaceKeywordTags(db, 노트북.id, null, [tagRow(키보드, 0.8)]);

  return {
    db,
    ids: { 이어폰: 이어폰.id, 스피커: 스피커.id, 노트북: 노트북.id, 음질, 가성비 },
  };
}

describe('computeRelations (§4.3)', () => {
  it('태그 벡터가 겹치는 키워드를 관련 키워드로 연결한다', () => {
    const { db, ids } = seed();
    const result = computeRelations({ db }, silentLog);
    expect(result.keywords).toBe(3);
    expect(result.relations).toBeGreaterThan(0);

    const related = getRelatedKeywords(db, ids['이어폰']!);
    expect(related.map((r) => r.name)).toContain('블루투스스피커');
    // 공유 태그가 전혀 없는 노트북은 연결되지 않는다
    expect(related.map((r) => r.name)).not.toContain('노트북');
    db.close();
  });

  it('상대 키워드에서 더 강한 태그를 근거로 표시한다', () => {
    const { db, ids } = seed();
    computeRelations({ db }, silentLog);

    const [speaker] = getRelatedKeywords(db, ids['이어폰']!);
    const 음질 = speaker!.sharedTags.find((t) => t.name === '음질');
    expect(음질?.stronger).toBe('other'); // 스피커 0.9 > 이어폰 0.5
    const 가성비 = speaker!.sharedTags.find((t) => t.name === '가성비');
    expect(가성비?.stronger).toBe('self'); // 이어폰 0.4 > 스피커 0.35
    db.close();
  });

  it('키워드가 3개 미만이면 계산을 건너뛴다', () => {
    const db = openDatabase(':memory:');
    runMigrations(db);
    const only = createKeyword(db, { name: '단일키워드' });
    replaceKeywordTags(db, only.id, null, [tagRow(upsertTag(db, { name: '태그' }), 0.5)]);

    const result = computeRelations({ db }, silentLog);
    expect(result.relations).toBe(0);
    expect(getRelatedKeywords(db, only.id)).toEqual([]);
    db.close();
  });
});
