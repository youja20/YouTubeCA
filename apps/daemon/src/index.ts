import { hostname } from 'node:os';
import {
  claimJob,
  completeJob,
  failJob,
  heartbeat,
  reclaimStaleJobs,
  reconcileOrphanedRuns,
  releaseJobsOf,
  touchJobLock,
  type JobRecord,
} from '@youtubeca/db';
import { CODE_DEFAULTS } from '@youtubeca/shared';
import { createContext } from './context.js';
import { executeRun } from './pipeline/run.js';
import { CronScheduler } from './scheduler.js';

const VERSION = '1.0.0';
const workerId = `${hostname()}-${process.pid}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 다음 quota 리셋(태평양 표준시 자정)까지 남은 밀리초 */
function msUntilQuotaReset(now = new Date()): number {
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const elapsed =
    pacific.getHours() * 3_600_000 + pacific.getMinutes() * 60_000 + pacific.getSeconds() * 1000;
  // 리셋 직후로 잡지 않도록 1분 여유를 둔다
  return Math.max(60_000, 24 * 3_600_000 - elapsed + 60_000);
}

async function main(): Promise<void> {
  const ctx = createContext();
  ctx.log.info(`데몬 기동 (worker=${workerId}, db=${ctx.db.path})`);

  // 이전 프로세스가 비정상 종료하며 남긴 잡을 회수한다
  const released = releaseJobsOf(ctx.db, workerId);
  if (released > 0) ctx.log.info(`이전 세션의 잡 ${released}건 복구`);

  const scheduler = new CronScheduler(ctx);
  scheduler.start();

  let shuttingDown = false;
  let currentJob: JobRecord | null = null;

  // 잡 하나가 수 분씩 걸리므로 워커 루프에 하트비트를 얹으면 그동안 갱신이 멈춘다.
  // (API는 30초 넘게 조용하면 데몬이 죽은 것으로 보고 "실행 중이 아닙니다"를 띄운다)
  const pulse = setInterval(() => {
    heartbeat(ctx.db, currentJob?.id ?? null, VERSION);
    if (currentJob) touchJobLock(ctx.db, currentJob.id);
  }, CODE_DEFAULTS.daemonHeartbeatIntervalMs);
  pulse.unref?.();
  heartbeat(ctx.db, null, VERSION);

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    ctx.log.info(`${signal} 수신 — 현재 잡을 마치고 종료합니다`);
    scheduler.stop();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  while (!shuttingDown) {
    try {
      const reclaimed = reclaimStaleJobs(ctx.db);
      if (reclaimed > 0) ctx.log.warn(`좀비 잡 ${reclaimed}건 재큐`);

      // 잡이 죽었는데 Run만 대기로 남아 UI를 막는 상태를 정리한다
      const orphaned = reconcileOrphanedRuns(ctx.db);
      if (orphaned > 0) ctx.log.warn(`진행 주체가 없는 Run ${orphaned}건 정리`);

      currentJob = claimJob(ctx.db, workerId);
      heartbeat(ctx.db, currentJob?.id ?? null, VERSION);

      if (!currentJob) {
        await sleep(CODE_DEFAULTS.daemonPollIntervalMs);
        continue;
      }

      await handleJob(ctx, currentJob);
    } catch (error) {
      ctx.log.error(`워커 루프 오류: ${error instanceof Error ? error.message : String(error)}`);
      await sleep(CODE_DEFAULTS.daemonPollIntervalMs);
    } finally {
      currentJob = null;
    }
  }

  clearInterval(pulse);
  releaseJobsOf(ctx.db, workerId);
  heartbeat(ctx.db, null, VERSION);
  ctx.db.close();
  ctx.log.info('데몬 종료');
  process.exit(0);
}

async function handleJob(ctx: ReturnType<typeof createContext>, job: JobRecord): Promise<void> {
  if (job.type !== 'run') {
    failJob(ctx.db, job.id, `알 수 없는 잡 타입: ${job.type}`);
    return;
  }

  const runId = Number(job.payload.runId ?? job.runId);
  if (!Number.isFinite(runId)) {
    failJob(ctx.db, job.id, 'runId가 없습니다');
    return;
  }

  const result = await executeRun(ctx, runId);
  switch (result.outcome) {
    case 'done':
    case 'cancelled':
      completeJob(ctx.db, job.id);
      return;
    case 'paused_quota': {
      const delay = msUntilQuotaReset();
      ctx.log.info(`quota 리셋까지 ${Math.round(delay / 60000)}분 후 재개 예약`, { runId });
      failJob(ctx.db, job.id, result.error ?? 'quota 보류', delay);
      return;
    }
    case 'failed':
    default: {
      // 일시적 오류일 수 있으므로 2회까지 지수 백오프로 재시도한다
      if (job.attempts < 3) {
        failJob(ctx.db, job.id, result.error ?? '실패', 30_000 * 2 ** (job.attempts - 1));
      } else {
        failJob(ctx.db, job.id, result.error ?? '실패');
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
