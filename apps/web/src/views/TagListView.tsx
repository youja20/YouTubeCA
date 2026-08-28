import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { Empty, ErrorBlock, Loading } from '../components/StateBlocks';
import { formatNumber, POLARITY_CLASS, polarityOf } from '../lib/format';

export function TagListView() {
  const [q, setQ] = useState('');
  const { data, isPending, error } = useQuery({
    queryKey: ['tags', q],
    queryFn: () => api.listTags({ q: q || undefined, limit: 200 }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">태그</h1>
        <input
          className="input max-w-xs"
          placeholder="태그 검색"
          value={q}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {isPending && <Loading />}
      {error && <ErrorBlock error={error} />}
      {data && data.data.length === 0 && <Empty>추출된 태그가 없습니다</Empty>}

      <div className="flex flex-wrap gap-2">
        {data?.data.map((tag) => (
          <Link
            key={tag.id}
            to="/tags/$tagId"
            params={{ tagId: String(tag.id) }}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition hover:brightness-95 ${POLARITY_CLASS[polarityOf(tag.polarity)]}`}
          >
            <span className="font-medium">#{tag.name}</span>
            <span className="text-xs opacity-70">{formatNumber(tag.totalCommentCount)}</span>
            <span className="rounded bg-white/60 px-1.5 text-[10px]">{tag.category ?? '기타'}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
