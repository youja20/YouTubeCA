import { describe, expect, it } from 'vitest';
import { computeVideoScore, rankVideos } from './ranking.js';
import type { VideoStatsItem } from './client.js';

const NOW = new Date('2026-08-28T00:00:00Z');

function video(overrides: Partial<VideoStatsItem> & { id: string }): VideoStatsItem {
  return {
    title: 'title',
    channelId: 'c',
    channelTitle: 'channel',
    publishedAt: '2026-08-01T00:00:00Z',
    viewCount: 1000,
    likeCount: 10,
    commentCount: 200,
    thumbnailUrl: null,
    commentsDisabled: false,
    ...overrides,
  };
}

describe('computeVideoScore', () => {
  it('댓글 수가 많을수록 점수가 높다', () => {
    const many = computeVideoScore(video({ id: 'a', commentCount: 10_000 }), NOW);
    const few = computeVideoScore(video({ id: 'b', commentCount: 100 }), NOW);
    expect(many).toBeGreaterThan(few);
  });

  it('최근 영상이 오래된 영상보다 높은 점수를 받는다', () => {
    const recent = computeVideoScore(video({ id: 'a', publishedAt: '2026-08-01T00:00:00Z' }), NOW);
    const old = computeVideoScore(video({ id: 'b', publishedAt: '2015-01-01T00:00:00Z' }), NOW);
    expect(recent).toBeGreaterThan(old);
  });

  it('publishedAt이 없어도 오류 없이 계산한다', () => {
    expect(computeVideoScore(video({ id: 'a', publishedAt: '' }), NOW)).toBeGreaterThan(0);
  });
});

describe('rankVideos', () => {
  it('댓글 비활성·최소 댓글 수 미달 영상을 제외한다', () => {
    const ranked = rankVideos(
      [
        video({ id: 'ok', commentCount: 500 }),
        video({ id: 'disabled', commentCount: 900, commentsDisabled: true }),
        video({ id: 'few', commentCount: 10 }),
      ],
      { minCommentCount: 100, limit: 10, now: NOW },
    );
    expect(ranked.map((v) => v.id)).toEqual(['ok']);
  });

  it('중복 id를 제거하고 상위 N개만 남기며 rank를 1부터 매긴다', () => {
    const ranked = rankVideos(
      [
        video({ id: 'a', commentCount: 100 }),
        video({ id: 'a', commentCount: 100 }),
        video({ id: 'b', commentCount: 5000 }),
        video({ id: 'c', commentCount: 300 }),
      ],
      { minCommentCount: 50, limit: 2, now: NOW },
    );
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.id).toBe('b');
    expect(ranked.map((v) => v.rank)).toEqual([1, 2]);
  });
});
