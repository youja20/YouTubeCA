export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return value.toLocaleString('ko-KR');
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

export function formatDuration(from: string | null, to: string | null): string {
  if (!from) return '-';
  const start = new Date(from).getTime();
  const end = to ? new Date(to).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 ${seconds % 60}초`;
  return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
}

export type Polarity = 'positive' | 'neutral' | 'negative';

export function polarityOf(score: number | null | undefined): Polarity {
  if (score === null || score === undefined) return 'neutral';
  if (score >= 0.15) return 'positive';
  if (score <= -0.15) return 'negative';
  return 'neutral';
}

export const POLARITY_LABEL: Record<Polarity, string> = {
  positive: '긍정',
  neutral: '중립',
  negative: '부정',
};

/** 태그 칩 색상 — 긍정=청록, 부정=적색, 중립=회색 (§7.0) */
export const POLARITY_CLASS: Record<Polarity, string> = {
  positive: 'bg-teal-50 text-teal-700 border-teal-200',
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  negative: 'bg-red-50 text-red-700 border-red-200',
};

export const POLARITY_BAR: Record<Polarity, string> = {
  positive: 'bg-teal-500',
  neutral: 'bg-slate-400',
  negative: 'bg-red-500',
};
