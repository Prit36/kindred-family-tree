import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { ImageUp, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { clampView, cropSide, initialView, maxZoom, panBy, zoomAt, type CropView } from '../lib/crop';
import { cropPhoto, loadPhoto, releasePhoto, type PhotoSource } from '../lib/files';
import { Modal } from './Modal';

interface Props {
  source: PhotoSource;
  /** Where to start, e.g. the crop chosen last time. Defaults to `initialView`. */
  view?: CropView;
  title?: string;
  onCancel: () => void;
  /** The cropped photo, plus the original and crop it came from so it can be adjusted again. */
  onSave: (photo: string, source: PhotoSource, view: CropView) => void;
}

/** Gap between the crop circle and the edge of the stage, so the rest of the photo shows around it. */
const MARGIN = 28;
const PREVIEW = 52; // the size of a photo on a card in the tree
const KEY_STEP = 0.025;
const ZOOM_STEP = 1.2;
const SLIDER_STEPS = 1000;

interface Point {
  x: number;
  y: number;
}

/**
 * Lets the user drag and zoom a photo inside a circle before it's saved, so faces
 * aren't cut off and the right person in a group shot can be picked out.
 * Rendered into <body> so it can sit on top of another dialog.
 */
export function PhotoCropper({ source: initialSource, view: initial, title = 'Position the photo', onCancel, onSave }: Props) {
  const [source, setSource] = useState(initialSource);
  const [view, setView] = useState(() => (initial ? clampView(initialSource, initial) : initialView(initialSource)));
  const [stage, setStage] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pointers = useRef(new Map<number, Point>());
  // Photos picked inside the cropper; the one handed back on save belongs to the caller.
  const ownSources = useRef(new Set<PhotoSource>());

  const diameter = Math.max(0, Math.min(stage.width, stage.height) - MARGIN * 2);
  const max = maxZoom(source);

  // Event handlers read the latest values through a ref instead of re-subscribing.
  const live = useRef({ source, diameter, stage });
  live.current = { source, diameter, stage };

  useLayoutEffect(() => {
    const node = stageRef.current!;
    const measure = () => setStage({ width: node.clientWidth, height: node.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      for (const s of ownSources.current) releasePhoto(s);
    },
    [],
  );

  /** A point on the stage as an offset from the crop's centre, in crop-diameters. */
  const fromCentre = (p: Point) => {
    const { stage: st, diameter: d } = live.current;
    return { fx: (p.x - st.width / 2) / d, fy: (p.y - st.height / 2) / d };
  };

  const stagePoint = (e: { clientX: number; clientY: number }): Point => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // Wheel zoom needs a non-passive listener so the page (and the dialog) don't scroll.
  useEffect(() => {
    const node = stageRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
      const { fx, fy } = fromCentre(stagePoint(e));
      setView((v) => zoomAt(live.current.source, v, v.zoom * factor, fx, fy));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not fatal: the drag still works while the pointer stays over the stage.
    }
    pointers.current.set(e.pointerId, stagePoint(e));
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev || !live.current.diameter) return;
    const before = [...pointers.current.values()];
    const next = stagePoint(e);
    pointers.current.set(e.pointerId, next);
    const after = [...pointers.current.values()];
    const d = live.current.diameter;

    if (after.length === 1) {
      setView((v) => panBy(live.current.source, v, (next.x - prev.x) / d, (next.y - prev.y) / d));
      return;
    }
    // Two fingers: pinch to zoom around their midpoint, and follow the midpoint as it moves.
    const [a0, b0] = before;
    const [a1, b1] = after;
    const dist0 = Math.hypot(a0.x - b0.x, a0.y - b0.y);
    const dist1 = Math.hypot(a1.x - b1.x, a1.y - b1.y);
    const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
    const mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
    const { fx, fy } = fromCentre(mid0);
    setView((v) => {
      const src = live.current.source;
      const zoomed = dist0 > 0 ? zoomAt(src, v, (v.zoom * dist1) / dist0, fx, fy) : v;
      return panBy(src, zoomed, (mid1.x - mid0.x) / d, (mid1.y - mid0.y) / d);
    });
  };

  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  const zoomBy = (factor: number) => setView((v) => zoomAt(source, v, v.zoom * factor));
  const reset = () => setView(initialView(source));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (moves[e.key]) {
      const [fx, fy] = moves[e.key];
      setView((v) => panBy(source, v, fx, fy));
    } else if (e.key === '+' || e.key === '=') zoomBy(ZOOM_STEP);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / ZOOM_STEP);
    else if (e.key === '0') reset();
    else return;
    e.preventDefault();
  };

  const takeFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const next = await loadPhoto(file);
      ownSources.current.add(next);
      setSource(next);
      setView(initialView(next));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : "That image couldn't be read");
    }
  };

  const save = () => {
    const finalView = clampView(source, view);
    ownSources.current.delete(source); // the caller keeps this one
    onSave(cropPhoto(source, finalView), source, finalView);
  };

  // Where the photo is drawn for a crop circle of `d` px centred in a `w`×`h` box.
  const placement = (d: number, w: number, h: number) => {
    const scale = d / cropSide(source, view.zoom);
    return {
      width: source.width * scale,
      height: source.height * scale,
      transform: `translate(${w / 2 - view.cx * scale}px, ${h / 2 - view.cy * scale}px)`,
    };
  };

  const sliderValue = Math.round((Math.log(view.zoom) / Math.log(max)) * SLIDER_STEPS);
  const percent = Math.round(view.zoom * 100);

  return createPortal(
    <Modal title={title} onClose={onCancel} width={460}>
      <div
        className="form cropper"
        // A new photo can be dropped straight onto the cropper.
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void takeFile(e.dataTransfer.files[0]);
        }}
      >
        <div
          ref={stageRef}
          className={`crop-stage${dragging ? ' is-dragging' : ''}`}
          tabIndex={0}
          role="application"
          aria-roledescription="photo cropper"
          aria-label="Photo position. Use the arrow keys to move the photo, plus and minus to zoom, 0 to reset."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onDoubleClick={(e) => {
            const { fx, fy } = fromCentre(stagePoint(e));
            setView((v) => zoomAt(source, v, v.zoom * 1.6, fx, fy));
          }}
          onKeyDown={onKeyDown}
        >
          {diameter > 0 && (
            <>
              <img
                className="crop-image"
                src={source.url}
                alt=""
                draggable={false}
                style={placement(diameter, stage.width, stage.height)}
              />
              <div className="crop-mask" style={{ width: diameter, height: diameter }} aria-hidden="true">
                <span className="crop-grid" />
              </div>
            </>
          )}
        </div>

        <div className="crop-controls">
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom out"
            data-tip="Zoom out (−)"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            aria-disabled={view.zoom <= 1}
          >
            <ZoomOut size={17} />
          </button>
          <input
            type="range"
            className="crop-zoom"
            min={0}
            max={SLIDER_STEPS}
            value={sliderValue}
            aria-label="Zoom"
            aria-valuetext={`${percent}%`}
            onChange={(e) => {
              const zoom = Math.pow(max, Number(e.target.value) / SLIDER_STEPS);
              setView((v) => zoomAt(source, v, zoom));
            }}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Zoom in"
            data-tip="Zoom in (+)"
            onClick={() => zoomBy(ZOOM_STEP)}
            aria-disabled={view.zoom >= max - 1e-6}
          >
            <ZoomIn size={17} />
          </button>
          <button type="button" className="icon-btn" aria-label="Reset" data-tip="Reset (0)" onClick={reset}>
            <RotateCcw size={16} />
          </button>
          <span className="crop-preview" title="How it looks on a card in the tree" aria-hidden="true">
            <span className="avatar crop-preview-avatar" style={{ width: PREVIEW, height: PREVIEW }}>
              <img src={source.url} alt="" draggable={false} style={placement(PREVIEW, PREVIEW, PREVIEW)} />
            </span>
          </span>
        </div>

        {error && (
          <span className="error-text crop-error" role="alert">
            {error}
          </span>
        )}

        <footer className="modal-foot crop-foot">
          <button type="button" className="link-btn crop-another" onClick={() => fileRef.current?.click()}>
            <ImageUp size={15} /> Choose another photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void takeFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} autoFocus>
            Use photo
          </button>
        </footer>
      </div>
    </Modal>,
    document.body,
  );
}
