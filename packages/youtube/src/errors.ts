export type YouTubeErrorKind =
  | 'quotaExceeded'
  | 'rateLimited'
  | 'notFound'
  | 'commentsDisabled'
  | 'forbidden'
  | 'network'
  | 'unknown';

export class YouTubeApiError extends Error {
  constructor(
    readonly kind: YouTubeErrorKind,
    message: string,
    readonly status?: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'YouTubeApiError';
  }

  /** 재시도해도 의미가 있는 오류인가 */
  get retryable(): boolean {
    return this.kind === 'rateLimited' || this.kind === 'network';
  }
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    errors?: { reason?: string; message?: string }[];
  };
}

export function classifyError(status: number, body: unknown): YouTubeApiError {
  const parsed = body as GoogleErrorBody;
  const reason = parsed?.error?.errors?.[0]?.reason;
  const message = parsed?.error?.message ?? `YouTube API 오류 (HTTP ${status})`;

  if (status === 403) {
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
      return new YouTubeApiError('quotaExceeded', 'YouTube API 일일 quota를 초과했습니다', status, reason);
    }
    if (reason === 'commentsDisabled') {
      return new YouTubeApiError('commentsDisabled', '댓글이 비활성화된 영상입니다', status, reason);
    }
    if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
      return new YouTubeApiError('rateLimited', '요청 속도 제한에 걸렸습니다', status, reason);
    }
    return new YouTubeApiError('forbidden', message, status, reason);
  }
  if (status === 404) return new YouTubeApiError('notFound', message, status, reason);
  if (status === 429) return new YouTubeApiError('rateLimited', message, status, reason);
  if (status >= 500) return new YouTubeApiError('network', message, status, reason);
  return new YouTubeApiError('unknown', message, status, reason);
}
