import type { CommentDto } from '@youtubeca/shared';
import { formatDate, formatNumber, POLARITY_CLASS, polarityOf } from '../lib/format';
import { TagChip } from './TagChip';

interface CommentCardProps {
  comment: CommentDto;
  /** 본문에서 강조할 태그명 (§7.3 하이라이트) */
  highlight?: string[];
  showKeywordBadge?: boolean;
  onClick?: () => void;
}

/** 태그명을 댓글 본문에서 찾아 강조한다 */
function highlightText(text: string, terms: string[]) {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (cleaned.length === 0) return text;

  const escaped = cleaned.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
  const parts = text.split(pattern);
  return parts.map((part, index) =>
    pattern.test(part) && cleaned.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
      <mark key={index} className="rounded bg-amber-100 px-0.5 text-slate-900">
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

export function CommentCard({ comment, highlight = [], showKeywordBadge, onClick }: CommentCardProps) {
  const tone = POLARITY_CLASS[polarityOf(comment.sentimentScore)];

  return (
    <article
      className={`rounded-lg border border-slate-200 bg-white p-4 ${onClick ? 'cursor-pointer hover:border-slate-300 hover:shadow-sm' : ''}`}
      onClick={onClick}
    >
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">
        {highlightText(comment.text, highlight)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
        <span>👍 {formatNumber(comment.likeCount)}</span>
        <span>{formatDate(comment.publishedAt)}</span>
        {comment.author && <span className="truncate max-w-[10rem]">{comment.author}</span>}
        <span className={`rounded border px-1.5 py-0.5 ${tone}`}>
          {comment.sentimentScore === null ? '중립' : comment.sentimentScore.toFixed(2)}
        </span>
        {showKeywordBadge && comment.keywordName && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
            {comment.keywordName}
          </span>
        )}
      </div>

      {comment.matchedTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {comment.matchedTags.slice(0, 6).map((tag) => (
            <TagChip key={tag.id} tagId={tag.id} name={tag.name} />
          ))}
        </div>
      )}

      <a
        href={comment.url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="text-red-500">▶</span>
        <span className="truncate">{comment.videoTitle ?? comment.videoId}</span>
      </a>
    </article>
  );
}
