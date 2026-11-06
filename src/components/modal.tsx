import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { ownEscape } from '../hooks/use-dismiss';
import { Tooltip } from './tooltip';

export interface ModalProps {
  open?: boolean;
  title: string;
  subtitle?: string;
  headerBrand?: ReactNode;
  close?: () => void;
  onClose?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  headerMeta?: ReactNode;
  headerActions?: ReactNode;
  hideClose?: boolean;
  className?: string;
  children: ReactNode;
}

export function Modal({
  open = true,
  title,
  subtitle,
  headerBrand,
  close,
  onClose,
  size = 'md',
  headerMeta,
  headerActions,
  hideClose = false,
  className = '',
  children,
}: ModalProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const handleClose = close ?? onClose;
  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const rootEl = document.getElementById('root');
    if (rootEl) rootEl.inert = true;
    const release = closeRef.current ? ownEscape(() => closeRef.current?.(), 20) : () => { };

    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (!dialog.contains(document.activeElement)) {
        const focusable = dialog.querySelector<HTMLElement>(
          'input:not([disabled]):not([type="file"]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        );
        (focusable ?? dialog).focus();
      }
    });

    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      if (document.activeElement?.closest('.dropdown-menu')) return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const controls = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled):not([type="file"]), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
        ),
      ].filter((node) => node.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (!first || !last) return;
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', trap);
    return () => {
      cancelAnimationFrame(frame);
      release();
      window.removeEventListener('keydown', trap);
      if (rootEl) {
        requestAnimationFrame(() => {
          if (!document.querySelector('.modal-overlay')) {
            rootEl.inert = false;
          }
          previous?.focus?.();
        });
      } else {
        previous?.focus?.();
      }
    };
  }, [open]);

  if (!open) return null;

  const meta = headerMeta ?? headerActions;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !hideClose) handleClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal-container modal-size-${size} stealth-glass ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
      >
        <header className={`modal-header-row ${subtitle ? 'has-subtitle' : ''}`.trim()}>
          {headerBrand || subtitle ? (
            <div className="modal-title-stack">
              <div className="modal-title-line">
                {headerBrand}
                <h2 id={id} className={headerBrand ? 'sr-only' : 'modal-title-text'}>
                  {title}
                </h2>
              </div>
              {subtitle ? <p className="modal-subtitle-text">{subtitle}</p> : null}
            </div>
          ) : (
            <h2 id={id} className="modal-title-text">
              {title}
            </h2>
          )}
          {meta ? <div className="modal-header-meta">{meta}</div> : null}
          {handleClose && !hideClose ? (
            <Tooltip label="Close" description="Esc">
              <button
                type="button"
                className="icon-btn btn-xs modal-close-btn"
                aria-label="Close"
                onClick={handleClose}
              >
                <X size={15} />
              </button>
            </Tooltip>
          ) : null}
        </header>
        <div className="modal-body-wrap">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
