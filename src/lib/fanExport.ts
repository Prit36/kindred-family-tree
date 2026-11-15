import type { Person } from '../types';
import { download, slug } from './files';
import { initials } from './tree';

/**
 * A picture of the descendants fan. The page draws it with CSS colour mixes and
 * variables, which don't survive being copied into an image, so each part's colours are
 * read off the screen and written onto a copy of the drawing; the root person's disc
 * and their parents (HTML on screen) are drawn into it too, with a title on top.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Any CSS colour (color-mix(), color(srgb…)) as plain rgba(), by painting a pixel with it. */
function colourResolver() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  ctx.canvas.width = ctx.canvas.height = 1;
  const cache = new Map<string, string>();
  return (value: string): string => {
    if (!value || value === 'none' || value.startsWith('url(')) return value;
    let out = cache.get(value);
    if (out) return out;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    out = `rgba(${r},${g},${b},${Math.round((a / 255) * 1000) / 1000})`;
    cache.set(value, out);
    return out;
  };
}

const PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
] as const;
const COLOURS = new Set(['fill', 'stroke']);

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>, text?: string) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface FanPicture {
  svg: SVGSVGElement;
  root: Person;
  rootName: string;
  /** Their husband or wife ("& Kashiben"), or '' */
  rootSpouse: string;
  rootSpouses: Person[];
  rootRelation: string;
  rootR: number;
  parents: { person: Person; name: string; relation: string }[];
  parentsY: number;
  title: string;
  subtitle: string;
  fileName: string;
}

