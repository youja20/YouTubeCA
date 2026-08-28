import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { Empty, ErrorBlock, Loading } from '../components/StateBlocks';
import { formatDateTime, formatNumber } from '../lib/format';

type Sort = 'updated' | 'name' | 'comments';

export function KeywordListView() {
  const [sort, setSort] = useState<Sort>('updated');
  const [q, setQ] = useState('');

  const { data, isPending, error } = useQuery({
    queryKey: ['keywords', sort, q],
    queryFn: () => api.listKeywords({ sort, q: q || undefined }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">키워드</h1>
        <input
          className="input max-w-xs"
          placeholder="키워드 검색"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
        <select
          className="input max-w-[10rem]"
          value={sort}
          onChange={(event) => setSort(event.target.value as Sort)}
        >
          <option value="updated">최근 갱신순</option>
          <option value="comments">댓글 많은순</option>
          <option value="name">이름순</option>
        </select>
        <Link to="/settings" className="btn-ghost ml-auto">
          키워드 등록
        </Link>
      </div>

      {isPending && <Loading />}
      {error && <ErrorBlock error={error} />}
      {data && data.data.length === 0 && (
        <Empty>
          등록된 키워드가 없습니다. <Link to="/settings" className="underline">설정</Link>에서 추가하세요.
        </Empty>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.data.map((keyword) => (
          <Link
            key={keyword.id}
            to="/keywords/$keywordId"
            params={{ keywordId: String(keyword.id) }}
            className="card p-4 transition hover:border-slate-300 hover:shadow"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">{keyword.name}</h2>
              {!keyword.isActive && (
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">비활성</span>
              )}
            </div>
            {keyword.note && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{keyword.note}</p>}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
              <div>
                <dt className="label">댓글</dt>
                <dd className="text-sm font-medium text-slate-800">{formatNumber(keyword.commentCount)}</dd>
              </div>
              <div>
                <dt className="label">영상</dt>
                <dd className="text-sm font-medium text-slate-800">{formatNumber(keyword.videoCount)}</dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] text-slate-400">
              최근 수집 {formatDateTime(keyword.lastCrawledAt)}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
