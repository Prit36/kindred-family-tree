/**
 * The decorations every family card shares - the marigold garland, the gold filigree,
 * the engraved back, the glints and the paper grain - drawn once as images and handed to
 * the stylesheet as custom properties. Hundreds of cards then reuse one decoded picture
 * each instead of carrying dozens of SVG elements apiece.
 */

const TAU = Math.PI * 2;
const f1 = (n: number) => Math.round(n * 10) / 10;

const svgUrl = (body: string, viewBox: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${viewBox}'>${body}</svg>`)}")`;

/** A closed smooth curve through the points (Catmull-Rom as cubic Béziers). */
export function closedCurve(pts: [number, number][]): string {
  const n = pts.length;
  // Joined once at the end: a string grown piece by piece with += is kept as a tree of
  // every piece it was made from (each number, each space), many times the size of the
  // finished path, for as long as anything holds on to it - and drawn rings are kept.
  const parts = [`M${f1(pts[0][0])} ${f1(pts[0][1])}`];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    parts.push(
      `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`,
    );
  }
  parts.push('Z');
  return parts.join('');
}

// --- The marigold garland --------------------------------------------------------------

interface Palette {
  petal: string;
  petalEdge: string;
  petalIn: string;
  petalInEdge: string;
  yellow: string;
  yellowEdge: string;
  yellowIn: string;
  yellowInEdge: string;
  eye: string;
  leaf: string;
  string: string;
  tassel: string;
}

const LIGHT: Palette = {
  petal: '#f08c1a',
  petalEdge: '#c25e0a',
  petalIn: '#f4a953',
  petalInEdge: '#c25e0a',
  yellow: '#f7c52e',
  yellowEdge: '#e29c20',
  yellowIn: '#f9d66d',
  yellowInEdge: '#dc911c',
  eye: '#c25e0a',
  leaf: '#5c8a3a',
  string: '#7b5a2c',
  tassel: '#c0392b',
};

const DARK: Palette = {
  petal: '#e88a24',
  petalEdge: '#a84f0c',
  petalIn: '#eea55a',
  petalInEdge: '#a84f0c',
  yellow: '#e9b72c',
  yellowEdge: '#c98a1e',
  yellowIn: '#efcb68',
  yellowInEdge: '#c0801a',
  eye: '#a84f0c',
  leaf: '#6f9a4c',
  string: '#8a6a3a',
  tassel: '#c0392b',
};

function garland(c: Palette, pendant: boolean): string {
  const at = (t: number) => {
    const u = 1 - t;
    return {
      x: f1(u * u * -8 + 2 * u * t * 100 + t * t * 208),
      y: f1(u * u * -2 + 2 * u * t * 36 + t * t * -2),
      a: f1((Math.atan2(2 * u * 38 - 2 * t * 38, 216) * 180) / Math.PI),
    };
  };
  const flower = (x: number, y: number, r: number, yellow: boolean) =>
    `<g transform='translate(${x} ${y})'>` +
    `<circle r='${f1(r)}' fill='${yellow ? c.yellow : c.petal}' stroke='${yellow ? c.yellowEdge : c.petalEdge}' stroke-width='1.7' stroke-dasharray='1.15 .75'/>` +
    `<circle r='${f1(r * 0.58)}' fill='${yellow ? c.yellowIn : c.petalIn}' stroke='${yellow ? c.yellowInEdge : c.petalInEdge}' stroke-width='.9' stroke-dasharray='.8 .6'/>` +
    `<circle r='${f1(r * 0.2)}' fill='${c.eye}'/></g>`;
  let leaves = '';
  let flowers = '';
  const n = 15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const p = at(t);
    flowers += flower(p.x, p.y, i === 7 ? 6.6 : 5.8, i % 3 === 1);
    if (i < n - 1) {
      const l = at(t + 0.5 / (n - 1));
      leaves +=
        `<g transform='translate(${l.x} ${l.y}) rotate(${l.a})'>` +
        `<ellipse cy='-4.6' rx='2.1' ry='4.4' transform='rotate(-28)'/><ellipse cy='4.6' rx='2.1' ry='4.4' transform='rotate(28)'/></g>`;
    }
  }
  const hang = pendant
    ? `<path d='M100 18V28' fill='none' stroke='${c.string}' stroke-width='.6'/>${flower(100, 27, 4.4, true)}<path d='M98.2 30.5L100 38L101.8 30.5Z' fill='${c.tassel}'/>`
    : '';
  return svgUrl(
    `<defs><filter id='s' x='-5%' y='-20%' width='110%' height='160%'><feDropShadow dx='0' dy='1.5' stdDeviation='.9' flood-color='#3c1e00' flood-opacity='.25'/></filter></defs>` +
      `<g filter='url(#s)'><path d='M-8 -2Q100 36 208 -2' fill='none' stroke='${c.string}' stroke-width='.6'/>` +
      `<g fill='${c.leaf}'>${leaves}</g>${hang}${flowers}</g>`,
    '0 0 200 44',
  );
}

