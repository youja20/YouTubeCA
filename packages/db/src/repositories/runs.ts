import { CODE_DEFAULTS, STAGES, type RunDetail, type RunDto, type RunStageDto, type RunStatus, type Stage } from '@youtubeca/shared';
import type { DbContext } from '../client.js';

interface RunRowRaw {
  id: number;
  trigger: string;
  status: string;
  keyword_ids: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  cancel_requested: number;
  created_at: string;
}

function toRunDto(row: RunRowRaw): RunDto {
  let keywordIds: number[] = [];
  try {
    const parsed: unknown = JSON.parse(row.keyword_ids);
    if (Array.isArray(parsed)) keywordIds = parsed.filter((v): v is number => typeof v === 'number');
  } catch {
    keywordIds = [];
  }
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status as RunStatus,
    keywordIds,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    createdAt: row.created_at,
  };
}

/* ─────────────────────────── Run ─────────────────────────── */

export function createRun(
  ctx: DbContext,
  input: { keywordIds: number[]; trigger: string; stages?: readonly Stage[] },
): RunDto {
  // 재분석처럼 일부 스테이지만 돌리는 경우를 위해 스테이지 부분집합을 허용한다
  const stages = (input.stages ?? STAGES).filter((s) => STAGES.includes(s));
  const tx = ctx.sqlite.transaction(() => {
    const run = ctx.sqlite
      .prepare(`INSERT INTO runs(trigger, status, keyword_ids) VALUES (?, 'queued', ?) RETURNING *`)
      .get(input.trigger, JSON.stringify(input.keywordIds)) as RunRowRaw;

    const stageStmt = ctx.sqlite.prepare(
      `INSERT OR IGNORE INTO run_stages(run_id, keyword_id, stage, status) VALUES (?, ?, ?, 'pending')`,
    );
    for (const keywordId of input.keywordIds) {
      for (const stage of stages) stageStmt.run(run.id, keywordId, stage);
    }
    // 키워드 간 유사도(관련 키워드)는 전체 키워드가 끝난 뒤 1회 수행한다
    ctx.sqlite
      .prepare(
        `INSERT OR IGNORE INTO jobs(run_id, type, payload) VALUES (?, 'run', ?)`,
      )
      .run(run.id, JSON.stringify({ runId: run.id }));
    return run;
  });
  return toRunDto(tx());
}

export function getRun(ctx: DbContext, id: number): RunDto | null {
  const row = ctx.sqlite.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRowRaw | undefined;
  return row ? toRunDto(row) : null;
}

export function listRuns(ctx: DbContext, params: { limit?: number; cursor?: number; status?: string }): RunDto[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (params.status) {
    where.push('status = ?');
    args.push(params.status);
  }
  if (params.cursor !== undefined) {
    where.push('id < ?');
    args.push(params.cursor);
  }
  const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = ctx.sqlite
    .prepare(`SELECT * FROM runs ${clause} ORDER BY id DESC LIMIT ?`)
    .all(...args, Math.min(params.limit ?? 20, 200)) as RunRowRaw[];
  return rows.map(toRunDto);
}

export function getRunDetail(ctx: DbContext, id: number): RunDetail | null {
  const run = getRun(ctx, id);
  if (!run) return null;
  const stages = ctx.sqlite
    .prepare(
      `SELECT s.*, k.name AS keyword_name
       FROM run_stages s LEFT JOIN keywords k ON k.id = s.keyword_id
       WHERE s.run_id = ? ORDER BY s.keyword_id, s.id`,
    )
    .all(id) as (RunStageDto & { keyword_id: number | null; keyword_name: string | null; started_at: string | null; finished_at: string | null })[];

  const keywords = run.keywordIds.length
    ? (ctx.sqlite
        .prepare(
          `SELECT id, name FROM keywords WHERE id IN (${run.keywordIds.map(() => '?').join(',')})`,
        )
        .all(...run.keywordIds) as { id: number; name: string }[])
    : [];

  return {
    ...run,
    keywords,
    stages: stages.map((s) => ({
      id: s.id,
      keywordId: s.keyword_id,
      keywordName: s.keyword_name,
      stage: s.stage as Stage,
      status: s.status,
      progress: s.progress,
      message: s.message,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
    })),
  };
}

export function updateRunStatus(
  ctx: DbContext,
  id: number,
  status: RunStatus,
  patch: { error?: string | null; startedAt?: string; finishedAt?: string } = {},
): void {
  const sets = ['status = ?'];
  const args: unknown[] = [status];
  if (patch.error !== undefined) {
    sets.push('error = ?');
    args.push(patch.error);
  }
  if (patch.startedAt !== undefined) {
    sets.push('started_at = ?');
    args.push(patch.startedAt);
  }
  if (patch.finishedAt !== undefined) {
    sets.push('finished_at = ?');
    args.push(patch.finishedAt);
  }
  ctx.sqlite.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
}

