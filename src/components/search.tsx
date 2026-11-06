import { useRef, useState } from 'react';
import { Search as SearchIcon, X } from 'lucide-react';
import { Tooltip } from './tooltip';

export interface SearchProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  collapsible?: boolean;
}

export function Search({
  label,
  value,
  onChange,
  placeholder = 'Search...',
  collapsible = false,
}: SearchProps) {
  const [expanded, setExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resolvedLabel = label || placeholder || 'Search';
  const isOpen = !collapsible || expanded || Boolean(value.trim());

  if (collapsible && !isOpen) {
    return (
      <Tooltip label={resolvedLabel}>
        <button
          type="button"
          className="icon-btn btn-sm search-toggle"
          aria-label={resolvedLabel}
          onClick={() => {
            setExpanded(true);
            window.setTimeout(() => inputRef.current?.focus(), 20);
          }}
        >
          <SearchIcon size={14} />
        </button>
      </Tooltip>
    );
  }

  return (
    <div
      className={`search ${collapsible ? 'is-collapsible' : ''}`.trim()}
      data-collapsible={collapsible || undefined}
      data-expanded={expanded || Boolean(value.trim()) || undefined}
    >
      <SearchIcon size={13} className="search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        aria-label={resolvedLabel}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (!value.trim()) setExpanded(false);
        }}
      />
      {value ? (
        <Tooltip label="Clear">
          <button
            type="button"
            className="search-clear"
            aria-label={`Clear ${resolvedLabel.toLowerCase()}`}
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
          >
            <X size={12} />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}
