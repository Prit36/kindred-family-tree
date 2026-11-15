import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';

/** View controls share the app header; narrow screens expose them in a popover. */
export function HeaderControls({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setTarget(document.getElementById('view-controls')), []);
  useLayoutEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        ref.current?.querySelector<HTMLButtonElement>('.view-options-trigger')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    const node = ref.current;
    node?.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      node?.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  return target ? createPortal(
    <div ref={ref} className={`view-context${open ? ' is-open' : ''}`}>
      <button type="button" className="icon-btn view-options-trigger" aria-label="View options" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SlidersHorizontal size={17} />
      </button>
      <div className="view-context-content">{children}</div>
    </div>, target,
  ) : null;
}
