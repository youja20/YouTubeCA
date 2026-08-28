import { describe, expect, it } from 'vitest';
import { openDatabase, type DbContext } from '../client.js';
import { runMigrations } from '../migrate.js';
import { createKeyword } from './keywords.js';
import { claimJob, createRun, getRun, getRunDetail, reconcileOrphanedRuns, requestCancel } from './runs.js';
import { seedDefaultSettings } from './settings.js';

function freshDb(): DbContext {
  const db = openDatabase(':memory:');
  runMigrations(db);
  seedDefaultSettings(db);
  return db;
}

function jobStatus(db: DbContext, runId: number): string {
  return (db.sqlite.prepare('SELECT status FROM jobs WHERE run_id = ?').get(runId) as { status: string }).status;
}

describe('requestCancel (§8.1)', () => {
  it('워커가 집어가기 전에 취소하면 Run까지 즉시 종료한다', () => {
    const db = freshDb();
    const keyword = createKeyword(db, { name: '테스트' });
    const run = createRun(db, { keywordIds: [keyword.id], trigger: 'manual' });

    expect(requestCancel(db, run.id)).toBe(true);

    // 잡만 죽고 Run이 queued로 남으면 UI가 영구히 "대기"로 잠긴다
    expect(getRun(db, run.id)?.status).toBe('cancelled');
    expect(jobStatus(db, run.id)).toBe('failed');
    const stages = getRunDetail(db, run.id)?.stages ?? [];
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.every((s) => s.status === 'skipped')).toBe(true);
    db.close();
  });

  it('워커가 진행 중이면 Run 종료는 데몬에 맡긴다', () => {
    const db = freshDb();
    const keyword = createKeyword(db, { name: '테스트' });
    const run = createRun(db, { keywordIds: [keyword.id], trigger: 'manual' });
    claimJob(db, 'worker-1');

    expect(requestCancel(db, run.id)).toBe(true);
    expect(getRun(db, run.id)?.status).toBe('queued');
    expect(jobStatus(db, run.id)).toBe('running');
    db.close();
  });

  it('이미 끝난 Run은 취소할 수 없다', () => {
    const db = freshDb();
    const keyword = createKeyword(db, { name: '테스트' });
    const run = createRun(db, { keywordIds: [keyword.id], trigger: 'manual' });
    requestCancel(db, run.id);

    expect(requestCancel(db, run.id)).toBe(false);
    db.close();
  });
});

describe('reconcileOrphanedRuns', () => {
  it('잡이 죽었는데 대기로 남은 Run을 실패로 정리한다', () => {
    const db = freshDb();
    const keyword = createKeyword(db, { name: '테스트' });
    const run = createRun(db, { keywordIds: [keyword.id], trigger: 'manual' });
    db.sqlite.prepare(`UPDATE jobs SET status = 'failed', last_error = '터짐' WHERE run_id = ?`).run(run.id);

    expect(reconcileOrphanedRuns(db)).toBe(1);
    expect(getRun(db, run.id)?.status).toBe('failed');
    expect(getRun(db, run.id)?.error).toBe('터짐');
    db.close();
  });

  it('취소 요청이 있던 Run은 취소로 정리한다', () => {
    const db = freshDb();
    const keyword = createKeyword(db, { name: '테스트' });
    const run = createRun(db, { keywordIds: [keyword.id], trigger: 'manual' });
    db.sqlite.prepare('UPDATE runs SET cancel_requested = 1 WHERE id = ?').run(run.id);
    db.sqlite.prepare(`UPDATE jobs SET status = 'failed' WHERE run_id = ?`).run(run.id);

    expect(reconcileOrphanedRuns(db)).toBe(1);
    expect(getRun(db, run.id)?.status).toBe('cancelled');
    db.close();
  });

  it('데몬을 기다리는 정상 대기 Run은 건드리지 않는다', () => {
    const db = freshDb();
    const keyword = createKeyword(db, { name: '테스트' });
    const run = createRun(db, { keywordIds: [keyword.id], trigger: 'manual' });

    expect(reconcileOrphanedRuns(db)).toBe(0);
    expect(getRun(db, run.id)?.status).toBe('queued');
    db.close();
  });

  it('워커가 잡을 물고 있는 Run은 건드리지 않는다', () => {
    const db = freshDb();
    const keyword = createKeyword(db, { name: '테스트' });
    const run = createRun(db, { keywordIds: [keyword.id], trigger: 'manual' });
    claimJob(db, 'worker-1');

    expect(reconcileOrphanedRuns(db)).toBe(0);
    expect(getRun(db, run.id)?.status).toBe('queued');
    db.close();
  });
});
