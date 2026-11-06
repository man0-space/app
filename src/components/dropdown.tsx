import {
  type UIEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, type LucideIcon } from 'lucide-react';
import { useDismiss } from '../hooks/use-dismiss';
import { Search } from './search';
import { Tooltip } from './tooltip';

export type Option<T extends string = string> = {
  value: T;
  label: string;
  detail?: string;
  sublabel?: string;
  badge?: string;
  tooltip?: string;
  icon?: LucideIcon;
  logo?: string;
  logos?: string[];
};

export type DropdownOption<T extends string = string> = Option<T>;

export interface DropdownProps<T extends string = string> {
  label?: string;
  placeholder?: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  variant?: 'field' | 'pill' | 'compact';
  align?: 'start' | 'end';
  disabled?: boolean;
  icon?: ReactNode;
  iconOnlyMobile?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}

const DROPDOWN_PAGE = 80;

export function Dropdown<T extends string = string>({
  label,
  placeholder,
  value,
  options,
  onChange,
  variant = 'pill',
  align = 'start',
  disabled,
  icon,
  iconOnlyMobile = false,
  searchable: searchableProp,
  searchPlaceholder = 'Filter...',
}: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(DROPDOWN_PAGE);
  const id = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const dismissRefs = useMemo(() => [root, menuRef] as const, []);
  const current =
    options.find((option) => option.value === value) ?? (placeholder ? undefined : options[0]);
  const searchable = searchableProp ?? options.length > 8;
  const visibleText = current?.label ?? placeholder ?? String(value);
  const resolvedLabel = label || placeholder || current?.label || 'Select option';
  const triggerAriaLabel =
    label && visibleText && !label.toLowerCase().includes(visibleText.toLowerCase())
      ? `${label}: ${visibleText}`
      : resolvedLabel;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) =>
      `${o.label} ${o.value} ${o.detail ?? ''} ${o.sublabel ?? ''} ${o.badge ?? ''}`
        .toLowerCase()
        .includes(term),
    );
  }, [options, query]);

  useEffect(() => {
    setVisibleLimit(DROPDOWN_PAGE);
  }, [open, query]);

  const visibleOptions = useMemo(
    () => (filtered.length > DROPDOWN_PAGE ? filtered.slice(0, visibleLimit) : filtered),
    [filtered, visibleLimit],
  );

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (visibleLimit >= filtered.length) return;
      const el = event.currentTarget;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 160) {
        setVisibleLimit((curr) => Math.min(curr + DROPDOWN_PAGE, filtered.length));
      }
    },
    [visibleLimit, filtered.length],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setVisibleLimit(DROPDOWN_PAGE);
  }, []);

  const place = useCallback(() => {
    const trigger = root.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const rect = trigger.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const pad = 8;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (variant === 'field') {
      const fieldWidth = Math.min(Math.round(rect.width), vw - pad * 2);
      menu.style.setProperty('--drop-w', `${fieldWidth}px`);
      menu.style.setProperty('--drop-min-w', `${fieldWidth}px`);
    } else {
      menu.style.setProperty('--drop-w', 'auto');
      menu.style.setProperty(
        '--drop-min-w',
        `${Math.min(Math.max(Math.round(rect.width), 220), vw - pad * 2)}px`,
      );
    }

    const spaceBelow = vh - rect.bottom - gap - pad;
    const spaceAbove = rect.top - gap - pad;
    const openAbove = spaceBelow < 190 && spaceAbove > spaceBelow;
    const availBlock = Math.max(140, openAbove ? spaceAbove : spaceBelow);
    const searchChrome = searchable ? 52 : 14;
    menu.style.setProperty(
      '--drop-list-max-h',
      `${Math.min(256, Math.max(108, Math.floor(availBlock - searchChrome)))}px`,
    );

    const box = menu.getBoundingClientRect();
    const rawX = align === 'end' ? rect.right - box.width : rect.left;
    const x = Math.min(Math.max(rawX, pad), Math.max(pad, vw - box.width - pad));
    const y = openAbove
      ? Math.max(pad, rect.top - gap - box.height)
      : Math.min(rect.bottom + gap, Math.max(pad, vh - box.height - pad));

    menu.style.setProperty('--drop-x', `${Math.round(x)}px`);
    menu.style.setProperty('--drop-y', `${Math.round(y)}px`);
  }, [align, searchable, variant]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, filtered.length, query]);

  useDismiss(open, dismissRefs, close, 30);

  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) {
        return;
      }
      place();
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, place]);

  const Icon = current?.icon;
  const triggerNode = (
    <button
      type="button"
      className="dropdown-trigger"
      aria-label={triggerAriaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? id : undefined}
      disabled={disabled}
      onClick={() => (open ? close() : setOpen(true))}
    >
      <span className="dropdown-value">
        {icon ? (
          icon
        ) : current?.logos?.length ? (
          <span className="dropdown-logos" aria-hidden="true">
            {current.logos.map((src, i) => (
              <img key={i} src={src} alt="" className="dropdown-logo" />
            ))}
          </span>
        ) : current?.logo ? (
          <img src={current.logo} alt="" className="dropdown-logo" aria-hidden="true" />
        ) : Icon ? (
          <Icon size={13} className="dropdown-icon" aria-hidden="true" />
        ) : null}
        <span
          className={`dropdown-label ${iconOnlyMobile && (icon || Icon || current?.logo) ? 'hide-mobile' : ''}`.trim()}
        >
          {current?.label ?? placeholder ?? value}
        </span>
        {(current?.detail || current?.sublabel) && variant === 'field' ? (
          <small className="dropdown-detail">{current.detail ?? current.sublabel}</small>
        ) : null}
      </span>
      <ChevronDown size={13} className="dropdown-caret" aria-hidden="true" />
    </button>
  );

  return (
    <div
      ref={root}
      className="dropdown"
      data-variant={variant}
      data-align={align}
      data-open={open || undefined}
      data-icon-mobile={iconOnlyMobile || undefined}
    >
      {current?.tooltip || label ? (
        <Tooltip label={resolvedLabel} description={current?.tooltip}>
          {triggerNode}
        </Tooltip>
      ) : (
        triggerNode
      )}
      {open
        ? createPortal(
          <div
            ref={menuRef}
            id={id}
            role="listbox"
            aria-label={resolvedLabel}
            data-variant={variant}
            className="dropdown-menu stealth-glass"
          >
            {searchable ? (
              <div className="dropdown-search">
                <Search
                  label={`Search ${resolvedLabel}`}
                  value={query}
                  onChange={setQuery}
                  placeholder={searchPlaceholder}
                />
              </div>
            ) : null}
            <div className="dropdown-list scroll-area" onScroll={handleListScroll}>
              {visibleOptions.length ? (
                visibleOptions.map((option) => {
                  const active = option.value === value;
                  const OptionIcon = option.icon;
                  const subText = option.detail ?? option.sublabel;
                  const item = (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className="dropdown-option"
                      data-active={active || undefined}
                      onClick={() => {
                        onChange(option.value);
                        close();
                      }}
                    >
                      <span className="dropdown-option-main">
                        {option.logos?.length ? (
                          <span className="dropdown-logos" aria-hidden="true">
                            {option.logos.map((src, i) => (
                              <img key={i} src={src} alt="" className="dropdown-logo" />
                            ))}
                          </span>
                        ) : option.logo ? (
                          <img
                            src={option.logo}
                            alt=""
                            className="dropdown-logo"
                            aria-hidden="true"
                          />
                        ) : OptionIcon ? (
                          <OptionIcon size={13} className="dropdown-icon" aria-hidden="true" />
                        ) : null}
                        <span className="dropdown-option-text">
                          <span>{option.label}</span>
                          {subText ? <small>{subText}</small> : null}
                        </span>
                      </span>
                      <span className="dropdown-option-side">
                        {option.badge ? <code>{option.badge}</code> : null}
                        {active ? <Check size={13} aria-hidden="true" /> : null}
                      </span>
                    </button>
                  );
                  return option.tooltip ? (
                    <Tooltip key={option.value} label={option.label} description={option.tooltip}>
                      {item}
                    </Tooltip>
                  ) : (
                    item
                  );
                })
              ) : (
                <p className="dropdown-empty">No matches</p>
              )}
            </div>
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}
