import { QUOTA_COST } from '@youtubeca/shared';
import { classifyError, YouTubeApiError } from './errors.js';

const API_BASE = 'https://www.googleapis.com/youtube/v3';

export interface QuotaGuard {
  /** 호출 전: 남은 quota가 부족하면 false를 반환해 호출을 막는다 */
  reserve(units: number): boolean;
  /** 호출 후 실제 사용량 기록 */
  consume(units: number): void;
}

export interface YouTubeClientOptions {
  apiKey: string;
  quota?: QuotaGuard;
  maxRetries?: number;
  /** 테스트용 fetch 주입 */
  fetchImpl?: typeof fetch;
  onLog?: (level: 'debug' | 'info' | 'warn', message: string, meta?: unknown) => void;
}

export class QuotaExhaustedError extends Error {
  constructor(readonly needed: number) {
    super('남은 YouTube quota가 부족합니다');
    this.name = 'QuotaExhaustedError';
  }
}

/* ─────────────────────────── 응답 타입 ─────────────────────────── */

export interface SearchResultItem {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnailUrl: string | null;
}

export interface VideoStatsItem {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  thumbnailUrl: string | null;
  /** statistics.commentCount가 없으면 댓글 비활성으로 간주 */
  commentsDisabled: boolean;
}

export interface RawComment {
  id: string;
  videoId: string;
  parentId: string | null;
  author: string | null;
  authorChannelId: string | null;
  textOriginal: string;
  likeCount: number;
  replyCount: number;
  publishedAt: string | null;
  updatedAt: string | null;
}

