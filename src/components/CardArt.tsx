import { memo, useId, useMemo } from 'react';
import type { Person } from '../types';
import type { Rarity } from '../lib/cards';

/**
 * The pictures on a family card, drawn from who the person is rather than picked from a
 * set: a cross-section of a tree trunk with a ring for every ten years of their life (a
 * child's card is a sapling, a great-grandparent's fills the frame), a dot on the ring
 * for each child born in that decade, and the grain wobbling in a way that is theirs
 * alone. Those no longer with us wear a marigold garland.
 */

/** A number from a string that stays the same for the same string. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const f1 = (n: number) => Math.round(n * 10) / 10;

/** A closed smooth curve through the points (Catmull-Rom as cubic Béziers). */
function closedCurve(pts: [number, number][]): string {
  const n = pts.length;
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${f1(c1x)} ${f1(c1y)} ${f1(c2x)} ${f1(c2y)} ${f1(p2[0])} ${f1(p2[1])}`;
  }
  return `${d}Z`;
}

/** Width of the art in drawing units; its height depends on the card's layout. */
const W = 200;
const PITH = 21;
const DECADE = 9.2;

interface Ring {
  d: string;
  outer: boolean;
}

interface RingArt {
  rings: Ring[];
  rays: string[];
  kids: { x: number; y: number; gender: Person['gender'] }[];
  sparks: { x: number; y: number; s: number; d: number }[];
  unknown: boolean;
}

function drawRings(id: string, age: number | null, kids: { at: number | null; gender: Person['gender'] }[], h: number, sparkle: boolean): RingArt {
  const rand = seeded(hash(id));
  const cx = W / 2;
  const cy = h / 2;
  // The grain: a few slow waves every ring shares, so they nest like real growth rings,
  // and a small wobble of each ring's own.
  const waves = [2, 3, 5].map((k, i) => ({ k, a: (0.05 - i * 0.012) * (0.5 + rand()), p: rand() * TAU }));
  // The pith sits off centre and the rings drift further that way as the tree grows.
  const drift = rand() * TAU;
  const ex = Math.cos(drift) * 0.9;
  const ey = Math.sin(drift) * 0.55;

  const unknown = age === null;
  const count = unknown ? 5 : Math.max(1, Math.min(11, Math.ceil((age + 0.5) / 10)));
  const radiusAt = (R: number, i: number, own: { a: number; k: number; p: number }, t: number) => {
    let w = 0;
    for (const v of waves) w += v.a * Math.sin(v.k * t + v.p) * Math.min(1, R / 40);
    w += own.a * Math.sin(own.k * t + own.p);
    return [cx + i * ex + Math.cos(t) * R * (1 + w), cy + i * ey + Math.sin(t) * R * (1 + w)] as [number, number];
  };

  const owns: { a: number; k: number; p: number }[] = [];
  const rings: Ring[] = [];
  for (let i = count; i >= 1; i--) owns[i] = { a: 0.012 + rand() * 0.012, k: 4 + Math.floor(rand() * 4), p: rand() * TAU };
  for (let i = count; i >= 1; i--) {
    const R = PITH + i * DECADE;
    const pts: [number, number][] = [];
    const n = 48;
    for (let j = 0; j < n; j++) pts.push(radiusAt(R, i, owns[i], (j / n) * TAU));
    rings.push({ d: closedCurve(pts), outer: i === count });
  }

  // Cracks running out from the heart of the wood.
  const rays: string[] = [];
  if (count >= 3) {
    const outerR = PITH + count * DECADE;
    for (let r = 0; r < 3; r++) {
      const t = rand() * TAU;
      const len = outerR * (0.45 + rand() * 0.4);
      const bend = (rand() - 0.5) * 0.12;
      const a = [cx + Math.cos(t) * (PITH + 2), cy + Math.sin(t) * (PITH + 2)];
      const m = [cx + Math.cos(t + bend) * (PITH + len) * 0.6, cy + Math.sin(t + bend) * (PITH + len) * 0.6];
      const b = [cx + Math.cos(t - bend) * (PITH + len), cy + Math.sin(t - bend) * (PITH + len)];
      rays.push(`M${f1(a[0])} ${f1(a[1])}Q${f1(m[0])} ${f1(m[1])} ${f1(b[0])} ${f1(b[1])}`);
    }
  }

  // A child on the ring of the decade they arrived in, spread round by the golden angle.
  const dots: RingArt['kids'] = [];
  if (!unknown) {
    let t = rand() * TAU;
    for (const k of kids) {
      if (k.at === null) continue;
      const ring = Math.min(count, k.at / 10);
      const R = PITH + ring * DECADE;
      const i = Math.max(1, Math.round(ring));
      const [x, y] = radiusAt(R, i, owns[i] ?? owns[count], t);
      dots.push({ x: f1(x), y: f1(y), gender: k.gender });
      t += 2.39996;
    }
  }

  // Glints of light for the rare cards, kept off the middle.
  const sparks: RingArt['sparks'] = [];
  if (sparkle) {
    for (let i = 0; i < 7; i++) {
      const left = i % 2 === 0;
      sparks.push({
        x: f1(left ? 8 + rand() * 50 : W - 8 - rand() * 50),
        y: f1(8 + rand() * (h - 16)),
        s: f1(2.6 + rand() * 4.2),
        d: f1(rand() * 3.2),
      });
    }
  }
  return { rings, rays, kids: dots, sparks, unknown };
}

const SPARK = 'M0-1C.12-.12.12-.12 1 0C.12.12.12.12 0 1C-.12.12-.12.12-1 0C-.12-.12-.12-.12 0-1Z';

interface LifeRingsProps {
  id: string;
  age: number | null;
  kids: { at: number | null; gender: Person['gender'] }[];
  rarity: Rarity;
  /** Drawing height: taller for full-art cards */
  h: number;
  monogram: string;
  photo?: string;
}

export const LifeRings = memo(function LifeRings({ id, age, kids, rarity, h, monogram, photo }: LifeRingsProps) {
  const clip = useId();
  const art = useMemo(() => drawRings(id, age, kids, h, rarity !== 'common'), [id, age, kids, h, rarity]);
  const cx = W / 2;
  const cy = h / 2;
  const pith = photo ? PITH + 7 : PITH;
  return (
    <svg className={`fc-rings${art.unknown ? ' is-unknown' : ''}`} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="fc-wood">
        {art.rings.map((r, i) => (
          <path key={i} d={r.d} className={`fc-ring${i % 2 ? ' is-late' : ''}${r.outer ? ' is-bark' : ''}`} />
        ))}
        {art.rays.map((d, i) => (
          <path key={i} d={d} className="fc-ray" />
        ))}
      </g>
      {art.kids.map((k, i) => (
        <circle key={i} cx={k.x} cy={k.y} r={3.4} className={`fc-kid g-${k.gender}`} style={{ '--i': i } as React.CSSProperties} />
      ))}
      <circle cx={cx} cy={cy} r={pith} className="fc-pith" />
      {photo ? (
        <>
          <clipPath id={clip}>
            <circle cx={cx} cy={cy} r={pith - 2} />
          </clipPath>
          <image href={photo} x={cx - pith} y={cy - pith} width={pith * 2} height={pith * 2} clipPath={`url(#${clip})`} preserveAspectRatio="xMidYMid slice" className="fc-photo" />
        </>
      ) : (
        <text x={cx} y={cy} className="fc-monogram" textAnchor="middle" dominantBaseline="central">
          {monogram}
        </text>
      )}
      {art.sparks.length > 0 && (
        <g className="fc-sparks">
          {art.sparks.map((s, i) => (
            <path key={i} d={SPARK} transform={`translate(${s.x} ${s.y}) scale(${s.s})`} style={{ animationDelay: `${s.d}s` }} />
          ))}
        </g>
      )}
    </svg>
  );
});

