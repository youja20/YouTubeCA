import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { KeywordTag, RelatedKeyword } from '@youtubeca/shared';
import { api } from '../lib/api';
import { CommentCard } from '../components/CommentCard';
import { Empty, ErrorBlock, Loading } from '../components/StateBlocks';
import { StrengthBar } from '../components/StrengthBar';
import { TagChip } from '../components/TagChip';
import { formatDateTime, formatNumber, POLARITY_LABEL, polarityOf } from '../lib/format';

const SENTIMENT_LABEL: Record<string, string> = {
  positive: '긍정적',
  mixed: '혼재',
  negative: '부정적',
  neutral: '중립적',
};

export function KeywordView() {
  const { keywordId } = useParams({ from: '/keywords/$keywordId' });
  const id = Number(keywordId);
  const navigate = useNavigate();
  const [tagLayout, setTagLayout] = useState<'bar' | 'cloud'>('bar');

  const { data, isPending, error } = useQuery({
    queryKey: ['keyword-view', id],
    queryFn: () => api.getKeywordView(id),
  });

  if (isPending) return <Loading />;
  if (error) return <ErrorBlock error={error} />;
  const view = data?.data;
  if (!view) return <Empty>키워드를 찾을 수 없습니다</Empty>;

  const { keyword, stats, tags, analysis, related, sampleComments } = view;
  const goComments = (tagId?: number) =>
    navigate({ to: '/comments', search: { keyword: keyword.id, tag: tagId } });

  return (
    <div className="space-y-5">
      {/* 헤더 */}
      <header className="card px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-bold">「{keyword.name}」</h1>
          <p className="text-sm text-slate-500">
            댓글 {formatNumber(stats.commentCount)} · 영상 {formatNumber(stats.videoCount)} · 태그{' '}
            {formatNumber(stats.tagCount)} · 최근 수집 {formatDateTime(stats.lastCrawledAt)}
          </p>
          <button type="button" className="btn-ghost ml-auto" onClick={() => goComments()}>
            전체 댓글 보기
          </button>
        </div>
        <SentimentGauge stats={stats} />
      </header>

      {/* ① 태그 & 강도 */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">① 태그 &amp; 강도</h2>
          <div className="flex gap-1 text-xs">
            {(['bar', 'cloud'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setTagLayout(mode)}
                className={`rounded px-2 py-1 ${tagLayout === mode ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {mode === 'bar' ? '막대' : '클라우드'}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          {tags.length === 0 ? (
            <Empty>아직 추출된 태그가 없습니다. 설정에서 크롤링을 실행하세요.</Empty>
          ) : tagLayout === 'bar' ? (
            <ul className="space-y-2.5">
              {tags.map((tag) => (
                <TagBarRow key={tag.tagId} tag={tag} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <TagChip
                  key={tag.tagId}
                  tagId={tag.tagId}
                  name={tag.name}
                  polarity={tag.polarity}
                  strength={tag.strength}
                  scaleByStrength
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ② AI 분석 결과 */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">② AI 분석 결과</h2>
          {analysis && (
            <span className="text-[11px] text-slate-400">
              {analysis.model} · {formatDateTime(analysis.createdAt)}
            </span>
          )}
        </div>
        <div className="p-5">
          {!analysis ? (
            <Empty>AI 분석 결과가 없습니다. 크롤링 실행 후 생성됩니다.</Empty>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start gap-4">
                <p className="min-w-[16rem] flex-1 text-sm leading-relaxed text-slate-700">
                  {analysis.payload.summary}
                </p>
                <div className="w-56 shrink-0 rounded-lg bg-slate-50 p-3">
                  <p className="label">전체 감성</p>
                  <p className="text-lg font-semibold">
                    {SENTIMENT_LABEL[analysis.payload.overall_sentiment.label] ??
                      analysis.payload.overall_sentiment.label}
                  </p>
                  <StrengthBar
                    strength={((analysis.payload.overall_sentiment.score + 1) / 2) * 100}
                    polarity={analysis.payload.overall_sentiment.score}
                    className="mt-2"
                  />
                  <p className="mt-1 text-right text-xs text-slate-500">
                    {analysis.payload.overall_sentiment.score.toFixed(2)}
                  </p>
                </div>
              </div>

              {analysis.payload.perceptions.length > 0 && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {analysis.payload.perceptions.map((perception) => (
                    <article key={perception.title} className="rounded-lg border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold">{perception.title}</h3>
                        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          확신 {(perception.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-slate-600">{perception.description}</p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {perception.evidence_tags.map((name) => {
                          const match = tags.find((t) => t.name === name);
                          return (
                            <TagChip
                              key={name}
                              name={name}
                              polarity={match?.polarity}
                              onClick={() => goComments(match?.tagId)}
                            />
                          );
                        })}
                      </div>
                    </article>
                  ))}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <ListBlock title="강점" tone="positive" items={analysis.payload.strengths} />
                <ListBlock title="우려" tone="negative" items={analysis.payload.concerns} />
              </div>

              {analysis.payload.audience_voice && (
                <div>
                  <p className="label">청중 어조</p>
                  <p className="mt-1 text-sm text-slate-700">{analysis.payload.audience_voice}</p>
                </div>
              )}
              {analysis.payload.notable_shift && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="label text-amber-700">의견이 갈리는 지점</p>
                  <p className="mt-1 text-sm text-amber-900">{analysis.payload.notable_shift}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ③ 관련 키워드 */}
      {related.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">③ 관련 키워드</h2>
          </div>
          <div className="grid gap-3 p-5 md:grid-cols-2">
            {related.map((item) => (
              <RelatedCard key={item.keywordId} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* ④ 주요 댓글 — 태그별 랜덤 5개 */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">④ 주요 댓글 — 태그별 랜덤 5개</h2>
        </div>
        <div className="space-y-6 p-5">
          {tags.slice(0, 8).map((tag) => {
            const comments = sampleComments[tag.tagId] ?? [];
            if (comments.length === 0) return null;
            return (
              <div key={tag.tagId}>
                <button
                  type="button"
                  onClick={() => goComments(tag.tagId)}
                  className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
                >
                  <TagChip name={tag.name} polarity={tag.polarity} strength={tag.strength} />
                  <span className="text-xs font-normal text-slate-400">
                    댓글 {formatNumber(tag.commentCount)}건 전체 보기 →
                  </span>
                </button>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {comments.map((comment) => (
                    <CommentCard key={comment.id} comment={comment} highlight={[tag.name]} />
                  ))}
                </div>
              </div>
            );
          })}
          {tags.length === 0 && <Empty>표시할 댓글이 없습니다</Empty>}
        </div>
      </section>
    </div>
  );
}

function TagBarRow({ tag }: { tag: KeywordTag }) {
  return (
    <li className="flex items-center gap-3">
      <Link
        to="/tags/$tagId"
        params={{ tagId: String(tag.tagId) }}
        className="w-32 shrink-0 truncate text-sm font-medium text-slate-700 hover:underline"
        title={tag.name}
      >
        {tag.name}
      </Link>
      <StrengthBar strength={tag.strength} polarity={tag.polarity} className="flex-1" />
      <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">{tag.strength}</span>
      <span className="w-12 shrink-0 text-right text-xs text-slate-400">
        {POLARITY_LABEL[polarityOf(tag.polarity)]}
      </span>
      <span className="w-16 shrink-0 text-right text-xs text-slate-400">
        {formatNumber(tag.commentCount)}건
      </span>
    </li>
  );
}

function ListBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'positive' | 'negative';
}) {
  if (items.length === 0) return null;
  const dot = tone === 'positive' ? 'bg-teal-500' : 'bg-red-500';
  return (
    <div>
      <p className="label">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-sm text-slate-700">
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelatedCard({ item }: { item: RelatedKeyword }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <Link
          to="/keywords/$keywordId"
          params={{ keywordId: String(item.keywordId) }}
          className="font-semibold hover:underline"
        >
          {item.name}
        </Link>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          유사도 {item.similarity.toFixed(2)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.sharedTags.slice(0, 6).map((tag) => (
          <Link
            key={tag.tagId}
            to="/tags/$tagId"
            params={{ tagId: String(tag.tagId) }}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
            title={`이 키워드 ${tag.selfRaw.toFixed(3)} vs ${item.name} ${tag.otherRaw.toFixed(3)}`}
          >
            {tag.name}
            <span className={tag.stronger === 'other' ? 'text-teal-600' : 'text-slate-400'}>
              {tag.stronger === 'other' ? '↑' : '↓'}
            </span>
          </Link>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">↑ = 이 태그가 「{item.name}」에서 더 강하게 나타남</p>
    </div>
  );
}

function SentimentGauge({ stats }: { stats: { sentimentBreakdown: { positive: number; neutral: number; negative: number } } }) {
  const { positive, neutral, negative } = stats.sentimentBreakdown;
  const total = Math.max(1, positive + neutral + negative);
  const segments = [
    { value: positive, className: 'bg-teal-500', label: '긍정' },
    { value: neutral, className: 'bg-slate-300', label: '중립' },
    { value: negative, className: 'bg-red-500', label: '부정' },
  ];
  return (
    <div className="mt-3">
      <div className="flex h-2 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <div
            key={segment.label}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
            title={`${segment.label} ${segment.value.toLocaleString('ko-KR')}건`}
          />
        ))}
      </div>
      <div className="mt-1 flex gap-3 text-[11px] text-slate-500">
        {segments.map((segment) => (
          <span key={segment.label}>
            {segment.label} {((segment.value / total) * 100).toFixed(1)}%
          </span>
        ))}
      </div>
    </div>
  );
}
