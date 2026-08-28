import { linkKeywordVideos, upsertVideos } from '@youtubeca/db';
import { rankVideos, type VideoStatsItem } from '@youtubeca/youtube';
import { CancelledError, type StageContext } from './types.js';

export interface DiscoverResult {
  candidates: number;
  selected: number;
}

/**
 * Stage 1 — 댓글이 많은 영상 선별 (§4.1 ①)
 * search.list는 댓글 수 정렬을 지원하지 않으므로 relevance/viewCount 2축으로 후보를 모은 뒤
 * videos.list로 실제 통계를 조회해 랭킹한다.
 */
export async function discoverStage(stage: StageContext): Promise<DiscoverResult> {
  const { ctx, keyword, log } = stage;
  const settings = ctx.settings();

  stage.progress(5, '영상 후보 검색 중');
  const orders = ['relevance', 'viewCount'] as const;
  const candidateIds = new Set<string>();

  for (const order of orders) {
    if (stage.isCancelled()) throw new CancelledError();
    const results = await ctx.youtube.search({
      q: keyword.name,
      order,
      pages: 2,
      relevanceLanguage: settings['yt.relevanceLanguage'],
    });
    for (const item of results) candidateIds.add(item.videoId);
    log.debug(`search(${order}) 결과 ${results.length}건`, { total: candidateIds.size });
  }

  if (candidateIds.size === 0) {
    log.warn('검색 결과가 없습니다');
    return { candidates: 0, selected: 0 };
  }

  stage.progress(45, `후보 ${candidateIds.size}건 통계 조회 중`);
  const stats: VideoStatsItem[] = await ctx.youtube.videoStats([...candidateIds]);

  stage.progress(75, '랭킹 산출 중');
  const ranked = rankVideos(stats, {
    minCommentCount: settings['yt.minCommentCount'],
    limit: settings['yt.maxVideosPerKeyword'],
  });

  if (ranked.length === 0) {
    log.warn(
      `최소 댓글 수(${settings['yt.minCommentCount']})를 넘는 영상이 없습니다. 임계값을 낮춰보세요`,
      { candidates: stats.length },
    );
  }

  upsertVideos(
    ctx.db,
    stats.map((v) => ({
      id: v.id,
      title: v.title,
      channelId: v.channelId,
      channelTitle: v.channelTitle,
      publishedAt: v.publishedAt,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      thumbnailUrl: v.thumbnailUrl,
      videoScore: ranked.find((r) => r.id === v.id)?.score ?? null,
      commentsDisabled: v.commentsDisabled,
    })),
  );

  linkKeywordVideos(
    ctx.db,
    keyword.id,
    ranked.map((v) => ({ videoId: v.id, rank: v.rank, score: v.score })),
  );

  stage.progress(100, `영상 ${ranked.length}개 선정`);
  log.info(`영상 ${ranked.length}개 선정 (후보 ${stats.length}건)`, {
    top: ranked.slice(0, 3).map((v) => ({ id: v.id, title: v.title, comments: v.commentCount })),
  });
  return { candidates: stats.length, selected: ranked.length };
}