export function requestCancel(ctx: DbContext, id: number): boolean {
  const tx = ctx.sqlite.transaction(() => {
    const info = ctx.sqlite
      .prepare(`UPDATE runs SET cancel_requested = 1 WHERE id = ? AND status IN ('queued','running','paused_quota')`)
      .run(id);
    if (info.changes === 0) return false;

    // 아직 워커가 집어가지 않은 잡은 여기서 폐기한다
    ctx.sqlite
      .prepare(
        `UPDATE jobs SET status = 'failed', locked_at = NULL, locked_by = NULL, last_error = '사용자 취소'
          WHERE run_id = ? AND status = 'queued'`,
      )
      .run(id);

    // 워커가 붙잡고 있는 잡이 있으면 데몬이 cancel_requested를 보고 Run을 종료한다.
    // 없으면 Run을 끝내 줄 주체가 없으므로(데몬 미기동·큐 대기 중 취소) 여기서 직접 종료한다.
    const held = ctx.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM jobs WHERE run_id = ? AND status = 'running'`)
      .get(id) as { n: number };
    if (held.n === 0) finalizeAbandonedRun(ctx, id, 'cancelled', '사용자 취소');
    return true;
  });
  return tx();
}

/** 진행 주체가 없는 Run을 종료 상태로 고정하고 남은 스테이지를 건너뜀 처리한다 */
function finalizeAbandonedRun(
  ctx: DbContext,
  id: number,
  status: Extract<RunStatus, 'cancelled' | 'failed'>,
  error: string,
): void {
  ctx.sqlite
    .prepare(
      `UPDATE runs
          SET status = ?, error = ?, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
    )
    .run(status, error, id);
  ctx.sqlite
    .prepare(
      `UPDATE run_stages
          SET status = 'skipped', finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), message = ?
        WHERE run_id = ? AND status IN ('pending','running')`,
    )
    .run(error, id);
}

/**
 * 잡이 죽었는데 Run만 queued/running으로 남은 고아 Run을 정리한다.
 * 이 상태를 방치하면 UI가 계속 "대기"로 보이고 새 실행 버튼이 잠긴다.
 * 정상적으로 대기 중인 Run은 queued/running 잡을 갖고 있어 대상에서 제외된다.
 */
export function reconcileOrphanedRuns(ctx: DbContext): number {
  const orphans = ctx.sqlite
    .prepare(
      `SELECT r.id AS id,
              r.cancel_requested AS cancel_requested,
              (SELECT j.last_error FROM jobs j
                WHERE j.run_id = r.id ORDER BY j.id DESC LIMIT 1) AS last_error
         FROM runs r
        WHERE r.status IN ('queued','running','paused_quota')
          AND NOT EXISTS (
            SELECT 1 FROM jobs j
             WHERE j.run_id = r.id AND j.status IN ('queued','running')
          )`,
    )
    .all() as { id: number; cancel_requested: number; last_error: string | null }[];

  const tx = ctx.sqlite.transaction(() => {
    for (const row of orphans) {
      if (row.cancel_requested === 1) {
        finalizeAbandonedRun(ctx, row.id, 'cancelled', '사용자 취소');
      } else {
        finalizeAbandonedRun(ctx, row.id, 'failed', row.last_error ?? '잡이 소실되어 중단됨');
      }
    }
  });
  tx();
  return orphans.length;
}

export function isCancelRequested(ctx: DbContext, runId: number): boolean {
  const row = ctx.sqlite.prepare('SELECT cancel_requested FROM runs WHERE id = ?').get(runId) as
    | { cancel_requested: number }
    | undefined;
  return row?.cancel_requested === 1;
}

/* ─────────────────────────── Stage ─────────────────────────── */

export function updateStage(
  ctx: DbContext,
  input: {
    runId: number;
    keywordId: number | null;
    stage: Stage;
    status?: RunStageDto['status'];
    progress?: number;
    message?: string | null;
  },
): void {
  const existing = ctx.sqlite
    .prepare(
      `SELECT id FROM run_stages WHERE run_id = ? AND keyword_id IS ? AND stage = ?`,
    )
    .get(input.runId, input.keywordId, input.stage) as { id: number } | undefined;

  if (!existing) {
    ctx.sqlite
      .prepare(
        `INSERT INTO run_stages(run_id, keyword_id, stage, status, progress, message)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.runId,
        input.keywordId,
        input.stage,
        input.status ?? 'pending',
        input.progress ?? 0,
        input.message ?? null,
      );
    return;
  }

  const sets: string[] = [];
  const args: unknown[] = [];
  if (input.status) {
    sets.push('status = ?');
    args.push(input.status);
    if (input.status === 'running') sets.push(`started_at = COALESCE(started_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
    if (input.status === 'done' || input.status === 'failed' || input.status === 'skipped') {
      sets.push(`finished_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
    }
  }
  if (input.progress !== undefined) {
    sets.push('progress = ?');
    args.push(Math.max(0, Math.min(100, Math.round(input.progress))));
  }
  if (input.message !== undefined) {
    sets.push('message = ?');
    args.push(input.message);
  }
  if (sets.length === 0) return;
  ctx.sqlite.prepare(`UPDATE run_stages SET ${sets.join(', ')} WHERE id = ?`).run(...args, existing.id);
}

/* ─────────────────────────── Job 큐 (§8.1) ─────────────────────────── */

export interface JobRecord {
  id: number;
  runId: number | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export function enqueueJob(
  ctx: DbContext,
  input: { runId?: number | null; type: string; payload?: Record<string, unknown> },
): number {
  const row = ctx.sqlite
    .prepare(`INSERT INTO jobs(run_id, type, payload) VALUES (?, ?, ?) RETURNING id`)
    .get(input.runId ?? null, input.type, JSON.stringify(input.payload ?? {})) as { id: number };
  return row.id;
}

/** 원자적 클레임 (UPDATE ... RETURNING) */
export function claimJob(ctx: DbContext, workerId: string): JobRecord | null {
  const row = ctx.sqlite
    .prepare(
      `UPDATE jobs
         SET status = 'running',
             locked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             locked_by = ?,
             attempts = attempts + 1
       WHERE id = (
         SELECT id FROM jobs
          WHERE status = 'queued'
            AND available_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
          ORDER BY id LIMIT 1
       )
       RETURNING id, run_id, type, payload, attempts`,
    )
    .get(workerId) as
    | { id: number; run_id: number | null; type: string; payload: string; attempts: number }
    | undefined;
  if (!row) return null;
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return { id: row.id, runId: row.run_id, type: row.type, payload, attempts: row.attempts };
}

export function completeJob(ctx: DbContext, id: number): void {
  ctx.sqlite.prepare(`UPDATE jobs SET status = 'done', locked_at = NULL WHERE id = ?`).run(id);
}

export function failJob(ctx: DbContext, id: number, error: string, retryInMs?: number): void {
  if (retryInMs !== undefined) {
    ctx.sqlite
      .prepare(
        `UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = ?,
           available_at = strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
         WHERE id = ?`,
      )
      .run(error, `+${Math.round(retryInMs / 1000)} seconds`, id);
    return;
  }
  ctx.sqlite
    .prepare(`UPDATE jobs SET status = 'failed', locked_at = NULL, last_error = ? WHERE id = ?`)
    .run(error, id);
}

/** 좀비 잡 회수 — locked_at이 임계 시간 이상 지난 running 잡을 재큐 (§8.1) */
export function reclaimStaleJobs(ctx: DbContext, timeoutMs = CODE_DEFAULTS.jobLockTimeoutMs): number {
  const info = ctx.sqlite
    .prepare(
      `UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL
        WHERE status = 'running'
          AND locked_at IS NOT NULL
          AND locked_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)`,
    )
    .run(`-${Math.round(timeoutMs / 1000)} seconds`);
  return info.changes;
}

/** SIGTERM 등으로 종료된 워커의 잡을 되돌린다 */
export function releaseJobsOf(ctx: DbContext, workerId: string): number {
  const info = ctx.sqlite
    .prepare(
      `UPDATE jobs SET status = 'queued', locked_at = NULL, locked_by = NULL
        WHERE status = 'running' AND locked_by = ?`,
    )
    .run(workerId);
  return info.changes;
}

/**
 * 실행 중인 잡의 락 시각을 갱신한다.
 * 크롤링 한 건이 jobLockTimeoutMs를 넘겨도 reclaimStaleJobs가 좀비로 오인해
 * 같은 Run을 다시 큐에 넣지 않도록, 하트비트와 함께 주기적으로 호출한다.
 */
export function touchJobLock(ctx: DbContext, jobId: number): void {
  ctx.sqlite
    .prepare(
      `UPDATE jobs SET locked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ? AND status = 'running'`,
    )
    .run(jobId);
}

export function heartbeat(ctx: DbContext, jobId: number | null, version: string): void {
  ctx.sqlite
    .prepare(
      `UPDATE daemon_state
          SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), current_job_id = ?, version = ?
        WHERE id = 1`,
    )
    .run(jobId, version);
}

export function getDaemonState(ctx: DbContext): { lastSeenAt: string | null; currentJobId: number | null } {
  const row = ctx.sqlite.prepare('SELECT last_seen_at, current_job_id FROM daemon_state WHERE id = 1').get() as
    | { last_seen_at: string | null; current_job_id: number | null }
    | undefined;
  return { lastSeenAt: row?.last_seen_at ?? null, currentJobId: row?.current_job_id ?? null };
}