interface ApiListResponse<T> {
  items?: T[];
  nextPageToken?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class YouTubeClient {
  private readonly apiKey: string;
  private readonly quota: QuotaGuard | undefined;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onLog: YouTubeClientOptions['onLog'];

  constructor(options: YouTubeClientOptions) {
    this.apiKey = options.apiKey;
    this.quota = options.quota;
    this.maxRetries = options.maxRetries ?? 5;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.onLog = options.onLog;
  }

  private async request<T>(
    endpoint: string,
    params: Record<string, string | number | undefined>,
    cost: number,
  ): Promise<T> {
    if (this.quota && !this.quota.reserve(cost)) throw new QuotaExhaustedError(cost);

    const url = new URL(`${API_BASE}/${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
    url.searchParams.set('key', this.apiKey);

    let delay = 1000;
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { headers: { accept: 'application/json' } });
      } catch (cause) {
        const error = new YouTubeApiError('network', `네트워크 오류: ${String(cause)}`);
        if (attempt === this.maxRetries) throw error;
        await sleep(delay);
        delay *= 2;
        continue;
      }

      if (response.ok) {
        this.quota?.consume(cost);
        return (await response.json()) as T;
      }

      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const error = classifyError(response.status, body);
      // 실패한 호출도 quota는 차감되는 경우가 있어 보수적으로 기록한다
      if (error.kind !== 'network') this.quota?.consume(cost);

      if (!error.retryable || attempt === this.maxRetries) throw error;
      this.onLog?.('warn', `YouTube 재시도 ${attempt}/${this.maxRetries}: ${error.message}`, {
        endpoint,
        delay,
      });
      await sleep(delay);
      delay *= 2;
    }
    throw new YouTubeApiError('unknown', '재시도 횟수를 초과했습니다');
  }

  /** search.list — 100 units/호출 */
  async search(params: {
    q: string;
    order: 'relevance' | 'viewCount' | 'date' | 'rating';
    pages?: number;
    relevanceLanguage?: string;
    regionCode?: string;
  }): Promise<SearchResultItem[]> {
    const items: SearchResultItem[] = [];
    let pageToken: string | undefined;
    const pages = params.pages ?? 2;

    for (let page = 0; page < pages; page += 1) {
      const data = await this.request<ApiListResponse<{
        id?: { videoId?: string };
        snippet?: {
          title?: string;
          channelId?: string;
          channelTitle?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
      }>>(
        'search',
        {
          part: 'snippet',
          type: 'video',
          maxResults: 50,
          q: params.q,
          order: params.order,
          relevanceLanguage: params.relevanceLanguage,
          regionCode: params.regionCode,
          pageToken,
        },
        QUOTA_COST.search,
      );

      for (const item of data.items ?? []) {
        const videoId = item.id?.videoId;
        if (!videoId) continue;
        items.push({
          videoId,
          title: item.snippet?.title ?? '',
          channelId: item.snippet?.channelId ?? '',
          channelTitle: item.snippet?.channelTitle ?? '',
          publishedAt: item.snippet?.publishedAt ?? '',
          thumbnailUrl:
            item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
        });
      }
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    return items;
  }

  /** videos.list — 1 unit/호출, id 최대 50개 배치 */
  async videoStats(ids: string[]): Promise<VideoStatsItem[]> {
    const out: VideoStatsItem[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      const data = await this.request<ApiListResponse<{
        id?: string;
        snippet?: {
          title?: string;
          channelId?: string;
          channelTitle?: string;
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      }>>(
        'videos',
        { part: 'snippet,statistics', id: batch.join(',') , maxResults: 50 },
        QUOTA_COST.videos,
      );

      for (const item of data.items ?? []) {
        if (!item.id) continue;
        const commentCountRaw = item.statistics?.commentCount;
        out.push({
          id: item.id,
          title: item.snippet?.title ?? '',
          channelId: item.snippet?.channelId ?? '',
          channelTitle: item.snippet?.channelTitle ?? '',
          publishedAt: item.snippet?.publishedAt ?? '',
          viewCount: Number(item.statistics?.viewCount ?? 0),
          likeCount: Number(item.statistics?.likeCount ?? 0),
          commentCount: Number(commentCountRaw ?? 0),
          thumbnailUrl:
            item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
          commentsDisabled: commentCountRaw === undefined,
        });
      }
    }
    return out;
  }

  /**
   * commentThreads.list — 1 unit/page
   * 대댓글은 응답에 인라인으로 포함된 것만 저장한다 (§4.1 ②)
   */
  async commentThreads(params: {
    videoId: string;
    maxComments: number;
    order?: 'relevance' | 'time';
    onPage?: (collected: number) => void;
  }): Promise<RawComment[]> {
    const comments: RawComment[] = [];
    let pageToken: string | undefined;
    const maxPages = Math.max(1, Math.ceil(params.maxComments / 100));

    for (let page = 0; page < maxPages; page += 1) {
      const data = await this.request<ApiListResponse<{
        snippet?: {
          topLevelComment?: {
            id?: string;
            snippet?: Record<string, unknown>;
          };
          totalReplyCount?: number;
        };
        replies?: { comments?: { id?: string; snippet?: Record<string, unknown> }[] };
      }>>(
        'commentThreads',
        {
          part: 'snippet,replies',
          videoId: params.videoId,
          maxResults: 100,
          order: params.order ?? 'relevance',
          textFormat: 'plainText',
          pageToken,
        },
        QUOTA_COST.commentThreads,
      );

      for (const thread of data.items ?? []) {
        const top = thread.snippet?.topLevelComment;
        if (top?.id && top.snippet) {
          comments.push(toRawComment(top.id, top.snippet, params.videoId, null, thread.snippet?.totalReplyCount ?? 0));
        }
        for (const reply of thread.replies?.comments ?? []) {
          if (!reply.id || !reply.snippet) continue;
          comments.push(toRawComment(reply.id, reply.snippet, params.videoId, top?.id ?? null, 0));
        }
      }

      params.onPage?.(comments.length);
      pageToken = data.nextPageToken;
      if (!pageToken || comments.length >= params.maxComments) break;
    }
    return comments.slice(0, params.maxComments + 200); // 인라인 대댓글은 상한을 약간 넘길 수 있다
  }
}

function toRawComment(
  id: string,
  snippet: Record<string, unknown>,
  videoId: string,
  parentId: string | null,
  replyCount: number,
): RawComment {
  const get = <T>(key: string): T | undefined => snippet[key] as T | undefined;
  return {
    id,
    videoId,
    parentId,
    author: get<string>('authorDisplayName') ?? null,
    authorChannelId:
      (get<{ value?: string }>('authorChannelId')?.value) ?? null,
    textOriginal: get<string>('textOriginal') ?? get<string>('textDisplay') ?? '',
    likeCount: Number(get<number>('likeCount') ?? 0),
    replyCount,
    publishedAt: get<string>('publishedAt') ?? null,
    updatedAt: get<string>('updatedAt') ?? null,
  };
}
