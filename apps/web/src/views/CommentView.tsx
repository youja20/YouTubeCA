import { useNavigate, useSearch } from '@tanstack/react-router';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { CommentCard } from '../components/CommentCard';
import { Empty, ErrorBlock, Loading } from '../components/StateBlocks';
import { formatNumber } from '../lib/format';

type Sort = 'likes' | 'recent';
type Sentiment = 'all' | 'positive' | 'neutral' | 'negative';

const PAGE_SIZE = 50;

export function CommentView() {
  const search = useSearch({ from: '/comments' });
  const navigate = useNavigate();
  const [sort, setSort] = useState<Sort>('likes');
  const [sentiment, setSentiment] = useState<Sentiment>('all');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const sentinel = useRef<HTMLDivElement>(null);

  const tagId = search.tag;
  const keywordId = search.keyword;
  const enabled = tagId !== undefined || keywordId !== undefined;

  const { data: tagsData } = useQuery({ queryKey: ['tags', ''], queryFn: () => api.listTags({ limit: 200 }) });
  const { data: keywordsData } = useQuery({ queryKey: ['keywords-all'], queryFn: () => api.listKeywords({}) });

  const comments = useInfiniteQuery({
    queryKey: ['comments', tagId, keywordId, sort, sentiment, query],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listComments({
        tagId,
        keywordId,
        sort,
        sentiment,
        q: query || undefined,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (lastPage) => lastPage.meta?.cursor ?? null,
  });

  // 무한 스크롤
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && comments.hasNextPage && !comments.isFetchingNextPage) {
        void comments.fetchNextPage();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [comments.hasNextPage, comments.isFetchingNextPage, comments.fetchNextPage, comments]);

  const selectedTag = tagsData?.data.find((t) => t.id === tagId);
  const total = comments.data?.pages[0]?.meta?.total ?? 0;
  const rows = comments.data?.pages.flatMap((page) => page.data) ?? [];

  const setFilter = (next: { tag?: number; keyword?: number }) =>
    navigate({ to: '/comments', search: { tag: next.tag, keyword: next.keyword } });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">커멘트</h1>

      {/* 기준 선택 */}
      <section className="card p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="label">태그 기준</span>
            <select
              className="input mt-1"
              value={tagId ?? ''}
              onChange={(event) =>
                setFilter({ tag: event.target.value ? Number(event.target.value) : undefined, keyword: keywordId })
              }
            >
              <option value="">(선택 안 함)</option>
              {tagsData?.data.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  #{tag.name} ({formatNumber(tag.totalCommentCount)})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">키워드 기준</span>
            <select
              className="input mt-1"
              value={keywordId ?? ''}
              onChange={(event) =>
                setFilter({ tag: tagId, keyword: event.target.value ? Number(event.target.value) : undefined })
              }
            >
              <option value="">(선택 안 함)</option>
              {keywordsData?.data.map((keyword) => (
                <option key={keyword.id} value={keyword.id}>
                  {keyword.name} ({formatNumber(keyword.commentCount)})
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {!enabled ? (
        <Empty>태그 또는 키워드를 하나 이상 선택하세요</Empty>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-slate-600">결과 {formatNumber(total)}건</span>
            <select
              className="input ml-auto max-w-[9rem]"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="likes">좋아요순</option>
              <option value="recent">최신순</option>
            </select>
            <select
              className="input max-w-[9rem]"
              value={sentiment}
              onChange={(event) => setSentiment(event.target.value as Sentiment)}
            >
              <option value="all">감성 전체</option>
              <option value="positive">긍정</option>
              <option value="neutral">중립</option>
              <option value="negative">부정</option>
            </select>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(text.trim());
              }}
            >
              <input
                className="input max-w-[12rem]"
                placeholder="본문 검색"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <button type="submit" className="btn-ghost">
                검색
              </button>
            </form>
          </div>

          {comments.isPending && <Loading />}
          {comments.error && <ErrorBlock error={comments.error} />}
          {comments.isSuccess && rows.length === 0 && <Empty>조건에 맞는 댓글이 없습니다</Empty>}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((comment) => (
              <CommentCard
                key={`${comment.id}-${comment.keywordId ?? ''}`}
                comment={comment}
                highlight={selectedTag ? [selectedTag.name] : comment.matchedTags.map((t) => t.name)}
                showKeywordBadge={keywordId === undefined}
              />
            ))}
          </div>

          <div ref={sentinel} className="h-10" />
          {comments.isFetchingNextPage && <Loading label="더 불러오는 중…" />}
          {!comments.hasNextPage && rows.length > 0 && (
            <p className="pb-6 text-center text-xs text-slate-400">마지막입니다</p>
          )}
        </>
      )}
    </div>
  );
}
