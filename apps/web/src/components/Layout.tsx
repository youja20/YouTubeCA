import { Link, Outlet, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';

const NAV = [
  { to: '/keywords', label: '키워드' },
  { to: '/tags', label: '태그' },
  { to: '/comments', label: '커멘트' },
  { to: '/settings', label: '설정' },
] as const;

/** 상단 글로벌 검색 — 키워드/태그 통합 (§7.0) */
function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['search', term],
    queryFn: async () => {
      const [keywords, tags] = await Promise.all([
        api.listKeywords({ q: term }),
        api.listTags({ q: term, limit: 8 }),
      ]);
      return { keywords: keywords.data.slice(0, 8), tags: tags.data };
    },
    enabled: term.trim().length > 0,
  });

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const hasResults = (data?.keywords.length ?? 0) + (data?.tags.length ?? 0) > 0;

  return (
    <div ref={boxRef} className="relative w-full max-w-md">
      <input
        className="input"
        placeholder="키워드 · 태그 통합 검색"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && term.trim() && (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          {!hasResults && <div className="px-3 py-3 text-xs text-slate-400">결과가 없습니다</div>}
          {data?.keywords.map((keyword) => (
            <button
              key={`k-${keyword.id}`}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                setTerm('');
                void navigate({ to: '/keywords/$keywordId', params: { keywordId: String(keyword.id) } });
              }}
            >
              <span>
                <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">키워드</span>
                {keyword.name}
              </span>
              <span className="text-xs text-slate-400">{formatNumber(keyword.commentCount)}</span>
            </button>
          ))}
          {data?.tags.map((tag) => (
            <button
              key={`t-${tag.id}`}
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              onClick={() => {
                setOpen(false);
                setTerm('');
                void navigate({ to: '/tags/$tagId', params: { tagId: String(tag.id) } });
              }}
            >
              <span>
                <span className="mr-2 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] text-teal-600">태그</span>#
                {tag.name}
              </span>
              <span className="text-xs text-slate-400">{formatNumber(tag.totalCommentCount)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DaemonBadge() {
  const { data } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 15_000,
  });
  const health = data?.data;
  if (!health) return null;

  const items = [
    { label: '데몬', ok: health.daemon.alive },
    { label: 'LLM', ok: health.llm.ok },
  ];
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1">
          <span className={`h-2 w-2 rounded-full ${item.ok ? 'bg-teal-500' : 'bg-slate-300'}`} />
          {item.label}
        </span>
      ))}
      <span>
        quota {formatNumber(health.youtube.quotaUsed)}/{formatNumber(health.youtube.quotaLimit)}
      </span>
    </div>
  );
}

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <Link to="/keywords" className="text-lg font-bold tracking-tight">
            YouTube<span className="text-teal-600">CA</span>
          </Link>
          <GlobalSearch />
          <div className="ml-auto">
            <DaemonBadge />
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-6 py-6">
        <nav className="w-40 shrink-0">
          <ul className="sticky top-20 space-y-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                  activeProps={{ className: 'block rounded-lg px-3 py-2 text-sm font-semibold bg-slate-900 text-white' }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
