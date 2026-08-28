import {
  getKeyword,
  getRunDetail,
  isCancelRequested,
  markCrawled,
  updateRunStatus,
  updateStage,
} from '@youtubeca/db';
import { CODE_DEFAULTS, STAGE_LABELS, STAGES, type Keyword, type Stage } from '@youtubeca/shared';
import { QuotaExhaustedError, YouTubeApiError } from '@youtubeca/youtube';
import type { DaemonContext } from '../context.js';
import { analyzeStage } from './analyze.js';
import { collectStage } from './collect.js';
import { discoverStage } from './discover.js';
import { extractStage } from './extract.js';
import { computeRelations } from './relate.js';
import { scoreStage } from './score.js';
import { CancelledError, isCancellation, type StageContext } from './types.js';

export type RunOutcome = 'done' | 'cancelled' | 'paused_quota' | 'failed';

export interface RunResult {
  outcome: RunOutcome;
  error?: string;
}

class QuotaPausedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaPausedError';
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 하나의 Run(키워드 N개 × 5 스테이지)을 실행한다 (§4, §8.1) */
export async function executeRun(ctx: DaemonContext, runId: number): Promise<RunResult> {
  const detail = getRunDetail(ctx.db, runId);
  if (!detail) return { outcome: 'failed', error: `Run ${runId}을 찾을 수 없습니다` };

  const runLog = ctx.log.child({ runId });
  updateRunStatus(ctx.db, runId, 'running', { startedAt: nowIso(), error: null });
  runLog.info(`Run 시작 — 키워드 ${detail.keywordIds.length}개`, { keywordIds: detail.keywordIds });

  const doneStages = new Set(
    detail.stages.filter((s) => s.status === 'done').map((s) => `${s.keywordId}:${s.stage}`),
  );
  // Run에 등록된 스테이지만 수행한다 (재분석 Run은 extract~analyze만 등록됨)
  const plannedStages = new Map<number, Stage[]>();
  for (const row of detail.stages) {
    if (row.keywordId === null) continue;
    const list = plannedStages.get(row.keywordId) ?? [];
    list.push(row.stage);
    plannedStages.set(row.keywordId, list);
  }

  // 취소를 스테이지 경계에서만 확인하면 수 분짜리 LLM 호출 중에는 반응하지 못한다.
  // 별도 폴러가 cancel_requested를 감시하다 진행 중인 호출을 직접 중단시킨다.
  const cancellation = new AbortController();
  const cancelWatch = setInterval(() => {
    if (isCancelRequested(ctx.db, runId)) {
      cancellation.abort();
      clearInterval(cancelWatch);
    }
  }, CODE_DEFAULTS.daemonPollIntervalMs);
  cancelWatch.unref?.();

  try {
    for (const keywordId of detail.keywordIds) {
      const keyword = getKeyword(ctx.db, keywordId);
      if (!keyword) {
        runLog.warn(`키워드 ${keywordId}가 삭제되어 건너뜁니다`);
        continue;
      }
      await runKeyword(ctx, runId, keyword, doneStages, cancellation.signal, plannedStages.get(keyword.id));
      markCrawled(ctx.db, keyword.id);
    }

    // 키워드 간 유사도는 전체 키워드 처리 후 1회 수행
    computeRelations(ctx, runLog);

    updateRunStatus(ctx.db, runId, 'done', { finishedAt: nowIso() });
    runLog.info('Run 완료');
    return { outcome: 'done' };
  } catch (error) {
    if (isCancellation(error)) {
      updateRunStatus(ctx.db, runId, 'cancelled', { finishedAt: nowIso(), error: '사용자 취소' });
      runLog.warn('Run 취소됨');
      return { outcome: 'cancelled' };
    }
    if (error instanceof QuotaPausedError) {
      updateRunStatus(ctx.db, runId, 'paused_quota', { error: error.message });
      runLog.warn(`Run 보류(quota): ${error.message}`);
      return { outcome: 'paused_quota', error: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    updateRunStatus(ctx.db, runId, 'failed', { finishedAt: nowIso(), error: message });
    runLog.error(`Run 실패: ${message}`, { stack: error instanceof Error ? error.stack : undefined });
    return { outcome: 'failed', error: message };
  } finally {
    clearInterval(cancelWatch);
  }
}

async function runKeyword(
  ctx: DaemonContext,
  runId: number,
  keyword: Keyword,
  doneStages: Set<string>,
  signal: AbortSignal,
  planned?: Stage[],
): Promise<void> {
  const stages = planned && planned.length > 0 ? STAGES.filter((s) => planned.includes(s)) : STAGES;
  for (const stage of stages) {
    if (doneStages.has(`${keyword.id}:${stage}`)) {
      ctx.log.child({ runId, keywordId: keyword.id, stage }).info(`${STAGE_LABELS[stage]} 이미 완료됨 → 건너뜀`);
      continue;
    }
    if (isCancelRequested(ctx.db, runId)) throw new CancelledError();

    const log = ctx.log.child({ runId, keywordId: keyword.id, stage });
    const stageCtx: StageContext = {
      ctx,
      runId,
      keyword,
      log,
      progress: (percent, message) =>
        updateStage(ctx.db, {
          runId,
          keywordId: keyword.id,
          stage,
          status: 'running',
          progress: percent,
          message: message ?? null,
        }),
      isCancelled: () => signal.aborted || isCancelRequested(ctx.db, runId),
      signal,
    };

    updateStage(ctx.db, { runId, keywordId: keyword.id, stage, status: 'running', progress: 0 });
    log.info(`[${keyword.name}] ${STAGE_LABELS[stage]} 시작`);

    try {
      await executeStage(stage, stageCtx);
      updateStage(ctx.db, { runId, keywordId: keyword.id, stage, status: 'done', progress: 100 });
    } catch (error) {
      const quotaMessage = quotaPauseMessage(error);
      if (quotaMessage) {
        updateStage(ctx.db, {
          runId,
          keywordId: keyword.id,
          stage,
          status: 'pending',
          message: 'quota 부족으로 보류',
        });
        throw new QuotaPausedError(quotaMessage);
      }
      if (isCancellation(error)) {
        updateStage(ctx.db, {
          runId,
          keywordId: keyword.id,
          stage,
          status: 'pending',
          message: '취소됨',
        });
        throw new CancelledError();
      }
      const message = error instanceof Error ? error.message : String(error);
      updateStage(ctx.db, { runId, keywordId: keyword.id, stage, status: 'failed', message });
      throw error;
    }
  }
}

async function executeStage(stage: Stage, stageCtx: StageContext): Promise<void> {
  switch (stage) {
    case 'discover':
      await discoverStage(stageCtx);
      return;
    case 'collect':
      await collectStage(stageCtx);
      return;
    case 'extract':
      await extractStage(stageCtx);
      return;
    case 'score':
      scoreStage(stageCtx);
      return;
    case 'analyze':
      await analyzeStage(stageCtx);
      return;
    default: {
      const exhaustive: never = stage;
      throw new Error(`알 수 없는 스테이지: ${String(exhaustive)}`);
    }
  }
}

function quotaPauseMessage(error: unknown): string | null {
  if (error instanceof QuotaExhaustedError) return '남은 YouTube quota가 부족해 보류합니다';
  if (error instanceof YouTubeApiError && error.kind === 'quotaExceeded') {
    return 'YouTube API 일일 quota를 초과해 보류합니다';
  }
  return null;
}
