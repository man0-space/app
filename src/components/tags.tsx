import { ChevronUp, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOptions } from '../hooks/use-options';
import type { TaskCategoryGroup } from '../lib/api';
import { COMPACT_CANVAS_MAX_WIDTH } from '../lib/graph';
import { Dropdown, type DropdownOption } from './dropdown';
import { Tooltip } from './tooltip';

export function buildCategoryFilterOptions(
  categories: readonly TaskCategoryGroup[],
): DropdownOption[] {
  const opts: DropdownOption[] = [{ value: 'all', label: 'All categories' }];
  for (const group of categories) {
    opts.push({
      value: `group:${group.id}`,
      label: group.label,
      badge: `${group.tags.length}`,
    });
  }
  for (const group of categories) {
    for (const tag of group.tags) {
      opts.push({
        value: `tag:${tag.label}`,
        label: tag.label,
        sublabel: group.label,
      });
    }
  }
  return opts;
}

export function matchesCategoryFilter(
  tasks: readonly string[],
  filterValue: string,
  categoryByTag: ReadonlyMap<string, TaskCategoryGroup>,
): boolean {
  if (!filterValue || filterValue === 'all') return true;
  if (filterValue.startsWith('tag:')) {
    const target = filterValue.slice(4).toLowerCase();
    return tasks.some((t) => t.toLowerCase() === target);
  }
  if (filterValue.startsWith('group:')) {
    const groupId = filterValue.slice(6);
    return tasks.some((t) => categoryByTag.get(t)?.id === groupId);
  }
  return true;
}

interface TaskPillsProps {
  tasks: readonly string[];
  maxVisible?: number;
  mobileMaxVisible?: number;
  collapsible?: boolean;
  activeTag?: string | null;
  onSelectTag?: (tag: string) => void;
}

function useCompactTagsViewport(): boolean {
  const [compact, setCompact] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= COMPACT_CANVAS_MAX_WIDTH : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${COMPACT_CANVAS_MAX_WIDTH}px)`);
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return compact;
}

interface TagPillItemProps {
  tag: string;
  isActive: boolean;
  onSelectTag?: (tag: string) => void;
}

function TagPillItem({ tag, isActive, onSelectTag }: TagPillItemProps) {
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = labelRef.current;
    if (!el) return;
    const check = () => {
      setTruncated(el.scrollWidth > el.clientWidth + 1);
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tag]);

  const pill = onSelectTag ? (
    <button
      type="button"
      className={`wf-tag wf-tag-btn ${isActive ? 'is-active' : ''}`.trim()}
      aria-pressed={isActive}
      onClick={() => onSelectTag(tag)}
    >
      <span ref={labelRef} className="wf-tag-label">
        {tag}
      </span>
    </button>
  ) : (
    <span className="wf-tag">
      <span ref={labelRef} className="wf-tag-label">
        {tag}
      </span>
    </span>
  );

  return truncated ? <Tooltip label={tag}>{pill}</Tooltip> : pill;
}

export function TaskPills({
  tasks,
  maxVisible = 2,
  mobileMaxVisible = 1,
  collapsible = true,
  activeTag,
  onSelectTag,
}: TaskPillsProps) {
  const isCompact = useCompactTagsViewport();
  const [expanded, setExpanded] = useState(false);

  if (!tasks || tasks.length === 0) return null;

  const limit = Math.max(1, isCompact ? mobileMaxVisible : maxVisible);
  const canCollapse = collapsible && tasks.length > limit;
  const visible = canCollapse && expanded ? tasks : tasks.slice(0, limit);
  const hidden = tasks.slice(limit);
  const overflowCount = tasks.length - visible.length;

  return (
    <div
      className={`wf-tags ${expanded ? 'is-expanded' : ''}`.trim()}
      onClick={onSelectTag || canCollapse ? (e) => e.stopPropagation() : undefined}
    >
      {visible.map((tag) => {
        const isActive = Boolean(activeTag && activeTag.toLowerCase() === tag.toLowerCase());
        return (
          <TagPillItem
            key={tag}
            tag={tag}
            isActive={isActive}
            onSelectTag={onSelectTag}
          />
        );
      })}
      {overflowCount > 0 ? (
        <Tooltip
          label={`+${overflowCount} more`}
          description={hidden.join(' · ')}
        >
          {canCollapse ? (
            <button
              type="button"
              className="wf-tag wf-tag-toggle is-overflow"
              aria-expanded={false}
              aria-label={`+${overflowCount} more categories`}
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
            >
              +{overflowCount}
            </button>
          ) : (
            <span className="wf-tag is-overflow">+{overflowCount}</span>
          )}
        </Tooltip>
      ) : canCollapse && expanded ? (
        <Tooltip label="Collapse categories">
          <button
            type="button"
            className="wf-tag wf-tag-toggle is-collapse"
            aria-expanded={true}
            aria-label="Categories"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(false);
            }}
          >
            <ChevronUp size={11} aria-hidden="true" />
          </button>
        </Tooltip>
      ) : null}
    </div>
  );
}

interface TaskPickerProps {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  required?: boolean;
}

export function TaskPicker({
  value,
  onChange,
  disabled = false,
  required = false,
}: TaskPickerProps) {
  const { categories, maxTaskTags } = useOptions();

  const availableOptions = useMemo<DropdownOption[]>(() => {
    const chosen = new Set(value.map((t) => t.toLowerCase()));
    const list: DropdownOption[] = [];
    for (const group of categories) {
      for (const tag of group.tags) {
        if (!chosen.has(tag.label.toLowerCase())) {
          list.push({
            value: tag.label,
            label: tag.label,
            sublabel: `${group.label} · ${tag.desc}`,
          });
        }
      }
    }
    return list;
  }, [categories, value]);

  const handleAdd = (tag: string) => {
    if (!tag || value.length >= maxTaskTags) return;
    if (value.some((existing) => existing.toLowerCase() === tag.toLowerCase())) return;
    onChange([...value, tag]);
  };

  const handleRemove = (tag: string) => {
    onChange(value.filter((item) => item !== tag));
  };

  return (
    <div className="field">
      <div className="field-head-row">
        <span className="field-label">
          Categories{required ? ' *' : ''} ({value.length}/{maxTaskTags})
        </span>
      </div>

      {value.length > 0 ? (
        <div className="task-picker-chips">
          {value.map((tag) => (
            <span key={tag} className="wf-tag is-removable">
              <span className="wf-tag-label">{tag}</span>
              <button
                type="button"
                className="wf-tag-remove"
                aria-label={`Remove ${tag}`}
                disabled={disabled}
                onClick={() => handleRemove(tag)}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {value.length < maxTaskTags ? (
        <Dropdown
          variant="field"
          placeholder={
            value.length === 0 ? 'Select task category...' : 'Add another category...'
          }
          value=""
          options={availableOptions}
          onChange={handleAdd}
          disabled={disabled || availableOptions.length === 0}
          searchable
          searchPlaceholder="Search categories..."
        />
      ) : null}
    </div>
  );
}
