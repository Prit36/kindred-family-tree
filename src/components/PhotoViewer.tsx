import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Crop, Download, Maximize, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { Person } from '../types';
import { download, slug } from '../lib/files';
import { getOriginal } from '../lib/photoStore';
import { displayName } from '../lib/tree';

interface Props {
  person: Pick<Person, 'firstName' | 'lastName' | 'photo' | 'photoOriginal'>;
  onClose: () => void;
  /** Re-crop from the full-size photo. Only offered when there is one. */
  onAdjust?: () => void;
  /** Pick a different photo. */
  onChange?: () => void;
}

interface Size {
  width: number;
  height: number;
}

/** Where the photo is: `scale` is screen px per image px, (x, y) its centre's offset from the stage's centre. */
interface View {
  scale: number;
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

const PAD = 24; // space kept around the photo when it's fitted to the screen
const STEP = 1.4;
const PAN_STEP = 60;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Image =
  | { state: 'loading' }
  | { state: 'ready'; url: string; blob: Blob | null; full: boolean; width: number; height: number };

/**
 * Loads the best version of someone's photo there is: the stored original, or failing
 * that the small cropped copy kept in the tree.
 */
function useBestImage(photo: string, originalId: string): Image {
  const [image, setImage] = useState<Image>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    const measure = (url: string) =>
      new Promise<Size>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('unreadable'));
        img.src = url;
      });

    void (async () => {
      const blob = originalId ? await getOriginal(originalId) : undefined;
      if (cancelled) return;
      if (blob) {
        objectUrl = URL.createObjectURL(blob);
        try {
          const size = await measure(objectUrl);
          if (!cancelled) setImage({ state: 'ready', url: objectUrl, blob, full: true, ...size });
          return;
        } catch {
          /* fall back to the crop */
        }
      }
      try {
        const size = await measure(photo);
        if (!cancelled) setImage({ state: 'ready', url: photo, blob: null, full: false, ...size });
      } catch {
        if (!cancelled) setImage({ state: 'ready', url: photo, blob: null, full: false, width: 192, height: 192 });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, originalId]);

  return image;
}

/**
 * Someone's photo, full screen. Scroll, pinch or use the buttons to zoom; drag to look
 * around; double-click to switch between fitting the screen and actual size.
 * Rendered into <body> so it can open over another dialog.
 */
