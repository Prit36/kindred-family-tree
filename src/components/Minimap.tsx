import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { ZoomTransform } from 'd3-zoom';
import { CARD_H, CARD_W, type TreeLayout } from '../lib/layout';

/** The most room the overview takes; the tree's shape decides how much of it is used. */
const MAX_W = 216;
const MAX_H = 136;
const PAD = 8;

export interface MinimapHandle {
  /** The view moved: redraw the "you are here" frame. */
  update: (t: ZoomTransform) => void;
}

interface Props {
  layout: TreeLayout;
  /** Colour index (side of the family) for each person, or undefined for the plain colour. */
  toneOf: (id: string) => number | undefined;
  selectedId: string | null;
  homeId: string | null;
  /** People on the highlighted chain or line, drawn in the accent colour. */
  lit: ReadonlySet<string> | null;
  /** Redraw when the colours change. */
  theme: string;
  /** Viewport size, so the frame can be drawn. */
  viewport: () => { width: number; height: number };
  /** Centre the view on this point of the tree. */
  onNavigate: (x: number, y: number, animate: boolean) => void;
}

/**
 * A small overview of the whole tree in the corner, with a frame showing the part on
 * screen. Clicking or dragging in it moves the view there. Drawn on a canvas, so it costs
 * the same whether the tree has fifty people or five thousand.
 */
export const Minimap = forwardRef<MinimapHandle, Props>(function Minimap(
  { layout, toneOf, selectedId, homeId, lit, theme, viewport, onNavigate },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const transform = useRef<ZoomTransform | null>(null);
  const frame = useRef(0);

  const { bounds } = layout;
  const scale = Math.min((MAX_W - PAD * 2) / Math.max(1, bounds.width), (MAX_H - PAD * 2) / Math.max(1, bounds.height));
  const width = Math.round(Math.max(64, bounds.width * scale + PAD * 2));
  const height = Math.round(Math.max(40, bounds.height * scale + PAD * 2));
  const geometry = useRef({ scale, width, height, bounds });
  geometry.current = { scale, width, height, bounds };

  /** Puts the cached tree drawing on screen with the frame over it. */
  const paint = useCallback(() => {
    frame.current = 0;
    const canvas = canvasRef.current;
    const base = baseRef.current;
    const t = transform.current;
    if (!canvas || !base) return;
    const ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    if (!t) return;
    const { scale: s, bounds: b, width: w, height: h } = geometry.current;
    const vp = viewport();
    const x0 = ((-t.x / t.k - b.minX) * s + PAD) * dpr;
    const y0 = ((-t.y / t.k - b.minY) * s + PAD) * dpr;
    const fw = (vp.width / t.k) * s * dpr;
    const fh = (vp.height / t.k) * s * dpr;
    // Clipped to the overview so a frame bigger than the tree still reads as a frame.
    const cx0 = Math.max(1, x0);
    const cy0 = Math.max(1, y0);
    const cx1 = Math.min(w * dpr - 1, x0 + fw);
    const cy1 = Math.min(h * dpr - 1, y0 + fh);
    if (cx1 <= cx0 || cy1 <= cy0) return;
    const css = getComputedStyle(canvas);
    ctx.fillStyle = css.getPropertyValue('--frame-fill').trim() || 'rgba(47,111,94,0.12)';
    ctx.strokeStyle = css.getPropertyValue('--frame-stroke').trim() || '#2f6f5e';
    ctx.lineWidth = 1.5 * dpr;
    ctx.fillRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
    ctx.strokeRect(cx0, cy0, cx1 - cx0, cy1 - cy0);
  }, [viewport]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useImperativeHandle(ref, () => ({
    update: (t) => {
      transform.current = t;
      schedule();
    },
  }), [schedule]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // The tree itself only needs drawing again when it, the colours or the selection change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const base = (baseRef.current ??= document.createElement('canvas'));
    base.width = canvas.width;
    base.height = canvas.height;
    const ctx = base.getContext('2d')!;
    ctx.clearRect(0, 0, base.width, base.height);
    const css = getComputedStyle(canvas);
    const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const plain = color('--node', '#c2b69f');
    const accent = color('--accent', '#2f6f5e');
    const tones = Array.from({ length: 8 }, (_, i) => color(`--side-${i}`, plain));
    const w = Math.max(1, CARD_W * scale * dpr);
    const h = Math.max(1, CARD_H * scale * dpr);
    const at = (id: string) => {
      const n = layout.nodes[id];
      return [((n.x - bounds.minX) * scale + PAD) * dpr, ((n.y - bounds.minY) * scale + PAD) * dpr] as const;
    };
    // Grouped by colour so the canvas changes fill style as rarely as possible.
    const byColour = new Map<string, string[]>();
    for (const id in layout.nodes) {
      if (id === selectedId || id === homeId || lit?.has(id)) continue;
      const tone = toneOf(id);
      const c = tone === undefined || tone < 0 ? plain : tones[tone];
      let list = byColour.get(c);
      if (!list) byColour.set(c, (list = []));
      list.push(id);
    }
    for (const [c, ids] of byColour) {
      ctx.fillStyle = c;
      for (const id of ids) {
        const [x, y] = at(id);
        ctx.fillRect(x, y, w, h);
      }
    }
    ctx.fillStyle = accent;
    for (const id of lit ?? []) {
      if (!layout.nodes[id] || id === selectedId) continue;
      const [x, y] = at(id);
      ctx.fillRect(x, y, w, h);
    }
    // You and the selected person stand out even when the tree is tiny.
    for (const id of [homeId, selectedId]) {
      if (!id || !layout.nodes[id]) continue;
      const [x, y] = at(id);
      const r = Math.max(2.5 * dpr, h / 2 + dpr);
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      if (id === selectedId) {
        ctx.lineWidth = 1.5 * dpr;
        ctx.strokeStyle = color('--surface', '#fff');
        ctx.stroke();
      }
    }
    paint();
  }, [layout, bounds, scale, width, height, toneOf, selectedId, homeId, lit, theme, paint]);

  // Click or drag to move the view.
  const dragging = useRef(false);
  const navigate = (e: React.PointerEvent<HTMLCanvasElement>, animate: boolean) => {
    const box = e.currentTarget.getBoundingClientRect();
    const { scale: s, bounds: b } = geometry.current;
    onNavigate((e.clientX - box.left - PAD) / s + b.minX, (e.clientY - box.top - PAD) / s + b.minY, animate);
  };

  return (
    <div className="minimap" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        style={{ width, height }}
        role="img"
        aria-label="Overview of the whole tree"
        onPointerDown={(e) => {
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          navigate(e, true);
        }}
        onPointerMove={(e) => {
          if (dragging.current) navigate(e, false);
        }}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      />
    </div>
  );
});
