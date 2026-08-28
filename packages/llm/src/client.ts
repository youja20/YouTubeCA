import OpenAI from 'openai';
import type { z } from 'zod';
import { CODE_DEFAULTS } from '@youtubeca/shared';
import { extractJson, isEmptyPayload, unwrapCandidates } from './json.js';

export interface LlmClientOptions {
  /** 비우면 CODE_DEFAULTS.llmBaseUrl (Gemini OpenAI 호환 엔드포인트) */
  baseURL?: string;
  apiKey: string;
  /** 비우면 CODE_DEFAULTS.llmModel (§4.4) */
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  onLog?: (level: 'debug' | 'info' | 'warn', message: string, meta?: unknown) => void;
}

export interface ChatJsonOptions {
  system: string;
  user: string;
  /** JSON 스키마 지원 서버에서 사용할 이름 */
  schemaName?: string;
  temperature?: number;
  maxTokens?: number;
  /** 호출자가 중단(실행 취소 등)을 알리는 신호 — 중단되면 재시도 없이 즉시 던진다 */
  signal?: AbortSignal;
}

/** 타임아웃이 아니라 호출자가 중단시킨 경우 — 재시도·폴백 대상이 아니다 */
export class LlmAbortedError extends Error {
  constructor(message = 'LLM 호출이 중단되었습니다') {
    super(message);
    this.name = 'LlmAbortedError';
  }
}

