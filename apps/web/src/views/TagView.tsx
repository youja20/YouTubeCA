import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { CommentCard } from '../components/CommentCard';
import { Empty, ErrorBlock, Loading } from '../components/StateBlocks';
import { StrengthBar } from '../components/StrengthBar';
import { formatNumber, POLARITY_LABEL, polarityOf } from '../lib/format';

export function TagView() {
  const { tagId } = useParams({ from: '/tags/$tagId' });
  const id = Number(tagId);
  const navigate = useNavigate();

  const { data, isPending, error } = useQuery({
    queryKey: ['tag-view', id],
    queryFn: () => api.getTagView(id),
  });

  if (isPending) return <Loading />;
  if (error) return <ErrorBlock error={error} />;
  const view = data?.data;
  if (!view) return <Empty>태그를 찾을 수 없습니다</Empty>;

  const { tag, keywords, topComments } = view;
  const maxRaw = Math.max(...keywords.map((k) => k.rawScore), 0.0001);

  return (
    <div className="space-y-5">
      <header className="card px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-bold">#{tag.name}</h1>
          <p className="text-sm text-slate-500">
            카테고리 {tag.category ?? '기타'} · 전역 극성{' '}
            <span className="font-medium">
              {tag.polarity === null ? '-' : tag.polarity.toFixed(2)} (
              {POLARITY_LABEL[polarityOf(tag.polarity)]})
            </span>{' '}
            · {formatNumber(tag.keywordCount)}개 키워드 · 댓글 {formatNumber(tag.totalCommentCount)}건
          </p>
          <button
            type="button"
            className="btn-ghost ml-auto"
            onClick={() => navigate({ to: '/comments', search: { tag: tag.id } })}
          >
            이 태그 댓글 전체 보기
          </button>
        </div>
      </header>

      {/* ① 관련 키워드 리스트 (raw_score DESC) */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">① 이 태그가 나타나는 키워드</h2>
          <span className="text-[11px] text-slate-400">키워드 간 비교는 정규화 전 raw 점수 기준</span>
        </div>
        <div className="p-5">
          {keywords.length === 0 ? (
            <Empty>연결된 키워드가 없습니다</Empty>
          ) : (
            <ul className="space-y-2.5">
              {keywords.map((keyword) => (
                <li key={keyword.keywordId} className="flex items-center gap-3">
                  <Link
                    to="/keywords/$keywordId"
                    params={{ keywordId: String(keyword.keywordId) }}
                    className="w-36 shrink-0 truncate text-sm font-medium text-slate-700 hover:underline"
                  >
                    {keyword.name}
                  </Link>
                  <StrengthBar
                    strength={(keyword.rawScore / maxRaw) * 100}
                    polarity={keyword.polarity}
                    className="flex-1"
                  />
                  <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">
                    {keyword.strength}
                  </span>
                  <span className="w-16 shrink-0 text-right text-xs text-slate-400">
                    {formatNumber(keyword.commentCount)}건
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ② 대표 댓글 (최대 20개) */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">② 이 태그가 추출된 대표 댓글 (좋아요 상위 20)</h2>
        </div>
        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {topComments.length === 0 && <Empty>댓글이 없습니다</Empty>}
          {topComments.map((comment) => (
            <CommentCard
              key={`${comment.id}-${comment.keywordId}`}
              comment={comment}
              highlight={[tag.name]}
              showKeywordBadge
              onClick={() =>
                navigate({ to: '/comments', search: { tag: tag.id, keyword: comment.keywordId } })
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}