// ---------------------------------------------------------------------------
// A marigold garland, as hung on the photograph of someone who has passed away
// ---------------------------------------------------------------------------

const GARLAND = (() => {
  // A quadratic sag from corner to corner.
  const at = (t: number) => {
    const u = 1 - t;
    const x = u * u * -8 + 2 * u * t * 100 + t * t * 208;
    const y = u * u * -2 + 2 * u * t * 36 + t * t * -2;
    const dy = 2 * u * 38 - 2 * t * 38;
    return { x: f1(x), y: f1(y), a: f1((Math.atan2(dy, 216) * 180) / Math.PI) };
  };
  const flowers = [];
  const leaves = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    flowers.push({ ...at(t), tone: i % 3 === 1 ? 'is-yellow' : 'is-orange', r: i === 7 ? 6.6 : 5.8 });
    if (i < n - 1) leaves.push(at(t + 0.5 / (n - 1)));
  }
  return { flowers, leaves };
})();

function Marigold({ x, y, r, tone }: { x: number; y: number; r: number; tone: string }) {
  return (
    <g className={`fc-marigold ${tone}`} transform={`translate(${x} ${y})`}>
      <circle r={r} className="fc-petals" />
      <circle r={r * 0.58} className="fc-petals-in" />
      <circle r={r * 0.2} className="fc-eye" />
    </g>
  );
}

