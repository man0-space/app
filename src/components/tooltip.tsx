import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type TouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { shortenInlineAddresses } from '../lib/contracts';

type TriggerProps = HTMLAttributes<HTMLElement> & {
  'aria-describedby'?: string;
};

export interface TooltipProps {
  label?: string;
  title?: string;
  content?: string;
  description?: string;
  className?: string;
  position?: 'top' | 'bottom';
  children: ReactElement<TriggerProps>;
}

export function Tooltip({
  label,
  title,
  content,
  description,
  position = 'bottom',
  children,
}: TooltipProps) {
  const rawLabel = label ?? content ?? title ?? '';
  const resolvedLabel = shortenInlineAddresses(rawLabel);
  const resolvedDescription = description ? shortenInlineAddresses(description) : undefined;
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLSpanElement | null>(null);
  const timer = useRef<number | null>(null);

  function clearTimer() {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }

  function place() {
    const target = anchor.current;
    const node = tip.current;
    if (!target || !node) return;
    const rect = target.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    const pad = 8;
    const x = Math.min(
      Math.max(rect.left + rect.width / 2 - box.width / 2, pad),
      window.innerWidth - box.width - pad,
    );
    const preferTop = position === 'top';
    const below = rect.bottom + pad;
    const above = rect.top - box.height - pad;
    let y: number;
    if (preferTop) {
      y = above >= pad ? above : Math.max(pad, below);
    } else {
      y =
        below + box.height <= window.innerHeight - pad || above < pad
          ? below
          : above;
    }
    node.style.setProperty('--tip-x', `${Math.round(x)}px`);
    node.style.setProperty('--tip-y', `${Math.round(y)}px`);
  }

  useLayoutEffect(() => {
    if (open) place();
  }, [open, resolvedLabel, resolvedDescription]);

  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(false);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', hide, true);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', hide, true);
    };
  }, [open]);

  useEffect(() => () => clearTimer(), []);

  if (!resolvedLabel.trim()) return children;

  return (
    <>
      {cloneElement(children, {
        'aria-describedby': open ? id : undefined,
        onMouseEnter: (e: MouseEvent<HTMLElement>) => {
          anchor.current = e.currentTarget;
          clearTimer();
          timer.current = window.setTimeout(() => setOpen(true), 80);
          children.props.onMouseEnter?.(e);
        },
        onMouseLeave: (e: MouseEvent<HTMLElement>) => {
          clearTimer();
          setOpen(false);
          children.props.onMouseLeave?.(e);
        },
        onPointerDown: (e: MouseEvent<HTMLElement>) => {
          clearTimer();
          setOpen(false);
          children.props.onPointerDown?.(e as never);
        },
        onFocus: (e: FocusEvent<HTMLElement>) => {
          anchor.current = e.currentTarget;
          if (e.currentTarget.matches(':focus-visible')) setOpen(true);
          children.props.onFocus?.(e);
        },
        onBlur: (e: FocusEvent<HTMLElement>) => {
          clearTimer();
          setOpen(false);
          children.props.onBlur?.(e);
        },
        onTouchStart: (e: TouchEvent<HTMLElement>) => {
          anchor.current = e.currentTarget;
          clearTimer();
          timer.current = window.setTimeout(() => setOpen(true), 420);
          children.props.onTouchStart?.(e);
        },
        onTouchEnd: (e: TouchEvent<HTMLElement>) => {
          clearTimer();
          timer.current = window.setTimeout(() => setOpen(false), 900);
          children.props.onTouchEnd?.(e);
        },
      })}
      {open &&
        createPortal(
          <span ref={tip} id={id} role="tooltip" className="tooltip">
            <span className="tooltip-title">{resolvedLabel}</span>
            {resolvedDescription ? (
              <span className="tooltip-desc">{resolvedDescription}</span>
            ) : null}
          </span>,
          document.body,
        )}
    </>
  );
}
