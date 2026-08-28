import { describe, expect, it } from 'vitest';
import { LlmAbortedError } from '@youtubeca/llm';
import { CancelledError, isCancellation } from './types.js';

describe('isCancellation', () => {
  it('취소에서 비롯된 오류를 모두 인식한다', () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';

    expect(isCancellation(new CancelledError())).toBe(true);
    expect(isCancellation(new LlmAbortedError())).toBe(true);
    expect(isCancellation(abortError)).toBe(true);
  });

  it('일반 실패는 취소로 보지 않는다 (폴백·부분 성공 경로를 유지해야 한다)', () => {
    expect(isCancellation(new Error('LLM 응답 스키마 검증 실패'))).toBe(false);
    expect(isCancellation('boom')).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });
});