export interface ChatJsonResult<T> {
  data: T;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class LlmClient {
  private readonly client: OpenAI;
  private readonly timeoutMs: number;
  readonly model: string;
  private readonly maxRetries: number;
  private readonly onLog: LlmClientOptions['onLog'];
  /** response_format을 거부하는 서버를 만나면 이후 호출부터 생략한다 */
  private supportsJsonMode = true;

  constructor(options: LlmClientOptions) {
    this.client = new OpenAI({
      baseURL: options.baseURL ?? CODE_DEFAULTS.llmBaseUrl,
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? CODE_DEFAULTS.llmTimeoutMs,
      maxRetries: 0, // 재시도는 아래에서 직접 제어한다
    });
    this.timeoutMs = options.timeoutMs ?? CODE_DEFAULTS.llmTimeoutMs;
    this.model = options.model ?? CODE_DEFAULTS.llmModel;
    this.maxRetries = options.maxRetries ?? 3;
    this.onLog = options.onLog;
  }

  /** Gemini는 모델 id를 `models/gemini-...` 형태로 돌려주므로 접두사를 벗긴다 */
  async listModels(): Promise<string[]> {
    const response = await this.client.models.list();
    return response.data.map((m) => m.id.replace(/^models\//, ''));
  }

  /** 키가 유효하고 설정된 모델을 실제로 쓸 수 있는지 확인한다 (§6) */
  async health(): Promise<{ ok: boolean; model: string | null; error?: string }> {
    try {
      const models = await this.listModels();
      if (!models.includes(this.model)) {
        return {
          ok: false,
          model: this.model,
          error: `모델 ${this.model}을 사용할 수 없습니다 (사용 가능: ${models.slice(0, 5).join(', ')} …)`,
        };
      }
      return { ok: true, model: this.model };
    } catch (error) {
      return { ok: false, model: this.model, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** 구조화 출력 요청 — zod 검증 실패 시 스키마 오류를 알려주며 재요청한다 (§4.4) */
  async chatJson<S extends z.ZodTypeAny>(
    schema: S,
    options: ChatJsonOptions,
  ): Promise<ChatJsonResult<z.infer<S>>> {
    const model = this.model;
    let lastError: Error | undefined;
    let repairHint = '';

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      // SDK 타임아웃만 믿지 않고 AbortController로 상한을 직접 강제한다.
      // (로컬 LLM 서버가 응답을 붙잡고 놓지 않으면 파이프라인 전체가 멈춘다)
      if (options.signal?.aborted) throw new LlmAbortedError();
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), this.timeoutMs);
      const relayAbort = () => abort.abort();
      options.signal?.addEventListener('abort', relayAbort, { once: true });
      const startedAt = Date.now();
      try {
        const completion = await this.client.chat.completions.create(
          {
            model,
            temperature: options.temperature ?? 0.2,
            max_tokens: options.maxTokens ?? 4096,
            ...(this.supportsJsonMode ? { response_format: { type: 'json_object' as const } } : {}),
            messages: [
              { role: 'system', content: options.system },
              { role: 'user', content: repairHint ? `${options.user}\n\n${repairHint}` : options.user },
            ],
          },
          { signal: abort.signal, timeout: this.timeoutMs },
        );
        this.onLog?.('debug', `LLM 응답 수신 (${Math.round((Date.now() - startedAt) / 1000)}초)`, { model });

        const choice = completion.choices[0];
        const message = choice?.message as
          | { content?: string | null; reasoning_content?: string | null }
          | undefined;
        const content = message?.content ?? '';

        let raw: unknown;
        try {
          raw = extractJson(content);
        } catch (parseError) {
          raw = undefined;
          if (!message?.reasoning_content) throw parseError;
        }
        // 추론형 모델은 답을 reasoning_content에만 남기고 content를 비우기도 한다
        if ((raw === undefined || isEmptyPayload(raw)) && message?.reasoning_content) {
          try {
            raw = extractJson(message.reasoning_content);
            this.onLog?.('debug', 'content가 비어 reasoning_content에서 JSON을 추출했습니다');
          } catch {
            // 원래 파싱 결과를 유지한다
          }
        }
        if (choice?.finish_reason === 'length') {
          this.onLog?.('warn', 'LLM 응답이 max_tokens에 걸려 잘렸습니다 — 프롬프트/토큰 한도를 조정하세요');
        }

        let parsed = schema.safeParse(raw);
        if (!parsed.success) {
          // {"analysis": {...}} 처럼 한 겹 감싼 응답을 구제한다
          for (const candidate of unwrapCandidates(raw)) {
            const retry = schema.safeParse(candidate);
            if (retry.success) {
              parsed = retry;
              break;
            }
          }
        }
        if (!parsed.success) {
          const issues = parsed.error.issues
            .slice(0, 5)
            .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
            .join('\n');
          repairHint = `직전 응답이 스키마 검증에 실패했습니다. 아래 문제를 고쳐 JSON만 다시 출력하세요.\n${issues}`;
          lastError = new Error(`LLM 응답 스키마 검증 실패:\n${issues}`);
          this.onLog?.('warn', `LLM 응답 검증 실패 (시도 ${attempt}/${this.maxRetries})`, {
            issues,
            // 어떤 형태로 왔는지 확인할 수 있도록 응답 앞부분을 남긴다
            received: JSON.stringify(raw).slice(0, 400),
          });
          continue;
        }

        return {
          data: parsed.data,
          model,
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
        };
      } catch (error) {
        // 호출자 취소는 타임아웃과 달리 재시도하지 않고 그대로 전파한다
        if (options.signal?.aborted) throw new LlmAbortedError();
        const aborted = abort.signal.aborted;
        const message = aborted
          ? `LLM 응답이 ${Math.round(this.timeoutMs / 1000)}초 안에 오지 않았습니다`
          : error instanceof Error
            ? error.message
            : String(error);
        if (!aborted && this.supportsJsonMode && /response_format|json_object/i.test(message)) {
          this.onLog?.('warn', 'LLM 서버가 response_format을 지원하지 않아 프롬프트 강제 방식으로 전환합니다');
          this.supportsJsonMode = false;
          continue;
        }
        lastError = new Error(message);
        this.onLog?.('warn', `LLM 호출 실패 (시도 ${attempt}/${this.maxRetries}): ${message}`);
        if (attempt < this.maxRetries) await sleep(1000 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', relayAbort);
      }
    }
    throw lastError ?? new Error('LLM 호출에 실패했습니다');
  }
}
