import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Fragment, useMemo, useState } from 'react';
import type { RunDto, Settings } from '@youtubeca/shared';
import { STAGE_LABELS } from '@youtubeca/shared';
import { api } from '../lib/api';
import { Empty, ErrorBlock, Loading } from '../components/StateBlocks';
import { useLogStream } from '../hooks/useLogStream';
import { formatDateTime, formatDuration, formatNumber } from '../lib/format';

const RUN_STATUS_LABEL: Record<string, string> = {
  queued: '대기',
  running: '실행 중',
  done: '완료',
  failed: '실패',
  cancelled: '취소됨',
  paused_quota: 'quota 보류',
};

const RUN_STATUS_CLASS: Record<string, string> = {
  queued: 'bg-slate-100 text-slate-600',
  running: 'bg-blue-50 text-blue-700',
  done: 'bg-teal-50 text-teal-700',
  failed: 'bg-red-50 text-red-700',
  cancelled: 'bg-slate-100 text-slate-500',
  paused_quota: 'bg-amber-50 text-amber-700',
};

export function SettingsView() {
  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">설정</h1>
      <KeywordManager />
      <RunPanel />
      <LogPanel />
      <AdvancedSettings />
    </div>
  );
}

/* ─────────────── ① 키워드 등록/관리 ─────────────── */