export function PhotoViewer({ person, onClose, onAdjust, onChange }: Props) {
  const name = displayName(person as Person);
  const image = useBestImage(person.photo, person.photoOriginal);
  const ready = image.state === 'ready' ? image : null;

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [view, setView] = useState<View | null>(null);
  // Smooth for buttons and double-clicks; instant while dragging or scrolling, so it keeps up.
  const [animate, setAnimate] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const moved = useRef(0);

  // Read focus before anything inside takes it, to hand it back on close.
  const [previouslyFocused] = useState(() => document.activeElement as HTMLElement | null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  /** Scale at which the whole photo fits. Never enlarged past actual size, except the small fallback. */
  const fitScale = (img: Size, st: Size) => {
    if (!st.width || !st.height) return 1;
    const fit = Math.min((st.width - PAD * 2) / img.width, (st.height - PAD * 2) / img.height);
    return Math.max(0.01, Math.min(fit, ready?.full === false ? 2 : 1));
  };
  const limits = (img: Size, st: Size) => {
    const fit = fitScale(img, st);
    return { min: Math.min(fit, 1), max: Math.max(fit * 2, ready?.full === false ? 4 : 8) };
  };

  /** Keeps the scale in range and the photo covering as much of the stage as it can. */
  const constrain = (v: View, img: Size, st: Size): View => {
    const { min, max } = limits(img, st);
    const scale = clamp(v.scale, min, max);
    const slackX = Math.max(0, (img.width * scale - st.width) / 2);
    const slackY = Math.max(0, (img.height * scale - st.height) / 2);
    return { scale, x: clamp(v.x, -slackX, slackX), y: clamp(v.y, -slackY, slackY) };
  };

  // Everything event handlers need, read through a ref so listeners are set up once.
  const live = useRef({ ready, stage, view });
  live.current = { ready, stage, view };

  useLayoutEffect(() => {
    const node = stageRef.current!;
    const measure = () => setStage({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Fit once the photo has loaded; keep it in bounds if the window is resized.
  useLayoutEffect(() => {
    if (!ready || !stage.width) return;
    setView((v) => (v ? constrain(v, ready, stage) : { scale: fitScale(ready, stage), x: 0, y: 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stage]);

  /** Zooms to `scale` keeping the stage point `at` (offset from its centre) still. */
  const zoomTo = (scale: number, at: Point = { x: 0, y: 0 }, smooth = true) => {
    const { ready: img, stage: st } = live.current;
    if (!img) return;
    setAnimate(smooth);
    setView((v) => {
      if (!v) return v;
      const next = clamp(scale, limits(img, st).min, limits(img, st).max);
      const k = next / v.scale;
      return constrain({ scale: next, x: at.x - (at.x - v.x) * k, y: at.y - (at.y - v.y) * k }, img, st);
    });
  };
  const zoomBy = (factor: number, at?: Point, smooth = true) => {
    const v = live.current.view;
    if (v) zoomTo(v.scale * factor, at, smooth);
  };
  const fit = () => {
    const { ready: img, stage: st } = live.current;
    if (!img) return;
    setAnimate(true);
    setView({ scale: fitScale(img, st), x: 0, y: 0 });
  };
  const panBy = (dx: number, dy: number, smooth: boolean) => {
    const { ready: img, stage: st } = live.current;
    if (!img) return;
    setAnimate(smooth);
    setView((v) => (v ? constrain({ ...v, x: v.x + dx, y: v.y + dy }, img, st) : v));
  };

  /** Fit ↔ actual size (or a closer look, when actual size is about what fits anyway). */
  const toggleZoom = (at?: Point) => {
    const { ready: img, stage: st, view: v } = live.current;
    if (!img || !v) return;
    const fitted = fitScale(img, st);
    if (v.scale > fitted * 1.05) return fit();
    zoomTo(fitted < 0.8 ? 1 : fitted * 2.5, at);
  };

  const fromCentre = (e: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
  };

  // Wheel zoom needs a non-passive listener so the page behind doesn't scroll.
  useEffect(() => {
    const node = stageRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      zoomBy(Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.002)), fromCentre(e), false);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard, focus trap, and handing focus back on close.
  useEffect(() => {
    const node = rootRef.current!;
    node.focus();
    const onKey = (e: KeyboardEvent) => {
      // Ctrl/⌘ shortcuts (undo, browser zoom) are left alone.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const onButton = (e.target as HTMLElement).closest('button');
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [PAN_STEP, 0],
        ArrowRight: [-PAN_STEP, 0],
        ArrowUp: [0, PAN_STEP],
        ArrowDown: [0, -PAN_STEP],
      };
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === '+' || e.key === '=') zoomBy(STEP);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / STEP);
      else if (e.key === '0') fit();
      else if (e.key === '1') zoomTo(1);
      else if (arrows[e.key]) {
        const [dx, dy] = arrows[e.key];
        panBy(e.shiftKey ? dx * 4 : dx, e.shiftKey ? dy * 4 : dy, true);
      } else if (e.key === 'Tab') {
        const focusable = node.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === node)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      } else return;
      if (onButton && e.key.startsWith('Arrow')) return;
      e.preventDefault();
      e.stopPropagation();
    };
    node.addEventListener('keydown', onKey);
    return () => {
      node.removeEventListener('keydown', onKey);
      // Only when the viewer is really gone, not when StrictMode re-runs this effect.
      if (!node.isConnected) previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not fatal: the drag still works while the pointer stays over the stage.
    }
    pointers.current.set(e.pointerId, fromCentre(e));
    if (pointers.current.size === 1) moved.current = 0;
    setDragging(true);
    setAnimate(false);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const before = [...pointers.current.values()];
    const next = fromCentre(e);
    pointers.current.set(e.pointerId, next);
    const after = [...pointers.current.values()];
    moved.current += Math.hypot(next.x - prev.x, next.y - prev.y);

    if (after.length === 1) return panBy(next.x - prev.x, next.y - prev.y, false);
    // Two fingers: pinch around their midpoint, and follow the midpoint as it moves.
    const [a0, b0] = before;
    const [a1, b1] = after;
    const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
    const d1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
    const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
    if (d0 > 0) zoomBy(d1 / d0, mid0, false);
    panBy(mid1.x - mid0.x, mid1.y - mid0.y, false);
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  // A click (not a drag) on the dark area around the photo closes the viewer.
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (moved.current > 4 || !ready || !view) return;
    const p = fromCentre(e);
    const halfW = (ready.width * view.scale) / 2;
    const halfH = (ready.height * view.scale) / 2;
    const onPhoto = Math.abs(p.x - view.x) <= halfW && Math.abs(p.y - view.y) <= halfH;
    if (!onPhoto) onClose();
  };

  const save = () => {
    if (!ready) return;
    const type = ready.blob?.type ?? 'image/jpeg';
    const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    download(ready.url, `${slug(name)}-photo.${ext}`);
  };

  const lim = ready ? limits(ready, stage) : { min: 1, max: 1 };
  const percent = view ? Math.round(view.scale * 100) : 100;
  const fitted = ready && view ? Math.abs(view.scale - fitScale(ready, stage)) < 0.001 && !view.x && !view.y : true;
  const canPan = Boolean(ready && view && (ready.width * view.scale > stage.width + 1 || ready.height * view.scale > stage.height + 1));

  return createPortal(
    <div
      ref={rootRef}
      className="viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Photo of ${name}`}
      tabIndex={-1}
    >
      <header className="viewer-bar">
        <div className="viewer-title">
          <h2>{name}</h2>
          {ready?.full && (
            <p>
              {ready.width} × {ready.height}
            </p>
          )}
        </div>
        <div className="viewer-tools">
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom out"
            data-tip="Zoom out (−)"
            disabled={!view || view.scale <= lim.min + 1e-6}
            onClick={() => zoomBy(1 / STEP)}
          >
            <ZoomOut size={18} />
          </button>
          <button
            type="button"
            className="viewer-zoom"
            aria-label={fitted ? 'Show at actual size' : 'Fit to screen'}
            data-tip={fitted ? 'Actual size (1)' : 'Fit to screen (0)'}
            disabled={!view}
            onClick={() => (fitted ? zoomTo(1) : fit())}
          >
            {percent}%
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom in"
            data-tip="Zoom in (+)"
            disabled={!view || view.scale >= lim.max - 1e-6}
            onClick={() => zoomBy(STEP)}
          >
            <ZoomIn size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Fit to screen"
            data-tip="Fit to screen (0)"
            disabled={fitted}
            onClick={fit}
          >
            <Maximize size={16} />
          </button>
          <span className="viewer-sep" aria-hidden="true" />
          {onAdjust && ready?.full && (
            <button type="button" className="icon-btn" aria-label="Adjust crop" data-tip="Adjust crop" onClick={onAdjust}>
              <Crop size={17} />
            </button>
          )}
          {onChange && (
            <button type="button" className="icon-btn" aria-label="Change photo" data-tip="Change photo" onClick={onChange}>
              <Camera size={17} />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label="Download photo"
            data-tip="Download"
            disabled={!ready}
            onClick={save}
          >
            <Download size={17} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close" data-tip="Close (Esc)" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={`viewer-stage${dragging ? ' is-dragging' : ''}${canPan ? ' can-pan' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onLostPointerCapture={onPointerEnd}
        onClick={onStageClick}
        onDoubleClick={(e) => toggleZoom(fromCentre(e))}
      >
        {ready && view ? (
          <img
            className={`viewer-image${animate ? ' is-animating' : ''}${ready.full ? '' : ' is-small'}`}
            src={ready.url}
            alt={`Photo of ${name}`}
            draggable={false}
            style={{
              width: ready.width,
              height: ready.height,
              transform: `translate(${stage.width / 2 + view.x - (ready.width * view.scale) / 2}px, ${
                stage.height / 2 + view.y - (ready.height * view.scale) / 2
              }px) scale(${view.scale})`,
            }}
            onTransitionEnd={() => setAnimate(false)}
          />
        ) : (
          <span className="viewer-loading" role="status">
            Loading photo…
          </span>
        )}
      </div>

      {ready && !ready.full && (
        <p className="viewer-note" role="note">
          Only the cropped copy of this photo was kept.
          {onChange ? (
            <>
              {' '}
              <button type="button" className="viewer-note-btn" onClick={onChange}>
                Choose it again
              </button>{' '}
              to keep the full picture.
            </>
          ) : (
            ' Choose it again to keep the full picture.'
          )}
        </p>
      )}
    </div>,
    document.body,
  );
}
