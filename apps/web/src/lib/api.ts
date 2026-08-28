import type {
  ApiOk,
  CommentDto,
  HealthResponse,
  Keyword,
  KeywordTag,
  KeywordViewResponse,
  LogDto,
  RelatedKeyword,
  RunDetail,
  RunDto,
  Settings,
  TagSummary,
  TagViewResponse,
} from '@youtubeca/shared';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 브라우저의 "Failed to fetch"는 원인을 알려주지 않으므로 서버 미기동 안내로 바꾼다 */
const OFFLINE_MESSAGE =
  'API 서버에 연결할 수 없습니다. 터미널에서 `pnpm dev`(또는 `pnpm --filter @youtubeca/api dev`)가 실행 중인지 확인하세요.';

async function request<T>(path: string, init?: RequestInit): Promise<ApiOk<T>> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', OFFLINE_MESSAGE);
  }

  if (response.status === 204) return { data: undefined as T };

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    // API가 살아 있으면 항상 {error:{...}} 규격으로 답한다.
    // 5xx인데 그 본문이 없다면 프록시가 백엔드에 닿지 못한 것이다 (vite는 ECONNREFUSED에 500을 준다)
    if (!error && response.status >= 500) {
      throw new ApiError(response.status, 'NETWORK_ERROR', OFFLINE_MESSAGE);
    }
    throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? '요청에 실패했습니다');
  }
  return body as ApiOk<T>;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  /* 키워드 */
  listKeywords: (params: { q?: string; sort?: string; activeOnly?: boolean } = {}) =>
    request<Keyword[]>(`/keywords${qs(params)}`),
  getKeywordView: (id: number) => request<KeywordViewResponse>(`/keywords/${id}`),
  getKeywordTags: (id: number, limit = 30) => request<KeywordTag[]>(`/keywords/${id}/tags${qs({ limit })}`),
  getRelated: (id: number) => request<RelatedKeyword[]>(`/keywords/${id}/related`),
  createKeyword: (body: { name: string; note?: string; autoRun?: boolean }) =>
    request<Keyword>('/keywords', { method: 'POST', body: JSON.stringify(body) }),
  /** 응답 meta.runId — 자동 실행된 크롤링 Run 번호 (설정에 따라 null) */
  createKeywordsBulk: (names: string[], autoRun?: boolean) =>
    request<Keyword[]>('/keywords/bulk', {
      method: 'POST',
      body: JSON.stringify({ names, autoRun }),
    }),
  updateKeyword: (id: number, body: { name?: string; note?: string | null; isActive?: boolean }) =>
    request<Keyword>(`/keywords/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteKeyword: (id: number) => request<void>(`/keywords/${id}`, { method: 'DELETE' }),

  /* 태그 */
  listTags: (params: { q?: string; limit?: number } = {}) => request<TagSummary[]>(`/tags${qs(params)}`),
  getTagView: (id: number) => request<TagViewResponse>(`/tags/${id}`),

  /* 댓글 */
  listComments: (params: {
    tagId?: number;
    keywordId?: number;
    sort?: string;
    sentiment?: string;
    q?: string;
    cursor?: string | null;
    limit?: number;
  }) => request<CommentDto[]>(`/comments${qs(params)}`),

  /* 실행 */
  createRun: (keywordIds?: number[]) =>
    request<RunDto>('/runs', { method: 'POST', body: JSON.stringify({ keywordIds }) }),
  listRuns: (limit = 20) => request<RunDto[]>(`/runs${qs({ limit })}`),
  getRun: (id: number) => request<RunDetail>(`/runs/${id}`),
  cancelRun: (id: number) => request<{ cancelled: boolean }>(`/runs/${id}/cancel`, { method: 'POST' }),

  /* 로그 · 설정 */
  listLogs: (params: { runId?: number; level?: string; stage?: string; limit?: number; cursor?: string | null }) =>
    request<LogDto[]>(`/logs${qs(params)}`),
  getSettings: () => request<Settings>('/settings'),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  health: () => request<HealthResponse>('/health'),
};

export function logStreamUrl(params: { runId?: number; level?: string } = {}): string {
  return `${BASE}/logs/stream${qs(params)}`;
}