// --- Gold filigree: one corner, turned four ways, drawn in the theme's gold ---------------
// Drawn in gold rather than used as a mask over a gold layer: the same pixels, without the
// offscreen pass a mask costs the compositor on every frame a card is drawn.

/** The gold of --foil-gold in each theme (styles.css). */
const GOLD = { light: '#c9962c', dark: '#e3bb5c' };

function filigree(turn: string, gold: string): string {
  return svgUrl(
    `<g transform='${turn}' fill='none' stroke='${gold}' stroke-linecap='round'>` +
      `<path d='M2.5 46V19C2.5 9.9 9.9 2.5 19 2.5H46' stroke-width='1.6'/>` +
      `<path d='M8 38V22C8 14.3 14.3 8 22 8H38' stroke-width='.8' stroke-opacity='.8'/>` +
      `<path d='M13.5 25.5C12.8 18.6 18.6 12.8 25.5 13.5C30 14 30.4 19.7 26.6 20.6C23.6 21.3 21.3 23.6 20.6 26.6C19.7 30.4 14 30 13.5 25.5Z' fill='${gold}' fill-opacity='.3' stroke-width='1.1'/>` +
      `<circle cx='21.6' cy='21.6' r='1.9' fill='${gold}' stroke='none'/>` +
      `<path d='M46 2.5L41 .5M46 2.5L41 4.5M2.5 46L.5 41M2.5 46L4.5 41' stroke-width='.8' stroke-opacity='.8'/></g>`,
    '0 0 48 48',
  );
}

// --- The back: a guilloché rosette like a banknote's, as a mask -------------------------

function rosette(): string {
  let body = '';
  for (let j = 0; j < 30; j++) body += `<ellipse cx='90' cy='112' rx='50' ry='17' transform='rotate(${j * 6} 90 112)'/>`;
  for (let j = 0; j < 40; j++) {
    const t = (j / 40) * TAU;
    body += `<circle cx='${f1(90 + Math.cos(t) * 56)}' cy='${f1(112 + Math.sin(t) * 56)}' r='11'/>`;
  }
  const pts: [number, number][] = [];
  for (let j = 0; j < 160; j++) {
    const t = (j / 160) * TAU;
    const r = 70 + Math.sin(t * 20) * 2.6;
    pts.push([90 + Math.cos(t) * r, 112 + Math.sin(t) * r]);
  }
  body += `<path d='${closedCurve(pts)}'/><circle cx='90' cy='112' r='78'/>`;
  return svgUrl(
    `<g fill='none' stroke='#000' stroke-width='.45' stroke-opacity='.32'>${body}</g>` +
      `<circle cx='90' cy='112' r='81' fill='none' stroke='#000' stroke-width='.45' stroke-opacity='.5' stroke-dasharray='1 2'/>`,
    '0 0 180 252',
  );
}

// --- A glint: a four-point star in its own glow ------------------------------------------

function spark(fill: string, glow: string): string {
  return svgUrl(
    `<defs><radialGradient id='g'><stop offset='0' stop-color='${glow}' stop-opacity='.75'/><stop offset='1' stop-color='${glow}' stop-opacity='0'/></radialGradient></defs>` +
      `<circle r='1.6' fill='url(#g)'/>` +
      `<path d='M0-1C.12-.12.12-.12 1 0C.12.12.12.12 0 1C-.12.12-.12.12-1 0C-.12-.12-.12-.12 0-1Z' fill='${fill}'/>`,
    '-1.6 -1.6 3.2 3.2',
  );
}

// --- Glints, each at its own point in the twinkle -----------------------------------------
// Glints that start their twinkles at different moments (by animation-delay) keep the main
// thread restyling every frame; glints that all start together are left wholly to the
// compositor. So each glint starts with the rest and is given its own point in the
// twinkle by its keyframes instead: the twinkle below, begun part-way through.

/** The twinkle: opacity, scale and turn at each keyframe, eased in and out between them. */
const TWINKLE = [
  { at: 0, o: 0, s: 0.2, r: 0 },
  { at: 0.45, o: 1, s: 1, r: 20 },
  { at: 0.6, o: 0.9, s: 0.95, r: 45 },
  { at: 1, o: 0, s: 0.2, r: 0 },
];
const EASE = [0.42, 0, 0.58, 1] as const;
/** How many points in the twinkle a glint can start from. */
export const TWINKLE_PHASES = 16;

