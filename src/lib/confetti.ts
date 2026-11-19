/**
 * A burst of paper from a point on the screen, drawn on a canvas laid over the page for
 * as long as the pieces are falling. Colours come from the theme, so it suits light and dark.
 */

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  shape: 0 | 1 | 2;
  life: number;
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function palette(): string[] {
  const css = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return [
    pick('--accent', '#2f6f5e'),
    pick('--female', '#bf5878'),
    pick('--male', '#3a7ca5'),
    pick('--foil-gold', '#d6a740'),
    pick('--other', '#8670b5'),
    pick('--foil-gold', '#d6a740'),
  ];
}

let canvas: HTMLCanvasElement | null = null;
let pieces: Piece[] = [];
let frame = 0;

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'confetti-layer';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function tick() {
  const ctx = ensureCanvas();
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  pieces = pieces.filter((p) => p.life > 0 && p.y < window.innerHeight + 40);
  for (const p of pieces) {
    p.vy += 0.32;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;
    p.r += p.vr;
    p.life -= 1;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.r);
    // Paper turning over: its width swings as it spins.
    ctx.scale(Math.cos(p.r * 1.7), 1);
    ctx.fillStyle = p.color;
    if (p.shape === 0) ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    else if (p.shape === 1) {
      ctx.beginPath();
      ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -p.h / 2);
      ctx.lineTo(p.w / 2, p.h / 2);
      ctx.lineTo(-p.w / 2, p.h / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  if (pieces.length) frame = requestAnimationFrame(tick);
  else {
    frame = 0;
    canvas.remove();
    canvas = null;
  }
}

/** Throws `count` pieces up and out from (x, y) in screen pixels. */
export function confetti(x: number, y: number, { count = 90, spread = 1, power = 1 } = {}) {
  if (still()) return;
  const colors = palette();
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9 * spread;
    const speed = (6 + Math.random() * 9) * power;
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.35,
      w: 6 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      color: colors[i % colors.length],
      shape: (i % 3) as 0 | 1 | 2,
      life: 110 + Math.random() * 60,
    });
  }
  if (!frame) frame = requestAnimationFrame(tick);
}

/** Confetti from the middle of an element. */
export function confettiFrom(el: Element | null, opts?: Parameters<typeof confetti>[2]) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  confetti(r.left + r.width / 2, r.top + r.height / 3, opts);
}
