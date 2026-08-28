import { POLARITY_BAR, polarityOf } from '../lib/format';

interface StrengthBarProps {
  strength: number;
  polarity?: number | null;
  className?: string;
}

export function StrengthBar({ strength, polarity, className = '' }: StrengthBarProps) {
  const tone = POLARITY_BAR[polarityOf(polarity)];
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${tone}`}
        style={{ width: `${Math.max(2, Math.min(100, strength))}%` }}
      />
    </div>
  );
}