/** The picture as a PNG data URL. */
export async function renderFanPng(pic: FanPicture): Promise<string> {
  const { svg } = pic;
  const resolve = colourResolver();
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => resolve(css.getPropertyValue(name).trim());
  const fontUi = "'Inter Variable', 'Noto Sans Gujarati Variable', 'Segoe UI', 'Nirmala UI', system-ui, sans-serif";
  const fontDisplay = "'Fraunces Variable', 'Noto Sans Gujarati Variable', Georgia, 'Nirmala UI', serif";

  // A copy of the drawing with every colour spelled out.
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  from.forEach((src, i) => {
    const dst = to[i] as SVGElement;
    const cs = getComputedStyle(src);
    if (cs.display === 'none') {
      dst.setAttribute('display', 'none');
      return;
    }
    const style: string[] = [];
    for (const p of PROPS) {
      let value = cs.getPropertyValue(p);
      if (!value) continue;
      if (COLOURS.has(p)) value = resolve(value);
      style.push(`${p}:${value}`);
    }
    // Nothing is lit or dimmed in the picture.
    if (dst.classList.contains('is-dim')) style.push('opacity:1');
    // Husbands and wives keep their serif italic.
    if (dst.classList.contains('fan-spouse')) style.push(`font-family:${fontDisplay}`);
    dst.setAttribute('style', style.join(';'));
    dst.removeAttribute('class');
  });
  copy.querySelectorAll('text').forEach((t) => t.setAttribute('font-family', fontUi));

  const vb = svg.viewBox.baseVal;
  const titleH = 120;
  const minX = vb.x;
  const minY = vb.y - titleH;
  const width = vb.width;
  const height = vb.height + titleH;
  copy.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
  copy.setAttribute('xmlns', SVG_NS);
  copy.setAttribute('xmlns:xlink', XLINK_NS);
  copy.removeAttribute('style');

  const background = el('rect', { x: minX, y: minY, width, height, fill: v('--bg') });
  copy.insertBefore(background, copy.firstChild);

  // Title
  copy.appendChild(
    el('text', { x: 0, y: minY + 58, 'text-anchor': 'middle', 'font-family': fontDisplay, 'font-size': 40, 'font-weight': 600, fill: v('--text') }, pic.title),
  );
  copy.appendChild(
    el('text', { x: 0, y: minY + 94, 'text-anchor': 'middle', 'font-family': fontUi, 'font-size': 19, 'font-weight': 500, fill: v('--text-2') }, pic.subtitle),
  );

  // The root person's disc
  const avatar = (p: Person, cx: number, cy: number, r: number) => {
    const g = el('g', {});
    const tone = p.gender === 'male' ? '--male' : p.gender === 'female' ? '--female' : '--other';
    g.appendChild(el('circle', { cx, cy, r: r + 3, fill: v(tone) }));
    g.appendChild(el('circle', { cx, cy, r: r + 1.5, fill: v('--surface') }));
    g.appendChild(el('circle', { cx, cy, r, fill: v(`${tone}-soft`) }));
    if (p.photo) {
      const id = `clip-${p.id}`.replace(/[^\w-]/g, '');
      const clip = el('clipPath', { id });
      clip.appendChild(el('circle', { cx, cy, r }));
      g.appendChild(clip);
      const img = el('image', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, 'clip-path': `url(#${id})`, preserveAspectRatio: 'xMidYMid slice' });
      img.setAttributeNS(XLINK_NS, 'href', p.photo);
      img.setAttribute('href', p.photo);
      g.appendChild(img);
    } else {
      g.appendChild(
        el('text', { x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': fontUi, 'font-size': r * 0.72, 'font-weight': 650, fill: v(tone) }, initials(p)),
      );
    }
    return g;
  };

  const R = pic.rootR;
  copy.appendChild(el('circle', { cx: 0, cy: 0, r: R, fill: v('--surface'), stroke: resolve(`color-mix(in srgb, ${css.getPropertyValue('--bark')} 80%, ${css.getPropertyValue('--surface')})`), 'stroke-width': 3 }));
  // With a husband or wife the couple's photos overlap and everything sits a little higher.
  const spouses = pic.rootSpouses.slice(0, 2);
  const lift = pic.rootSpouse ? 8 : 0;
  const ay = -18 - lift;
  const groupW = 52 + spouses.length * (40 - 12);
  copy.appendChild(avatar(pic.root, -groupW / 2 + 26, ay, 26));
  spouses.forEach((s, i) => {
    const r = 20;
    const cx = -groupW / 2 + 60 + i * 28;
    copy.appendChild(el('circle', { cx, cy: ay + 26 - r, r: r + 6, fill: v('--surface') }));
    copy.appendChild(avatar(s, cx, ay + 26 - r, r));
  });
  copy.appendChild(
    el('text', { x: 0, y: 26 - lift, 'text-anchor': 'middle', 'font-family': fontDisplay, 'font-size': 17, 'font-weight': 600, fill: v('--text') }, pic.rootName),
  );
  if (pic.rootSpouse) {
    copy.appendChild(
      el('text', { x: 0, y: 42 - lift, 'text-anchor': 'middle', 'font-family': fontDisplay, 'font-size': 14, 'font-style': 'italic', 'font-weight': 500, fill: v('--text-2') }, pic.rootSpouse),
    );
  }
  if (pic.rootRelation) {
    copy.appendChild(
      el('text', { x: 0, y: (pic.rootSpouse ? 58 : 45) - lift, 'text-anchor': 'middle', 'font-family': fontUi, 'font-size': 12, 'font-weight': 600, fill: v('--accent-strong') }, pic.rootRelation),
    );
  }

  // Their parents, under the trunk
  const chipW = 168;
  const gap = 12;
  const total = pic.parents.length * chipW + (pic.parents.length - 1) * gap;
  pic.parents.forEach(({ person, name, relation }, i) => {
    const x = -total / 2 + i * (chipW + gap);
    const y = pic.parentsY;
    copy.appendChild(el('rect', { x, y, width: chipW, height: 42, rx: 21, fill: v('--surface'), stroke: v('--border-strong') }));
    copy.appendChild(avatar(person, x + 20, y + 21, 12));
    copy.appendChild(el('text', { x: x + 40, y: y + 16, 'font-family': fontUi, 'font-size': 11.5, 'font-weight': 500, fill: v('--text-2') }, relation));
    copy.appendChild(el('text', { x: x + 40, y: y + 32, 'font-family': fontUi, 'font-size': 13.5, 'font-weight': 600, fill: v('--text') }, name));
  });

  // Draw it at up to twice the size, within what a browser canvas can hold.
  const ratio = Math.min(2, 8000 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
  copy.setAttribute('width', String(Math.round(width * ratio)));
  copy.setAttribute('height', String(Math.round(height * ratio)));
  const markup = new XMLSerializer().serializeToString(copy);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadFanPng(pic: FanPicture) {
  download(await renderFanPng(pic), `${slug(pic.fileName)}.png`);
}
