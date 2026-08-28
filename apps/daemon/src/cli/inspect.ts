/**
 * DB 상태 요약 CLI (운영·디버깅용)
 *   pnpm --filter @youtubeca/daemon exec tsx src/cli/inspect.ts [--keyword 무선이어폰]
 */
import { parseArgs } from 'node:util';
import { getDb, getKeywordByName, getKeywordStats, getKeywordTags, getLatestAnalysis } from '@youtubeca/db';

const { values } = parseArgs({ options: { keyword: { type: 'string', short: 'k' } } });
const ctx = getDb();
const count = (sql: string): number => (ctx.sqlite.prepare(sql).get() as { n: number }).n;

console.log(`DB: ${ctx.path}`);
console.log(
  [
    `키워드 ${count('SELECT COUNT(*) n FROM keywords')}`,
    `영상 ${count('SELECT COUNT(*) n FROM videos')}`,
    `댓글 ${count('SELECT COUNT(*) n FROM comments')}`,
    `태그 ${count('SELECT COUNT(*) n FROM tags')}`,
    `키워드-태그 ${count('SELECT COUNT(*) n FROM keyword_tags')}`,
    `댓글-태그 ${count('SELECT COUNT(*) n FROM comment_tags')}`,
  ].join(' · '),
);

if (values.keyword) {
  const keyword = getKeywordByName(ctx, values.keyword);
  if (!keyword) {
    console.error(`키워드를 찾을 수 없습니다: ${values.keyword}`);
    process.exit(1);
  }
  const stats = getKeywordStats(ctx, keyword.id);
  console.log(`\n[${keyword.name}] 댓글 ${stats.commentCount} · 영상 ${stats.videoCount} · 태그 ${stats.tagCount}`);
  console.log(
    `감성 평균 ${stats.avgSentiment ?? 'N/A'} (긍 ${stats.sentimentBreakdown.positive} / 중 ${stats.sentimentBreakdown.neutral} / 부 ${stats.sentimentBreakdown.negative})`,
  );
  console.log('\n상위 태그:');
  for (const tag of getKeywordTags(ctx, keyword.id, 20)) {
    const bar = '█'.repeat(Math.round(tag.strength / 5)).padEnd(20, '░');
    console.log(
      `  ${String(tag.strength).padStart(3)} ${bar} ${tag.name} (${tag.category ?? '기타'}) 극성 ${tag.polarity.toFixed(2)} · ${tag.commentCount}건`,
    );
  }
  const analysis = getLatestAnalysis(ctx, keyword.id);
  console.log(`\nAI 분석: ${analysis ? `${analysis.model} · ${analysis.createdAt}` : '없음'}`);
  if (analysis) console.log(analysis.payload.summary);
}
ctx.close();
