import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmAbortedError, LlmClient } from './client.js';

function client(): LlmClient {
  // 연결되지 않는 baseURL을 줘서 실제 호출이 나가지 않게 한다
  return new LlmClient({ baseURL: 'http://127.0.0.1:1/v1', apiKey: 'test', model: 'test-model' });
}

describe('LlmClient 취소 처리', () => {
  it('이미 중단된 신호를 받으면 호출하지 않고 LlmAbortedError를 던진다', async () => {
    const abort = new AbortController();
    abort.abort();

    await expect(
      client().chatJson(z.object({ ok: z.boolean() }), {
        system: 's',
        user: 'u',
        signal: abort.signal,
      }),
    ).rejects.toBeInstanceOf(LlmAbortedError);
  });

  it('호출 도중 중단되면 재시도하지 않고 LlmAbortedError로 끝낸다', async () => {
    const abort = new AbortController();
    // 연결이 실패해 재시도 루프로 들어가는 사이에 취소한다
    setTimeout(() => abort.abort(), 20);

    const started = Date.now();
    await expect(
      client().chatJson(z.object({ ok: z.boolean() }), {
        system: 's',
        user: 'u',
        signal: abort.signal,
      }),
    ).rejects.toBeInstanceOf(LlmAbortedError);
    // 재시도 백오프(1초+2초)를 모두 돌았다면 취소가 먹히지 않은 것이다
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
