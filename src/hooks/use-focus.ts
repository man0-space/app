import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface UseFocusReturn<K extends string = string> {
  containerRef: RefObject<HTMLDivElement | null>;
  focused: K | null;
  toggleFocus: (block: K) => void;
}

export function useFocus<K extends string = string>(): UseFocusReturn<K> {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const firstRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const [focused, setFocused] = useState<K | null>(null);

  const toggleFocus = useCallback((block: K) => {
    const container = containerRef.current;
    if (
      container &&
      typeof window !== 'undefined' &&
      !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) {
      const rects = new Map<string, DOMRect>();
      container.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => {
        const key = el.dataset.block;
        if (key) rects.set(key, el.getBoundingClientRect());
      });
      firstRectsRef.current = rects;
    } else {
      firstRectsRef.current = null;
    }

    setFocused((prev) => (prev === block ? null : block));
  }, []);

  useLayoutEffect(() => {
    const firstRects = firstRectsRef.current;
    const container = containerRef.current;
    firstRectsRef.current = null;
    if (!firstRects || !container) return;

    container.querySelectorAll<HTMLElement>('[data-block]').forEach((el) => {
      const key = el.dataset.block;
      if (!key) return;
      const first = firstRects.get(key);
      if (!first) return;
      const last = el.getBoundingClientRect();
      if (last.width <= 0 || last.height <= 0) return;

      const dx = first.left - last.left;
      const dy = first.top - last.top;
      const dw = first.width / last.width;
      const dh = first.height / last.height;

      if (
        Math.abs(dx) < 1 &&
        Math.abs(dy) < 1 &&
        Math.abs(dw - 1) < 0.01 &&
        Math.abs(dh - 1) < 0.01
      ) {
        return;
      }

      if (typeof el.animate === 'function') {
        el.animate(
          [
            {
              transformOrigin: 'top left',
              transform: `translate(${dx}px, ${dy}px) scale(${dw}, ${dh})`,
            },
            {
              transformOrigin: 'top left',
              transform: 'none',
            },
          ],
          {
            duration: 320,
            easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
            fill: 'none',
          },
        );
      }
    });
  }, [focused]);

  return { containerRef, focused, toggleFocus };
}
