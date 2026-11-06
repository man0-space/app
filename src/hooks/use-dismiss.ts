import { useEffect, type RefObject } from 'react';

type Handler = () => void;
const stack: { id: number; priority: number; fn: Handler }[] = [];
let seq = 0;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || stack.length === 0) return;
  const top = [...stack].sort((a, b) => b.priority - a.priority || b.id - a.id)[0];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.fn();
}

export function ownEscape(fn: Handler, priority = 10): () => void {
  const id = ++seq;
  if (stack.length === 0 && typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown, true);
  }
  stack.push({ id, priority, fn });
  return () => {
    const idx = stack.findIndex((item) => item.id === id);
    if (idx >= 0) stack.splice(idx, 1);
    if (stack.length === 0 && typeof window !== 'undefined') {
      window.removeEventListener('keydown', onKeyDown, true);
    }
  };
}

export function useDismiss(
  open: boolean,
  refs: RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[],
  onClose: () => void,
  priority = 10,
) {
  useEffect(() => {
    if (!open) return;
    const release = ownEscape(onClose, priority);
    const list = Array.isArray(refs) ? refs : [refs];
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (list.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      release();
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [open, refs, onClose, priority]);
}
