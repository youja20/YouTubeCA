import {
  getVideoCollectionState,
  keywordVideoIds,
  markCommentsCollected,
  refreshKeywordCounters,
  upsertComments,
  type CommentUpsert,
} from '@youtubeca/db';
import { analyzeSentiment, detectLang, normalizeText } from '@youtubeca/shared';
import { YouTubeApiError } from '@youtubeca/youtube';
import { CancelledError, type StageContext } from './types.js';

export interface CollectResult {
  videos: number;
  collected: number;
  skipped: number;
}

/** 최근 이 시간 안에 수집한 영상은 다시 긁지 않는다 (quota 절약) */
const RECOLLECT_INTERVAL_MS = 12 * 60 * 60 * 1000;

/** Stage 2 — 댓글 수집 (§4.1 ②) */
export async function collectStage(stage: StageContext): Promise<CollectResult> {
  const { ctx, keyword, log } = stage;
  const settings = ctx.settings();
  const videoIds = keywordVideoIds(ctx.db, keyword.id);

  if (videoIds.length === 0) {
    log.warn('수집할 영상이 없습니다 (Discover 결과 확인 필요)');
    return { videos: 0, collected: 0, skipped: 0 };
  }

  let collected = 0;
  let skipped = 0;

  for (const [index, videoId] of videoIds.entries()) {
    if (stage.isCancelled()) throw new CancelledError();

    const state = getVideoCollectionState(ctx.db, videoId);
    if (
      state.lastCollectedAt &&
      Date.now() - new Date(state.lastCollectedAt).getTime() < RECOLLECT_INTERVAL_MS &&
      state.storedComments > 0
    ) {
      skipped += 1;
      log.debug(`영상 ${videoId} 최근 수집됨 → 건너뜀 (${state.storedComments}건 보유)`);
      stage.progress(((index + 1) / videoIds.length) * 100);
      continue;
    }

    try {
      const raw = await ctx.youtube.commentThreads({
        videoId,
        maxComments: settings['yt.maxCommentsPerVideo'],
      });

      const rows: CommentUpsert[] = raw.map((c) => {
        const { normalized } = normalizeText(c.textOriginal);
        const sentiment = analyzeSentiment(normalized);
        return {
          id: c.id,
          videoId: c.videoId,
          parentId: c.parentId,
          author: c.author,
          authorChannelId: c.authorChannelId,
          textOriginal: c.textOriginal,
          textNormalized: normalized,
          likeCount: c.likeCount,
          replyCount: c.replyCount,
          publishedAt: c.publishedAt,
          updatedAtSource: c.updatedAt,
          lang: detectLang(normalized),
          sentimentScore: sentiment.hits > 0 ? sentiment.score : 0,
        };
      });

      upsertComments(ctx.db, rows);
      markCommentsCollected(ctx.db, videoId);
      collected += rows.length;
      log.debug(`영상 ${videoId}: 댓글 ${rows.length}건 저장`);
    } catch (error) {
      if (error instanceof YouTubeApiError) {
        if (error.kind === 'commentsDisabled' || error.kind === 'notFound') {
          skipped += 1;
          log.warn(`영상 ${videoId} 건너뜀: ${error.message}`);
          markCommentsCollected(ctx.db, videoId);
        } else {
          throw error; // quota/권한 오류는 상위에서 Run 단위로 처리
        }
      } else {
        throw error;
      }
    }

    stage.progress(((index + 1) / videoIds.length) * 100, `${index + 1}/${videoIds.length} 영상`);
  }

  refreshKeywordCounters(ctx.db, keyword.id);
  log.info(`댓글 ${collected.toLocaleString('ko-KR')}건 수집 (영상 ${videoIds.length}개, 건너뜀 ${skipped})`);
  return { videos: videoIds.length, collected, skipped };
}
