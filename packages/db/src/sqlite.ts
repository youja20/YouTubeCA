import type { DatabaseSync as DatabaseSyncType, SQLInputValue, StatementSync } from 'node:sqlite';

/**
 * Node 내장 `node:sqlite` 위에 better-sqlite3 호환 API를 얹은 얇은 래퍼.
 *
 * CentOS 7(glibc 2.17)에서는 better-sqlite3 prebuild가 로드되지 않고 소스 빌드도 불가해
 * 네이티브 의존성을 없애기 위해 도입했다 (이슈 #1). 저장소 코드가 실제로 쓰는
 * prepare/run/get/all/exec/pragma/transaction/close 만 흉내낸다.
 */

// 정적 import 대신 getBuiltinModule을 쓴다: vite 5(vitest)가 `node:` 접두사를 떼어
// 'sqlite'로 해석하다 실패하기 때문이다 (접두사 전용 내장 모듈 미지원).
const { DatabaseSync } = process.getBuiltinModule('node:sqlite');

/** better-sqlite3와 같이 느슨하게 받는다 — 바인딩 불가 값은 실행 시 node:sqlite가 거부한다 */
type BindArg = unknown;

/** readBigInts를 켜지 않으므로 둘 다 number로 온다 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export class Statement {
  constructor(private readonly stmt: StatementSync) {
    // better-sqlite3처럼 SQL에 없는 키가 섞인 객체도 바인딩을 허용한다
    stmt.setAllowUnknownNamedParameters(true);
  }

  run(...params: BindArg[]): RunResult {
    return this.stmt.run(...(params as SQLInputValue[])) as RunResult;
  }

  get(...params: BindArg[]): unknown {
    return this.stmt.get(...(params as SQLInputValue[]));
  }

  all(...params: BindArg[]): unknown[] {
    return this.stmt.all(...(params as SQLInputValue[]));
  }
}

type TxFn = (...args: any[]) => any;

export class Database {
  private readonly db: DatabaseSyncType;
  private savepointSeq = 0;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  exec(sql: string): this {
    this.db.exec(sql);
    return this;
  }

  /** `pragma('journal_mode = WAL')` 형태. `simple`이면 첫 행의 첫 값만 돌려준다 */
  pragma(source: string, options?: { simple?: boolean }): unknown {
    const rows = this.db.prepare(`PRAGMA ${source}`).all();
    if (!options?.simple) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  }

  /**
   * better-sqlite3의 `db.transaction(fn)`과 같다: 감싼 함수를 돌려주고, 호출 시 BEGIN/COMMIT,
   * 예외가 나면 ROLLBACK 후 다시 던진다. 트랜잭션 안에서 다시 호출되면 SAVEPOINT로 중첩한다.
   */
  transaction<F extends TxFn>(fn: F): F {
    const wrapped = (...args: Parameters<F>): ReturnType<F> => {
      if (this.db.isTransaction) {
        const name = `sp_${++this.savepointSeq}`;
        this.db.exec(`SAVEPOINT ${name}`);
        try {
          const result = fn(...args);
          this.db.exec(`RELEASE ${name}`);
          return result;
        } catch (err) {
          this.db.exec(`ROLLBACK TO ${name}`);
          this.db.exec(`RELEASE ${name}`);
          throw err;
        }
      }
      this.db.exec('BEGIN');
      try {
        const result = fn(...args);
        this.db.exec('COMMIT');
        return result;
      } catch (err) {
        if (this.db.isTransaction) this.db.exec('ROLLBACK');
        throw err;
      }
    };
    return wrapped as F;
  }

  close(): void {
    this.db.close();
  }
}
