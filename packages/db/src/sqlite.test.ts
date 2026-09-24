import { describe, expect, it } from 'vitest';
import { Database } from './sqlite.js';

function makeDb(): Database {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
  return db;
}

const count = (db: Database): number => (db.prepare('SELECT COUNT(*) AS n FROM t').get() as { n: number }).n;

describe('node:sqlite 호환 래퍼', () => {
  it('run은 changes/lastInsertRowid를 number로 돌려준다', () => {
    const db = makeDb();
    const info = db.prepare('INSERT INTO t(name) VALUES (?)').run('a');
    expect(info).toEqual({ changes: 1, lastInsertRowid: 1 });
  });

  it('SQL에 없는 키가 섞인 객체도 named parameter로 바인딩한다', () => {
    const db = makeDb();
    db.prepare('INSERT INTO t(name) VALUES (@name)').run({ name: 'a', extra: 1 });
    expect(db.prepare('SELECT name FROM t').get()).toMatchObject({ name: 'a' });
  });

  it('transaction은 인자와 반환값을 전달하고 예외 시 롤백한다', () => {
    const db = makeDb();
    const insert = db.prepare('INSERT INTO t(name) VALUES (?)');
    const tx = db.transaction((names: string[]) => {
      for (const n of names) insert.run(n);
      return names.length;
    });
    expect(tx(['a', 'b'])).toBe(2);

    const failing = db.transaction(() => {
      insert.run('c');
      throw new Error('boom');
    });
    expect(() => failing()).toThrow('boom');
    expect(count(db)).toBe(2);
  });

  it('중첩 transaction은 SAVEPOINT로 안쪽만 롤백할 수 있다', () => {
    const db = makeDb();
    const insert = db.prepare('INSERT INTO t(name) VALUES (?)');
    const inner = db.transaction(() => {
      insert.run('inner');
      throw new Error('inner');
    });
    const outer = db.transaction(() => {
      insert.run('outer');
      expect(() => inner()).toThrow('inner');
    });
    outer();
    expect(db.prepare('SELECT name FROM t').all()).toMatchObject([{ name: 'outer' }]);
  });

  it('pragma simple은 첫 값만 돌려준다', () => {
    const db = makeDb();
    db.pragma('foreign_keys = ON');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});
