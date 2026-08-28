import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYWORDS } from '@youtubeca/shared';
import { openDatabase, type DbContext } from '../client.js';
import { runMigrations } from '../migrate.js';
import { createKeyword, deleteKeyword, listKeywords, seedDefaultKeywords } from './keywords.js';
import { seedDefaultSettings } from './settings.js';

function freshDb(): DbContext {
  const db = openDatabase(':memory:');
  runMigrations(db);
  seedDefaultSettings(db);
  return db;
}

describe('seedDefaultKeywords (§7.4 ①)', () => {
  it('최초 1회에 기본 키워드를 모두 등록한다', () => {
    const db = freshDb();
    const result = seedDefaultKeywords(db, DEFAULT_KEYWORDS);

    expect(result.applied).toBe(true);
    expect(result.created.map((k) => k.name)).toEqual([...DEFAULT_KEYWORDS]);
    expect(listKeywords(db, { sort: 'name' })).toHaveLength(DEFAULT_KEYWORDS.length);
    db.close();
  });

  it('두 번째 호출은 아무것도 하지 않는다 (기동마다 반복 등록 방지)', () => {
    const db = freshDb();
    seedDefaultKeywords(db, DEFAULT_KEYWORDS);
    const second = seedDefaultKeywords(db, DEFAULT_KEYWORDS);

    expect(second.applied).toBe(false);
    expect(second.created).toEqual([]);
    expect(listKeywords(db, { sort: 'name' })).toHaveLength(DEFAULT_KEYWORDS.length);
    db.close();
  });

  it('사용자가 지운 기본 키워드는 되살아나지 않는다', () => {
    const db = freshDb();
    const seeded = seedDefaultKeywords(db, DEFAULT_KEYWORDS);
    const removed = seeded.created[0]!;
    expect(deleteKeyword(db, removed.id)).toBe(true);

    seedDefaultKeywords(db, DEFAULT_KEYWORDS);
    expect(listKeywords(db, { sort: 'name' }).map((k) => k.name)).not.toContain(removed.name);
    db.close();
  });

  it('이미 같은 이름이 있으면 건너뛴다', () => {
    const db = freshDb();
    createKeyword(db, { name: 'BTS', note: '사용자가 먼저 등록' });
    const result = seedDefaultKeywords(db, DEFAULT_KEYWORDS);

    expect(result.skipped).toEqual(['BTS']);
    expect(listKeywords(db, { sort: 'name' })).toHaveLength(DEFAULT_KEYWORDS.length);
    // 기존 키워드의 note가 덮어써지지 않는다
    expect(listKeywords(db, { sort: 'name', q: 'BTS' })[0]!.note).toBe('사용자가 먼저 등록');
    db.close();
  });

  it('force 옵션은 마커를 무시하고 다시 시드한다', () => {
    const db = freshDb();
    seedDefaultKeywords(db, DEFAULT_KEYWORDS);
    deleteKeyword(db, listKeywords(db, { sort: 'name' })[0]!.id);

    const forced = seedDefaultKeywords(db, DEFAULT_KEYWORDS, { force: true });
    expect(forced.applied).toBe(true);
    expect(forced.created).toHaveLength(1);
    db.close();
  });

  it('시드된 키워드는 아직 수집 전 상태다 (자동 크롤링 없음)', () => {
    const db = freshDb();
    const result = seedDefaultKeywords(db, DEFAULT_KEYWORDS);
    expect(result.created.every((k) => k.lastCrawledAt === null)).toBe(true);
    expect(result.created.every((k) => k.isActive)).toBe(true);
    db.close();
  });
});