type Bez = [number, number, number, number];
const cubic = (a: number, b: number, t: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const bez = (b: Bez) => `cubic-bezier(${b.map(r4).join(',')})`;

/**
 * Splits an easing curve where its time reaches x: the eased progress there, and the two
 * curves either side, each scaled back to a whole curve of its own.
 */
function splitEase(x: number): { y: number; left: Bez; right: Bez } {
  const [x1, y1, x2, y2] = EASE;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  // De Casteljau on (0,0) (x1,y1) (x2,y2) (1,1).
  const ax = lerp(0, x1), ay = lerp(0, y1);
  const bx = lerp(x1, x2), by = lerp(y1, y2);
  const cx = lerp(x2, 1), cy = lerp(y2, 1);
  const dx = lerp(ax, bx), dy = lerp(ay, by);
  const ex = lerp(bx, cx), ey = lerp(by, cy);
  const px = lerp(dx, ex), py = lerp(dy, ey);
  return {
    y: py,
    left: [ax / px, ay / py, dx / px, dy / py],
    right: [(ex - px) / (1 - px), (ey - py) / (1 - py), (cx - px) / (1 - px), (cy - py) / (1 - py)],
  };
}

/** The twinkle begun `p` of the way through (0 ≤ p < 1). */
function twinkleFrom(name: string, p: number): string {
  const frame = (at: number, o: number, s: number, r: number, ease?: Bez) =>
    `${r4(at * 100)}%{opacity:${r4(o)};transform:scale(${r4(s)}) rotate(${r4(r)}deg)${ease ? `;animation-timing-function:${bez(ease)}` : ''}}`;
  const last = TWINKLE.length - 1;
  const seg = TWINKLE.findIndex((k, i) => i < last && p >= k.at && p < TWINKLE[i + 1].at);
  const a = TWINKLE[seg];
  const b = TWINKLE[seg + 1];
  const x = (p - a.at) / (b.at - a.at);
  const cut = x > 1e-6 ? splitEase(x) : null;
  const y = cut ? cut.y : 0;
  const o = a.o + (b.o - a.o) * y;
  const s = a.s + (b.s - a.s) * y;
  const r = a.r + (b.r - a.r) * y;
  let out = frame(0, o, s, r, cut ? cut.right : [...EASE]);
  // The keyframes after the cut, round to the one it fell after.
  for (let n = 1; n < last; n++) {
    const i = (seg + n) % last;
    const k = TWINKLE[i];
    out += frame((((k.at - p) % 1) + 1) % 1, k.o, k.s, k.r, [...EASE]);
  }
  // And the one the cut fell after, eased by the first part of its split curve.
  if (cut) out += frame(1 - (p - a.at), a.o, a.s, a.r, cut.left);
  out += frame(1, o, s, r);
  return `@keyframes ${name}{${out}}`;
}

function twinkles(): string {
  let css = '';
  for (let k = 0; k < TWINKLE_PHASES; k++) css += twinkleFrom(`fc-tw${k}`, k / TWINKLE_PHASES);
  return css;
}

// --- Paper grain ---------------------------------------------------------------------
// The card stock's texture is fractal noise from an SVG filter. Drawn as a background,
// a filter like that is worked out again whenever a card is painted, so it is run once
// here into a PNG and every card shares the picture.

const GRAIN_SVG = (r: number, g: number, b: number, a: number) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 ${a} 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
  )}`;

function grain(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 180;
        canvas.height = img.naturalHeight || 180;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve(`url("${canvas.toDataURL('image/png')}")`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

const corners = (gold: string) =>
  `--img-fili-tl:${filigree('', gold)};` +
  `--img-fili-tr:${filigree('translate(48 0) scale(-1 1)', gold)};` +
  `--img-fili-bl:${filigree('translate(0 48) scale(1 -1)', gold)};` +
  `--img-fili-br:${filigree('translate(48 48) scale(-1 -1)', gold)};`;

let installed = false;

/** Hands the shared card pictures to the stylesheet. Safe to call more than once. */
export function installCardImages() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  const css =
    `:root{` +
    `--img-garland:${garland(LIGHT, true)};` +
    `--img-garland-plain:${garland(LIGHT, false)};` +
    corners(GOLD.light) +
    `--mask-rosette:${rosette()};` +
    `--img-spark:${spark('#ffffff', '#b8a6ff')};` +
    `--img-spark-gold:${spark('#fff6d6', '#f2c94c')};` +
    `}` +
    twinkles() +
    `:root[data-theme='dark']{` +
    `--img-garland:${garland(DARK, true)};` +
    `--img-garland-plain:${garland(DARK, false)};` +
    corners(GOLD.dark) +
    `}`;
  const style = document.createElement('style');
  style.dataset.cards = '';
  style.textContent = css;
  document.head.appendChild(style);

  // The grain follows a moment later; cards are plain paper until it lands.
  void Promise.all([grain(GRAIN_SVG(0.42, 0.32, 0.18, 0.09)), grain(GRAIN_SVG(1, 0.95, 0.85, 0.05))]).then(([light, dark]) => {
    const g = document.createElement('style');
    g.dataset.cards = 'grain';
    g.textContent = (light ? `:root{--grain:${light}}` : '') + (dark ? `:root[data-theme='dark']{--grain:${dark}}` : '');
    document.head.appendChild(g);
  });
}
