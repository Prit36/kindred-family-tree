import { memo, useId, type CSSProperties } from 'react';
import type { Person } from '../types';
import type { Rarity } from '../lib/cards';
import { TWINKLE_PHASES, closedCurve, installCardImages } from '../lib/cardImages';

/**
 * The pictures on a family card, drawn from who the person is rather than picked from a
 * set: a cross-section of a tree trunk with a ring for every ten years of their life (a
 * child's card is a sapling, a great-grandparent's fills the frame), a dot on the ring
 * for each child born in that decade, and the grain wobbling in a way that is theirs
 * alone. Those no longer with us wear a marigold garland.
 *
 * Only the rings are drawn per person. Everything every card shares (garland, filigree,
 * back, glints, paper) is one image made once in lib/cardImages, and nothing here moves
 * except by transform or opacity, so cards never have to be repainted to animate.
 */

installCardImages();

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

/** Width of the art in drawing units; its height depends on the card's layout. */
const W = 200;
const PITH = 21;
const DECADE = 9.2;
/** Points round each ring: smooth at any card size once joined as Béziers. */
const STEPS = 32;

type Kids = { at: number | null; gender: Person['gender'] }[];

interface RingArt {
  /** Outermost first, so each inner ring paints over the one outside it */
  rings: string[];
  rays: string;
  kids: { x: number; y: number; gender: Person['gender'] }[];
  /** Glints as percentages of the picture, with a size in em and the point in the twinkle they start from */
  sparks: { x: number; y: number; s: number; k: number }[];
  unknown: boolean;
}

function drawRings(id: string, age: number | null, kids: Kids, h: number, sparkle: boolean): RingArt {
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
  const owns: { a: number; k: number; p: number }[] = [];
  for (let i = count; i >= 1; i--) owns[i] = { a: 0.012 + rand() * 0.012, k: 4 + Math.floor(rand() * 4), p: rand() * TAU };
  const radiusAt = (R: number, i: number, t: number): [number, number] => {
    const own = owns[i] ?? owns[count];
    let w = own.a * Math.sin(own.k * t + own.p);
    const reach = Math.min(1, R / 40);
    for (const v of waves) w += v.a * Math.sin(v.k * t + v.p) * reach;
    return [cx + i * ex + Math.cos(t) * R * (1 + w), cy + i * ey + Math.sin(t) * R * (1 + w)];
  };

  const rings: string[] = [];
  for (let i = count; i >= 1; i--) {
    const R = PITH + i * DECADE;
    const pts: [number, number][] = [];
    for (let j = 0; j < STEPS; j++) pts.push(radiusAt(R, i, (j / STEPS) * TAU));
    rings.push(closedCurve(pts));
  }

  // Cracks running out from the heart of the wood, all in one path.
  // (Joined once, like the rings: see closedCurve.)
  const cracks: string[] = [];
  if (count >= 3) {
    const outerR = PITH + count * DECADE;
    for (let r = 0; r < 3; r++) {
      const t = rand() * TAU;
      const len = outerR * (0.45 + rand() * 0.4);
      const bend = (rand() - 0.5) * 0.12;
      cracks.push(
        `M${f1(cx + Math.cos(t) * (PITH + 2))} ${f1(cy + Math.sin(t) * (PITH + 2))}` +
          `Q${f1(cx + Math.cos(t + bend) * (PITH + len) * 0.6)} ${f1(cy + Math.sin(t + bend) * (PITH + len) * 0.6)} ` +
          `${f1(cx + Math.cos(t - bend) * (PITH + len))} ${f1(cy + Math.sin(t - bend) * (PITH + len))}`,
      );
    }
  }
  const rays = cracks.join('');

  // A child on the ring of the decade they arrived in, spread round by the golden angle.
  const dots: RingArt['kids'] = [];
  if (!unknown) {
    let t = rand() * TAU;
    for (const k of kids) {
      if (k.at === null) continue;
      const ring = Math.min(count, k.at / 10);
      const [x, y] = radiusAt(PITH + ring * DECADE, Math.max(1, Math.round(ring)), t);
      dots.push({ x: f1(x), y: f1(y), gender: k.gender });
      t += 2.39996;
    }
  }

  // Glints of light for the rare cards, kept off the middle.
  const sparks: RingArt['sparks'] = [];
  if (sparkle) {
    for (let i = 0; i < 4; i++) {
      const left = i % 2 === 0;
      const x = left ? 8 + rand() * 50 : W - 8 - rand() * 50;
      const y = 8 + rand() * (h - 16);
      // Each glint twinkles from its own point in the twinkle, all starting together (see
      // lib/cardImages for why): what used to be a delay of up to one 3.2s twinkle.
      const size = f1(0.75 + rand() * 1.1);
      const delay = rand();
      sparks.push({
        x: f1((x / W) * 100),
        y: f1((y / h) * 100),
        s: size,
        k: Math.round((1 - delay) * TWINKLE_PHASES) % TWINKLE_PHASES,
      });
    }
  }
  return { rings, rays, kids: dots, sparks, unknown };
}

