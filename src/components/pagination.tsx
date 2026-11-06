import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip } from './tooltip';

export interface PaginationProps {
  page: number;
  pages?: number;
  totalPages?: number;
  onChange?: (page: number) => void;
  onPageChange?: (page: number) => void;
}

export function Pagination({
  page,
  pages,
  totalPages,
  onChange,
  onPageChange,
}: PaginationProps) {
  const resolvedPages = pages ?? totalPages ?? 1;
  const handleChange = onChange ?? onPageChange;
  if (resolvedPages <= 1) return null;
  const current = Math.min(page, resolvedPages);

  return (
    <nav className="pagination" aria-label="Pagination">
      <Tooltip label="Previous page">
        <button
          type="button"
          className="icon-btn btn-xs"
          aria-label="Previous page"
          disabled={current <= 1}
          onClick={() => handleChange?.(current - 1)}
        >
          <ChevronLeft size={14} />
        </button>
      </Tooltip>
      <span className="pagination-status">
        {current} / {resolvedPages}
      </span>
      <Tooltip label="Next page">
        <button
          type="button"
          className="icon-btn btn-xs"
          aria-label="Next page"
          disabled={current >= resolvedPages}
          onClick={() => handleChange?.(current + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </Tooltip>
    </nav>
  );
}
