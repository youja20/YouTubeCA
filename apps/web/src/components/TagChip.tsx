import { Link } from '@tanstack/react-router';
import { POLARITY_CLASS, polarityOf } from '../lib/format';

interface TagChipProps {
  tagId?: number;
  name: string;
  polarity?: number | null;
  strength?: number;
  /** 강도에 따라 글자 크기를 키운다 (§7.0 태그 클라우드) */
  scaleByStrength?: boolean;
  onClick?: () => void;
}

export function TagChip({ tagId, name, polarity, strength, scaleByStrength, onClick }: TagChipProps) {
  const tone = POLARITY_CLASS[polarityOf(polarity)];
  const size =
    scaleByStrength && strength !== undefined
      ? strength >= 75
        ? 'text-base font-semibold'
        : strength >= 45
          ? 'text-sm font-medium'
          : 'text-xs'
      : 'text-xs font-medium';

  const className = `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition hover:brightness-95 ${tone} ${size}`;
  const content = (
    <>
      <span>#{name}</span>
      {strength !== undefined && <span className="opacity-60">{strength}</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {content}
      </button>
    );
  }
  if (tagId !== undefined) {
    return (
      <Link to="/tags/$tagId" params={{ tagId: String(tagId) }} className={className}>
        {content}
      </Link>
    );
  }
  return <span className={className}>{content}</span>;
}