// The same person is often on screen twice (in the hand and the grid) and comes back as
// decks and orders change, so the drawings are kept - the most recent few hundred only.
const drawn = new Map<string, RingArt>();
const KEEP = 400;

function ringsFor(id: string, age: number | null, kids: Kids, h: number, sparkle: boolean): RingArt {
  let key = `${id}|${age}|${h}|${sparkle ? 1 : 0}|`;
  for (const k of kids) key += k.at === null ? '' : `${k.at}${k.gender[0]},`;
  const hit = drawn.get(key);
  if (hit) {
    // Most recently used goes to the back of the line.
    drawn.delete(key);
    drawn.set(key, hit);
    return hit;
  }
  const art = drawRings(id, age, kids, h, sparkle);
  drawn.set(key, art);
  if (drawn.size > KEEP) drawn.delete(drawn.keys().next().value!);
  return art;
}

interface LifeRingsProps {
  id: string;
  age: number | null;
  kids: Kids;
  rarity: Rarity;
  /** Drawing height: taller for full-art cards */
  h: number;
  monogram: string;
  photo?: string;
}

export const LifeRings = memo(function LifeRings({ id, age, kids, rarity, h, monogram, photo }: LifeRingsProps) {
  const clip = useId();
  const art = ringsFor(id, age, kids, h, rarity !== 'common');
  const cx = W / 2;
  const cy = h / 2;
  const pith = photo ? PITH + 7 : PITH;
  return (
    <>
      <svg className={`fc-rings${art.unknown ? ' is-unknown' : ''}`} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g className="fc-wood">
          {art.rings.map((d, i) => (
            <path key={i} d={d} className={i === 0 ? 'fc-ring is-bark' : i % 2 ? 'fc-ring is-late' : 'fc-ring'} />
          ))}
          {art.rays && <path d={art.rays} className="fc-ray" />}
        </g>
        {art.kids.map((k, i) => (
          <circle key={i} cx={k.x} cy={k.y} r={3.4} className={`fc-kid g-${k.gender}`} style={{ '--i': i } as CSSProperties} />
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
      </svg>
      {art.sparks.length > 0 && (
        <span className="fc-sparks" aria-hidden="true">
          {art.sparks.map((s, i) => (
            <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, '--s': `${s.s}em`, '--tw': `fc-tw${s.k}` } as CSSProperties} />
          ))}
        </span>
      )}
    </>
  );
});

/** The marigold garland over those who have passed: one shared picture. */
export function Garland() {
  return <span className="fc-garland" aria-hidden="true" />;
}

/** Gold filigree in the four corners of a legendary card: one masked layer. */
export function Filigree() {
  return <span className="fc-filigree" aria-hidden="true" />;
}

/** The back of every card: an engraved rosette round a medallion with the tree's mark. */
export const CardBack = memo(function CardBack({ title }: { title?: string }) {
  return (
    <div className="fc-back-plain">
      <span className="fc-back-rosette" aria-hidden="true" />
      <span className="fc-back-medal" aria-hidden="true">
        <svg viewBox="0 0 32 32" className="fc-back-mark">
          <path d="M16 13v5M9 23v-2.5a2.5 2.5 0 0 1 2.5-2.5h9a2.5 2.5 0 0 1 2.5 2.5V23" fill="none" strokeWidth="2" strokeLinecap="round" />
          <circle cx="16" cy="10" r="3" />
          <circle cx="9" cy="24" r="2.5" />
          <circle cx="23" cy="24" r="2.5" />
        </svg>
      </span>
      {title && <span className="fc-back-title">{title}</span>}
    </div>
  );
});