function KeywordManager() {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['keywords', 'updated', ''],
    queryFn: () => api.listKeywords({ sort: 'updated' }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['keywords'] });
    void queryClient.invalidateQueries({ queryKey: ['keywords-all'] });
  };

  const create = useMutation({
    mutationFn: (names: string[]) => api.createKeywordsBulk(names),
    onSuccess: (result) => {
      setInput('');
      setMessage(null);
      const added = result.data.map((k) => k.name);
      const runId = result.meta?.runId;
      setNotice(
        added.length === 0
          ? '이미 등록된 키워드입니다'
          : runId
            ? `키워드 ${added.length}개 등록 — 크롤링 Run #${runId}을 큐에 넣었습니다`
            : `키워드 ${added.length}개 등록 (자동 실행 꺼짐 — 아래 [전체 실행]으로 시작하세요)`,
      );
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err) => {
      setNotice(null);
      setMessage(err instanceof Error ? err.message : String(err));
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      api.updateKeyword(id, { isActive }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.deleteKeyword(id),
    onSuccess: invalidate,
  });

  const submit = () => {
    const names = input
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    create.mutate(names);
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">① 키워드 등록 / 관리</h2>
        <span className="text-[11px] text-slate-400">줄바꿈으로 여러 개 일괄 등록</span>
      </div>
      <div className="space-y-3 p-5">
        <div className="flex gap-2">
          <textarea
            className="input min-h-[2.5rem] flex-1 resize-y"
            rows={input.includes('\n') ? 4 : 1}
            placeholder="키워드 입력 (여러 줄 가능)"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !input.includes('\n')) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="btn-primary h-10 shrink-0" onClick={submit} disabled={create.isPending}>
            추가
          </button>
        </div>
        {message && <ErrorBlock error={new Error(message)} />}
        {notice && (
          <p className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
            {notice}
          </p>
        )}

        {isPending && <Loading />}
        {error && <ErrorBlock error={error} />}
        {data && data.data.length === 0 && <Empty>등록된 키워드가 없습니다</Empty>}

        {data && data.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="py-2">키워드</th>
                  <th className="py-2 text-right">댓글</th>
                  <th className="py-2 text-right">영상</th>
                  <th className="py-2">최근 수집</th>
                  <th className="py-2 text-center">활성</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {data.data.map((keyword) => (
                  <tr key={keyword.id} className="border-b border-slate-50">
                    <td className="py-2">
                      <Link
                        to="/keywords/$keywordId"
                        params={{ keywordId: String(keyword.id) }}
                        className="font-medium hover:underline"
                      >
                        {keyword.name}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(keyword.commentCount)}</td>
                    <td className="py-2 text-right tabular-nums">{formatNumber(keyword.videoCount)}</td>
                    <td className="py-2 text-xs text-slate-500">{formatDateTime(keyword.lastCrawledAt)}</td>
                    <td className="py-2 text-center">
                      <input
                        type="checkbox"
                        checked={keyword.isActive}
                        onChange={(event) =>
                          toggle.mutate({ id: keyword.id, isActive: event.target.checked })
                        }
                      />
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="btn-danger"
                        onClick={() => {
                          if (confirm(`「${keyword.name}」을(를) 삭제할까요? 분석 결과가 함께 삭제됩니다.`)) {
                            remove.mutate(keyword.id);
                          }
                        }}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* ─────────────── ② 크롤링 실행 ─────────────── */

function RunPanel() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);

  const keywords = useQuery({ queryKey: ['keywords-all'], queryFn: () => api.listKeywords({}) });
  const runs = useQuery({
    queryKey: ['runs'],
    queryFn: () => api.listRuns(10),
    refetchInterval: 4000,
  });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health(), refetchInterval: 10_000 });

  const activeRun = runs.data?.data.find((run) => run.status === 'running' || run.status === 'queued');

  const detail = useQuery({
    queryKey: ['run', activeRun?.id],
    queryFn: () => api.getRun(activeRun!.id),
    enabled: activeRun !== undefined,
    refetchInterval: 2000,
  });

  const start = useMutation({
    mutationFn: (ids?: number[]) => api.createRun(ids),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['runs'] }),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => api.cancelRun(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['runs'] }),
  });

  // 기본 키워드처럼 등록만 되고 아직 한 번도 수집되지 않은 키워드를 안내한다
  const uncrawled = (keywords.data?.data ?? []).filter((k) => k.isActive && k.lastCrawledAt === null);

  const quota = health.data?.data.youtube;
  const quotaPercent = quota ? Math.min(100, (quota.quotaUsed / quota.quotaLimit) * 100) : 0;
  const daemonAlive = health.data?.data.daemon.alive ?? false;

  const progress = useMemo(() => {
    const stages = detail.data?.data.stages ?? [];
    if (stages.length === 0) return null;
    const done = stages.filter((s) => s.status === 'done').length;
    const running = stages.find((s) => s.status === 'running');
    return {
      percent: Math.round((done / stages.length) * 100),
      running,
      done,
      total: stages.length,
    };
  }, [detail.data]);

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">② 크롤링 실행</h2>
        {!daemonAlive && (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">
            데몬이 실행 중이 아닙니다 — 잡은 큐에 쌓입니다
          </span>
        )}
      </div>
      <div className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={start.isPending || activeRun !== undefined}
            onClick={() => start.mutate(undefined)}
          >
            전체 실행 (활성 키워드)
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={selected.length === 0 || activeRun !== undefined}
            onClick={() => start.mutate(selected)}
          >
            선택 {selected.length}개 실행
          </button>
          {activeRun && (
            <button type="button" className="btn-danger" onClick={() => cancel.mutate(activeRun.id)}>
              취소
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {keywords.data?.data.map((keyword) => {
            const on = selected.includes(keyword.id);
            return (
              <button
                key={keyword.id}
                type="button"
                onClick={() =>
                  setSelected((prev) =>
                    prev.includes(keyword.id) ? prev.filter((id) => id !== keyword.id) : [...prev, keyword.id],
                  )
                }
                className={`rounded-full border px-2.5 py-1 text-xs transition ${
                  on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {keyword.name}
              </button>
            );
          })}
        </div>

        {uncrawled.length > 0 && !activeRun && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span>
              아직 수집되지 않은 키워드 {uncrawled.length}개: {uncrawled.map((k) => k.name).join(', ')}
            </span>
            <button
              type="button"
              className="btn-ghost ml-auto"
              onClick={() => start.mutate(uncrawled.map((k) => k.id))}
              disabled={start.isPending}
            >
              이 {uncrawled.length}개만 실행
            </button>
          </div>
        )}

        {activeRun && progress && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-blue-900">
                Run #{activeRun.id} 진행 중 — 스테이지 {progress.done}/{progress.total}
              </span>
              <span className="text-blue-700">{progress.percent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
              <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress.percent}%` }} />
            </div>
            {progress.running && (
              <p className="mt-2 text-xs text-blue-800">
                현재: {progress.running.keywordName ?? '-'} · {STAGE_LABELS[progress.running.stage]}{' '}
                {progress.running.progress}% {progress.running.message ? `· ${progress.running.message}` : ''}
              </p>
            )}
          </div>
        )}

        {quota && (
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>오늘 YouTube quota</span>
              <span>
                {formatNumber(quota.quotaUsed)} / {formatNumber(quota.quotaLimit)}
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${quotaPercent > 85 ? 'bg-red-500' : 'bg-slate-700'}`}
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
          </div>
        )}

        <RunHistory runs={runs.data?.data ?? []} />
      </div>
    </section>
  );
}

function RunHistory({ runs }: { runs: RunDto[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const detail = useQuery({
    queryKey: ['run', openId],
    queryFn: () => api.getRun(openId!),
    enabled: openId !== null,
  });

  if (runs.length === 0) return <Empty>실행 이력이 없습니다</Empty>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
            <th className="py-2">#</th>
            <th className="py-2">시작</th>
            <th className="py-2">대상</th>
            <th className="py-2">상태</th>
            <th className="py-2">소요</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            // 조건부 상세 행이 뒤따르므로 Fragment에 key를 둔다
            <Fragment key={run.id}>
              <tr
                className="cursor-pointer border-b border-slate-50 hover:bg-slate-50"
                onClick={() => setOpenId(openId === run.id ? null : run.id)}
              >
                <td className="py-2 tabular-nums">{run.id}</td>
                <td className="py-2 text-xs text-slate-600">{formatDateTime(run.startedAt ?? run.createdAt)}</td>
                <td className="py-2 text-xs text-slate-600">키워드 {run.keywordIds.length}개</td>
                <td className="py-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${RUN_STATUS_CLASS[run.status] ?? ''}`}>
                    {RUN_STATUS_LABEL[run.status] ?? run.status}
                  </span>
                </td>
                <td className="py-2 text-xs text-slate-500">
                  {formatDuration(run.startedAt, run.finishedAt)}
                </td>
              </tr>
              {openId === run.id && (
                <tr>
                  <td colSpan={5} className="bg-slate-50 px-3 py-3">
                    {run.error && <p className="mb-2 text-xs text-red-600">{run.error}</p>}
                    {detail.data ? (
                      <div className="grid gap-1.5 md:grid-cols-2">
                        {detail.data.data.stages.map((stage) => (
                          <div key={stage.id} className="flex items-center gap-2 text-xs">
                            <span className="w-24 truncate text-slate-600">{stage.keywordName ?? '-'}</span>
                            <span className="w-16 text-slate-500">{STAGE_LABELS[stage.stage]}</span>
                            <span
                              className={`w-14 rounded px-1.5 text-center ${
                                stage.status === 'done'
                                  ? 'bg-teal-50 text-teal-700'
                                  : stage.status === 'failed'
                                    ? 'bg-red-50 text-red-700'
                                    : stage.status === 'running'
                                      ? 'bg-blue-50 text-blue-700'
                                      : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {stage.status}
                            </span>
                            <span className="flex-1 truncate text-slate-400">{stage.message ?? ''}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <Loading label="스테이지 불러오는 중…" />
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────── ③ 실행 로그 ─────────────── */

function LogPanel() {
  const [level, setLevel] = useState('info');
  const [live, setLive] = useState(true);
  const stream = useLogStream({ level, enabled: live });

  const history = useQuery({
    queryKey: ['logs', level],
    queryFn: () => api.listLogs({ level, limit: 100 }),
    refetchInterval: live ? false : 10_000,
  });

  const rows = [...(history.data?.data ?? []).slice().reverse(), ...stream.logs];

  const download = () => {
    const text = rows
      .map((log) => `${log.ts} [${log.level.toUpperCase()}] ${log.stage ?? '-'} ${log.message}`)
      .join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `youtubeca-logs-${new Date().toISOString().slice(0, 19)}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">③ 실행 로그</h2>
        <div className="flex items-center gap-2 text-xs">
          <select className="input max-w-[7rem] py-1" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="debug">DEBUG+</option>
            <option value="info">INFO+</option>
            <option value="warn">WARN+</option>
            <option value="error">ERROR</option>
          </select>
          <button
            type="button"
            className={`rounded px-2 py-1 ${live ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-100'}`}
            onClick={() => setLive((prev) => !prev)}
          >
            {live ? `실시간 ${stream.connected ? '●' : '○'}` : '실시간 꺼짐'}
          </button>
          <button type="button" className="text-slate-500 hover:text-slate-800" onClick={download}>
            다운로드
          </button>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-200">
        {rows.length === 0 && <p className="text-slate-500">로그가 없습니다</p>}
        {rows.map((log) => (
          <div key={`${log.id}`} className="flex gap-2">
            <span className="shrink-0 text-slate-500">{log.ts.slice(11, 19)}</span>
            <span
              className={`w-12 shrink-0 ${
                log.level === 'error'
                  ? 'text-red-400'
                  : log.level === 'warn'
                    ? 'text-amber-300'
                    : log.level === 'debug'
                      ? 'text-slate-500'
                      : 'text-teal-300'
              }`}
            >
              {log.level.toUpperCase()}
            </span>
            <span className="w-16 shrink-0 text-slate-500">{log.stage ?? '-'}</span>
            <span className="break-all">{log.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────── ④ 고급 설정 ─────────────── */

const FIELDS: { key: keyof Settings; label: string; hint?: string; type: 'number' | 'text' | 'boolean' }[] = [
  { key: 'yt.maxVideosPerKeyword', label: '키워드당 영상 수', type: 'number' },
  { key: 'yt.maxCommentsPerVideo', label: '영상당 최대 댓글 수', type: 'number' },
  { key: 'yt.minCommentCount', label: '최소 댓글 수 임계값', type: 'number' },
  { key: 'yt.relevanceLanguage', label: '검색 언어', hint: '예: ko', type: 'text' },
  { key: 'yt.dailyQuota', label: '일일 quota 한도', type: 'number' },
  { key: 'scoring.wFreq', label: '가중치 w1 (빈도)', type: 'number' },
  { key: 'scoring.wDistinct', label: '가중치 w2 (변별력)', type: 'number' },
  { key: 'scoring.wEngage', label: '가중치 w3 (참여도)', type: 'number' },
  { key: 'scoring.wIntensity', label: '가중치 w4 (감성세기)', type: 'number' },
  {
    key: 'crawl.autoRunOnRegister',
    label: '키워드 등록 시 자동 크롤링',
    hint: '끄면 등록만 하고 실행은 수동으로',
    type: 'boolean',
  },
  { key: 'cron.enabled', label: '자동 실행 사용', type: 'boolean' },
  { key: 'cron.schedule', label: 'cron 표현식', hint: '기본 0 3 * * * (매일 03:00)', type: 'text' },
];

function AdvancedSettings() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<Settings>>({});

  const { data, isPending, error } = useQuery({ queryKey: ['settings'], queryFn: () => api.getSettings() });
  const save = useMutation({
    mutationFn: (patch: Partial<Settings>) => api.updateSettings(patch),
    onSuccess: () => {
      setDraft({});
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const settings = data?.data;
  const value = <K extends keyof Settings>(key: K): Settings[K] | undefined =>
    (draft[key] ?? settings?.[key]) as Settings[K] | undefined;

  return (
    <section className="card">
      <button
        type="button"
        className="card-header w-full text-left"
        onClick={() => setOpen((prev) => !prev)}
      >
        <h2 className="card-title">④ 고급 설정</h2>
        <span className="text-xs text-slate-400">{open ? '접기 ▲' : '펼치기 ▼'}</span>
      </button>
      {open && (
        <div className="space-y-4 p-5">
          {isPending && <Loading />}
          {error && <ErrorBlock error={error} />}
          {save.error && <ErrorBlock error={save.error} />}
          {settings && (
            <>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {FIELDS.map((field) => (
                  <label key={field.key} className="block">
                    <span className="label">{field.label}</span>
                    {field.type === 'boolean' ? (
                      <div className="mt-1">
                        <input
                          type="checkbox"
                          checked={Boolean(value(field.key))}
                          onChange={(event) =>
                            setDraft((prev) => ({ ...prev, [field.key]: event.target.checked }))
                          }
                        />
                      </div>
                    ) : (
                      <input
                        className="input mt-1"
                        type={field.type === 'number' ? 'number' : 'text'}
                        step={field.key.startsWith('scoring.') ? '0.05' : '1'}
                        value={String(value(field.key) ?? '')}
                        onChange={(event) =>
                          setDraft((prev) => ({
                            ...prev,
                            [field.key]:
                              field.type === 'number' ? Number(event.target.value) : event.target.value,
                          }))
                        }
                      />
                    )}
                    {field.hint && <span className="mt-1 block text-[11px] text-slate-400">{field.hint}</span>}
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={Object.keys(draft).length === 0 || save.isPending}
                  onClick={() => save.mutate(draft)}
                >
                  저장
                </button>
                <button type="button" className="btn-ghost" onClick={() => setDraft({})}>
                  되돌리기
                </button>
                <p className="text-xs text-slate-400">
                  가중치 w1~w4는 합이 1이 아니어도 자동 정규화됩니다.
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