export const Garland = memo(function Garland() {
  return (
    <svg className="fc-garland" viewBox="0 0 200 40" aria-hidden="true">
      <path d="M-8 -2Q100 36 208 -2" className="fc-garland-string" />
      {GARLAND.leaves.map((l, i) => (
        <g key={i} transform={`translate(${l.x} ${l.y}) rotate(${l.a})`}>
          <ellipse cx="0" cy="-4.6" rx="2.1" ry="4.4" className="fc-leaf" transform="rotate(-28)" />
          <ellipse cx="0" cy="4.6" rx="2.1" ry="4.4" className="fc-leaf" transform="rotate(28)" />
        </g>
      ))}
      <g className="fc-pendant">
        <path d="M100 18V28" className="fc-garland-string" />
        <Marigold x={100} y={27} r={4.4} tone="is-yellow" />
        <path d="M98.2 30.5L100 38L101.8 30.5Z" className="fc-tassel" />
      </g>
      {GARLAND.flowers.map((f, i) => (
        <Marigold key={i} x={f.x} y={f.y} r={f.r} tone={f.tone} />
      ))}
    </svg>
  );
});

// ---------------------------------------------------------------------------
// Gold filigree in the corners of a legendary card
// ---------------------------------------------------------------------------

export function Filigree() {
  const corner = (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M2.5 46V19C2.5 9.9 9.9 2.5 19 2.5H46" className="fc-fili-line" />
      <path d="M8 38V22C8 14.3 14.3 8 22 8H38" className="fc-fili-thin" />
      <path d="M13.5 25.5C12.8 18.6 18.6 12.8 25.5 13.5C30 14 30.4 19.7 26.6 20.6C23.6 21.3 21.3 23.6 20.6 26.6C19.7 30.4 14 30 13.5 25.5Z" className="fc-fili-curl" />
      <circle cx="21.6" cy="21.6" r="1.9" className="fc-fili-dot" />
      <path d="M46 2.5L41 0.5M46 2.5L41 4.5M2.5 46L0.5 41M2.5 46L4.5 41" className="fc-fili-thin" />
    </svg>
  );
  return (
    <span className="fc-filigree" aria-hidden="true">
      <span className="is-tl">{corner}</span>
      <span className="is-tr">{corner}</span>
      <span className="is-bl">{corner}</span>
      <span className="is-br">{corner}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The back of every card: an engraved rosette like a banknote's, with the tree's mark
// ---------------------------------------------------------------------------

const ROSETTE = (() => {
  // Overlapping ellipses turned a little each time make the guilloché.
  const petals: string[] = [];
  for (let j = 0; j < 30; j++) petals.push(`rotate(${j * 6} 90 112)`);
  const lace: { x: number; y: number }[] = [];
  for (let j = 0; j < 40; j++) {
    const t = (j / 40) * TAU;
    lace.push({ x: f1(90 + Math.cos(t) * 56), y: f1(112 + Math.sin(t) * 56) });
  }
  // A wavy band round it, like the edge of a stamp.
  const pts: [number, number][] = [];
  for (let j = 0; j < 160; j++) {
    const t = (j / 160) * TAU;
    const r = 70 + Math.sin(t * 20) * 2.6;
    pts.push([90 + Math.cos(t) * r, 112 + Math.sin(t) * r]);
  }
  return { petals, lace, band: closedCurve(pts) };
})();

export const CardBack = memo(function CardBack({ title }: { title?: string }) {
  return (
    <div className="fc-back-plain">
      <svg className="fc-back-art" viewBox="0 0 180 252" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="fc-guilloche">
          {ROSETTE.petals.map((t, i) => (
            <ellipse key={i} cx="90" cy="112" rx="50" ry="17" transform={t} />
          ))}
          {ROSETTE.lace.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="11" />
          ))}
          <path d={ROSETTE.band} />
          <circle cx="90" cy="112" r="78" />
          <circle cx="90" cy="112" r="81" className="is-thin" />
        </g>
        <circle cx="90" cy="112" r="27" className="fc-medal" />
        <circle cx="90" cy="112" r="23.5" className="fc-medal-ring" />
        <g transform="translate(74 96)" className="fc-back-mark">
          <path d="M16 13v5M9 23v-2.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5V23" fill="none" strokeWidth="2" strokeLinecap="round" />
          <circle cx="16" cy="10" r="3" />
          <circle cx="9" cy="24" r="2.5" />
          <circle cx="23" cy="24" r="2.5" />
        </g>
      </svg>
      {title && <span className="fc-back-title">{title}</span>}
    </div>
  );
});
