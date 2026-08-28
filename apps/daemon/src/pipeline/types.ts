import { LlmAbortedError } from '@youtubeca/llm';
import type { Keyword } from '@youtubeca/shared';
import type { DaemonContext } from '../context.js';
import type { Logger } from '../logger.js';

export interface StageContext {
  ctx: DaemonContext;
  runId: number | null;
  keyword: Keyword;
  log: Logger;
  /** 0~100 진행률 보고 */
  progress(percent: number, message?: string): void;
  /** 취소 요청 여부 — 스테이지는 주기적으로 확인해 조기 종료한다 */
  isCancelled(): boolean;
  /**
   * 취소되면 abort되는 신호. LLM·HTTP처럼 수 분이 걸리는 호출에 넘겨
   * isCancelled() 폴링 지점 사이에서 멈추지 않도록 한다.
   */
  signal: AbortSignal;
}

export class CancelledError extends Error {
  constructor() {
    super('실행이 취소되었습니다');
    this.name = 'CancelledError';
  }
}

/** 취소로 인해 발생한 오류인지 — 폴백·부분 성공 처리로 삼키면 안 된다 */
export function isCancellation(error: unknown): boolean {
  if (error instanceof CancelledError) return true;
  if (error instanceof LlmAbortedError) return true;
  return error instanceof Error && error.name === 'AbortError';
}
