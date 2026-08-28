import type { VideoStatsItem } from './client.js';

export interface RankedVideo extends VideoStatsItem {
  score: number;
  rank: number;
}

export interface RankOptions {
  minCommentCount: number;
  limit: number;
  /** 기준 시각 (테스트 주입용) */
  now?: Date;
  /** recency 감쇠 기간 (개월) */
  recencyMonths?: number;
}

/**
 * 계획서 §4.1 ①의 랭킹 스코어
 *   videoScore = log10(commentCount+1)*0.6 + log10(viewCount+1)*0.2 + recencyBoost*0.2
 *   recencyBoost: 최근 recencyMonths 내 선형 감쇠 (0~1)
 */
export function computeVideoScore(video: VideoStatsItem, now = new Date(), recencyMonths = 24): number {
  const comment = Math.log10(video.commentCount + 1) * 0.6;
  const view = Math.log10(video.viewCount + 1) * 0.2;

  let recencyBoost = 0;
  if (video.publishedAt) {
    const published = new Date(video.publishedAt).getTime();
    if (Number.isFinite(published)) {
      const ageMonths = (now.getTime() - published) / (1000 * 60 * 60 * 24 * 30.44);
      recencyBoost = Math.max(0, Math.min(1, 1 - ageMonths / recencyMonths));
    }
  }
  return Number((comment + view + recencyBoost * 0.2).toFixed(6));
}

/** 댓글 비활성/최소 댓글 수 미달 영상을 걸러내고 상위 N개를 고른다 */
export function rankVideos(videos: VideoStatsItem[], options: RankOptions): RankedVideo[] {
  const now = options.now ?? new Date();
  const seen = new Set<string>();
  return videos
    .filter((v) => {
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      if (v.commentsDisabled) return false;
      return v.commentCount >= options.minCommentCount;
    })
    .map((v) => ({ ...v, score: computeVideoScore(v, now, options.recencyMonths), rank: 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit)
    .map((v, index) => ({ ...v, rank: index + 1 }));
}
