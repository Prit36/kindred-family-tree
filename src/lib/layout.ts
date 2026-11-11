import { Graph, layout as dagreLayout } from '@dagrejs/dagre';
import type { Tree, UnionStatus } from '../types';
import { compareByBirth } from './dates';

export const CARD_W = 224;
export const CARD_H = 80;
const PARTNER_GAP = 40;
const SIBLING_GAP = 36;
const GROUP_GAP = 68;
const COMPONENT_GAP = 120;
const RANK_SEP = 104;
const LANE_STEP = 11;
const CORNER = 12;
const STEP = CARD_W + PARTNER_GAP;
/** Radius of the small ring drawn where a couple's line meets their children's line. */
export const UNION_RING = 4.5;
/** How far from a card the collapse toggle sits on the line to its children or parents. */
export const TOGGLE_GAP = 24;

export interface NodePos {
  x: number;
  y: number;
}

export interface UnionLine {
  id: string;
  status: UnionStatus;
  d: string;
  midX: number;
  midY: number;
  a: string;
  b: string;
  /** Drawn as a straight line between neighbouring cards (the usual case), not an arc */
  adjacent: boolean;
}

/** The start of the line from a couple (or a single parent) down to their children. */
export interface Stem {
  x: number;
  y: number;
  /** Where the toggle that collapses those children sits */
  toggleY: number;
}

export interface ChildLink {
  childId: string;
  parentIds: string[];
  d: string;
}

export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface TreeLayout {
  nodes: Record<string, NodePos>;
  unions: UnionLine[];
  links: ChildLink[];
  /** Tight box around all cards */
  bounds: Bounds;
  generations: number;
}

/** Keeps one person at a fixed spot so the tree doesn't jump around when it changes. */
export interface LayoutAnchor {
  id: string;
  x: number;
  y: number;
}

interface Family {
  parents: string[];
  children: string[];
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

function stemFrom(nodes: Record<string, NodePos>, union: UnionLine | undefined, parents: string[]): Stem | null {
  if (union) {
    return {
      x: union.midX,
      y: union.midY + UNION_RING,
      toggleY: union.adjacent ? union.midY + CARD_H / 2 + TOGGLE_GAP : union.midY - 16,
    };
  }
  const single = parents.map((id) => nodes[id]).find(Boolean);
  if (!single) return null;
  return { x: single.x + CARD_W / 2, y: single.y + CARD_H, toggleY: single.y + CARD_H + TOGGLE_GAP };
}

/**
 * Where a family's children hang from in a finished layout - also for parents whose
 * children are currently collapsed away and so have no line of their own.
 */
export function familyStem(layout: TreeLayout, parents: string[]): Stem | null {
  const [a, b] = parents;
  const union =
    parents.length === 2 ? layout.unions.find((u) => (u.a === a && u.b === b) || (u.a === b && u.b === a)) : undefined;
  return stemFrom(layout.nodes, union, parents);
}

/**
 * Lays the family out in generations.
 *
 * 1. Partners are merged into "groups" that always sit side by side.
 * 2. dagre assigns each group a generation (rank) and a starting order.
 * 3. The order inside each generation is refined so siblings stay together and each
 *    partner sits on the side of their own family.
 * 4. Horizontal positions are solved so siblings pack under their parents and parents
 *    centre over their children.
 * 5. Connectors are drawn as orthogonal lines from each couple down to their children.
 */
export function computeLayout(tree: Tree, anchor?: LayoutAnchor): TreeLayout {
  const people = tree.people;
  const ids = Object.keys(people);
  if (ids.length === 0) {
    return { nodes: {}, unions: [], links: [], bounds: { minX: 0, minY: 0, width: 0, height: 0 }, generations: 0 };
  }

  // Oldest first, so siblings read left-to-right by age wherever nothing else decides.
  const ordered = [...ids].sort((a, b) => compareByBirth(people[a], people[b]));
  const birthOrder = new Map(ordered.map((id, i) => [id, i]));

  // --- 1. Group partners (union-find over couples) -------------------------
  const makeFinder = (keys: string[]) => {
    const root = new Map<string, string>(keys.map((k) => [k, k]));
    const find = (k: string): string => {
      let r = k;
      while (root.get(r) !== r) r = root.get(r)!;
      root.set(k, r);
      return r;
    };
    const join = (a: string, b: string) => root.set(find(a), find(b));
    return { find, join };
  };

  const partnerSets = makeFinder(ids);
  const unions = tree.unions.filter((u) => people[u.a] && people[u.b]);
  const adjacency = new Map<string, string[]>();
  for (const u of unions) {
    partnerSets.join(u.a, u.b);
    if (!adjacency.has(u.a)) adjacency.set(u.a, []);
    if (!adjacency.has(u.b)) adjacency.set(u.b, []);
    adjacency.get(u.a)!.push(u.b);
    adjacency.get(u.b)!.push(u.a);
  }
  const groupOf = partnerSets.find;

  const members = new Map<string, string[]>();
  for (const id of ordered) {
    const g = groupOf(id);
    if (!members.has(g)) members.set(g, []);
    members.get(g)!.push(id);
  }
  // Order each group as a chain so every couple is adjacent where possible.
  for (const [g, list] of members) {
    if (list.length === 1) continue;
    if (list.length === 2) {
      const [a, b] = list;
      members.set(g, people[a].gender === 'female' && people[b].gender === 'male' ? [b, a] : [a, b]);
      continue;
    }
    const start = list.find((id) => (adjacency.get(id)?.length ?? 0) === 1) ?? list[0];
    const seen = new Set<string>();
    const chain: string[] = [];
    const walk = (id: string) => {
      seen.add(id);
      chain.push(id);
      for (const n of adjacency.get(id) ?? []) if (!seen.has(n)) walk(n);
    };
    walk(start);
    members.set(g, chain);
  }
  const groupIds = [...members.keys()];
  const groupWidth = (g: string) => members.get(g)!.length * STEP - PARTNER_GAP;

  // Families: a set of parents and the children they share.
  const families = new Map<string, Family>();
  const childFamily = new Map<string, Family>();
  const childrenOf = new Map<string, string[]>();
  for (const id of ordered) {
    const parents = people[id].parentIds.filter((pid) => people[pid]).sort();
    if (parents.length === 0) continue;
    const key = parents.join('|');
    let fam = families.get(key);
    if (!fam) families.set(key, (fam = { parents, children: [] }));
    fam.children.push(id);
    childFamily.set(id, fam);
    for (const p of parents) {
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p)!.push(id);
    }
  }

  // --- 2. Generations via dagre --------------------------------------------
  const graph = new Graph();
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 60 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const g of groupIds) graph.setNode(g, { width: groupWidth(g), height: CARD_H });
  const components = makeFinder(groupIds);
  for (const fam of families.values()) {
    for (const child of fam.children) {
      for (const parent of fam.parents) {
        const pg = groupOf(parent);
        const cg = groupOf(child);
        if (pg === cg) continue;
        graph.setEdge(pg, cg);
        components.join(pg, cg);
      }
    }
  }
  dagreLayout(graph);

  const seed = new Map<string, { x: number; y: number }>();
  for (const g of groupIds) {
    const n = graph.node(g) as { x: number; y: number };
    seed.set(g, { x: n.x, y: Math.round(n.y) });
  }
  const levels = [...new Set([...seed.values()].map((s) => s.y))].sort((a, b) => a - b);
  const rankOfGroup = new Map<string, number>(groupIds.map((g) => [g, levels.indexOf(seed.get(g)!.y)]));
  const rankOf = (personId: string) => rankOfGroup.get(groupOf(personId))!;

  // --- 3 & 4. Order and position each connected family separately ----------
  const groupX = new Map<string, number>();
  const groupRank = new Map<string, number>();

  const layoutComponent = (groups: string[]): number => {
    const minRank = Math.min(...groups.map((g) => rankOfGroup.get(g)!));
    const maxRank = Math.max(...groups.map((g) => rankOfGroup.get(g)!));
    let rows: string[][] = Array.from({ length: maxRank - minRank + 1 }, () => []);
    for (const g of groups) rows[rankOfGroup.get(g)! - minRank].push(g);
    for (const row of rows) row.sort((a, b) => seed.get(a)!.x - seed.get(b)!.x);
    const rowOf = (personId: string) => rankOf(personId) - minRank;

    // ---- ordering ----
    const pos = new Map<string, number>();
    const reindex = () => {
      for (const row of rows) {
        let i = 0;
        for (const g of row) for (const m of members.get(g)!) pos.set(m, i++);
      }
    };
    const anchorPos = (fam: Family) => mean(fam.parents.map((p) => pos.get(p)!));

    /** Flip a group if that puts each partner nearer their own parents and siblings. */
    const orient = (rowIndex: number) => {
      for (const g of rows[rowIndex]) {
        const list = members.get(g)!;
        if (list.length < 2) continue;
        const start = pos.get(list[0])!;
        const cost = (order: string[]) => {
          let inversions = 0;
          let distance = 0;
          const anchors: number[] = [];
          order.forEach((m, i) => {
            const fam = childFamily.get(m);
            if (!fam) return;
            const a = anchorPos(fam);
            for (const earlier of anchors) if (earlier > a + 1e-9) inversions++;
            anchors.push(a);
            // Distance to the nearest sibling on each side: someone in the middle of their
            // siblings has no preference, someone at the end wants to face inward.
            const here = start + i;
            let left = -Infinity;
            let right = Infinity;
            for (const c of fam.children) {
              if (groupOf(c) === g || rowOf(c) !== rowIndex) continue;
              const p = pos.get(c)!;
              if (p < here) left = Math.max(left, p);
              else right = Math.min(right, p);
            }
            if (left !== -Infinity) distance += here - left;
            if (right !== Infinity) distance += right - here;
          });
          return inversions * 1e6 + distance;
        };
        const reversed = [...list].reverse();
        if (cost(reversed) < cost(list) - 1e-9) members.set(g, reversed);
      }
      reindex();
    };

    const sortRow = (rowIndex: number, weight: (g: string) => number | null, tieBreak?: (g: string) => number) => {
      const row = rows[rowIndex];
      const index = new Map(row.map((g, i) => [g, i]));
      const value = new Map(row.map((g) => [g, weight(g)]));
      const sortable = row
        .filter((g) => value.get(g) !== null)
        .sort((a, b) => {
          const diff = value.get(a)! - value.get(b)!;
          if (Math.abs(diff) > 1e-9) return diff;
          const tie = tieBreak ? tieBreak(a) - tieBreak(b) : 0;
          return tie || index.get(a)! - index.get(b)!;
        });
      let k = 0;
      rows[rowIndex] = row.map((g) => (value.get(g) === null ? g : sortable[k++]));
      reindex();
      orient(rowIndex);
    };

    const fromParents = (rowIndex: number) => (g: string) => {
      const values: number[] = [];
      for (const m of members.get(g)!) {
        const fam = childFamily.get(m);
        if (fam && rowOf(fam.parents[0]) < rowIndex) values.push(anchorPos(fam));
      }
      return values.length ? mean(values) : null;
    };
    const fromChildren = (rowIndex: number) => (g: string) => {
      const values: number[] = [];
      for (const m of members.get(g)!) {
        for (const c of childrenOf.get(m) ?? []) if (rowOf(c) > rowIndex) values.push(pos.get(c)!);
      }
      return values.length ? mean(values) : null;
    };
    // Oldest sibling first; people without a birth date keep the order they were added in.
    const age = (g: string) =>
      Math.min(...members.get(g)!.map((m) => (childFamily.has(m) ? birthOrder.get(m)! : Infinity)));

    const crossings = () => {
      const buckets = new Map<string, [number, number][]>();
      for (const g of groups) {
        for (const m of members.get(g)!) {
          const fam = childFamily.get(m);
          if (!fam) continue;
          const key = `${rowOf(fam.parents[0])}>${rowOf(m)}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push([anchorPos(fam), pos.get(m)!]);
        }
      }
      let count = 0;
      for (const edges of buckets.values()) {
        for (let i = 0; i < edges.length; i++) {
          for (let j = i + 1; j < edges.length; j++) {
            if ((edges[i][0] - edges[j][0]) * (edges[i][1] - edges[j][1]) < -1e-9) count++;
          }
        }
      }
      return count;
    };

    const snapshot = () => ({
      rows: rows.map((r) => [...r]),
      members: groups.map((g) => [g, [...members.get(g)!]] as const),
    });

    reindex();
    for (let r = 0; r < rows.length; r++) orient(r);
    for (let r = 1; r < rows.length; r++) sortRow(r, fromParents(r), age);
    let best = snapshot();
    let bestScore = crossings();
    for (let pass = 0; pass < 8 && bestScore > 0; pass++) {
      for (let r = rows.length - 2; r >= 0; r--) sortRow(r, fromChildren(r));
      for (let r = 1; r < rows.length; r++) sortRow(r, fromParents(r));
      const score = crossings();
      if (score < bestScore) {
        best = snapshot();
        bestScore = score;
      }
    }
    rows = best.rows;
    for (const [g, list] of best.members) members.set(g, [...list]);

    // ---- horizontal positions ----
    const x = new Map<string, number>();
    const memberIndex = new Map<string, number>();
    for (const g of groups) members.get(g)!.forEach((m, i) => memberIndex.set(m, i));
    const offsetIn = (personId: string) => memberIndex.get(personId)! * STEP + CARD_W / 2;
    const centerOf = (personId: string) => x.get(groupOf(personId))! + offsetIn(personId);
    const anchorX = (fam: Family) => mean(fam.parents.map(centerOf));

    const areSiblings = (a: string, b: string) =>
      members.get(a)!.some((m) => {
        const fam = childFamily.get(m);
        return fam !== undefined && members.get(b)!.some((n) => childFamily.get(n) === fam);
      });
    const gaps = rows.map((row) =>
      row.slice(1).map((g, i) => (areSiblings(row[i], g) ? SIBLING_GAP : GROUP_GAP)),
    );

    for (const [r, row] of rows.entries()) {
      let cursor = 0;
      row.forEach((g, i) => {
        x.set(g, cursor);
        cursor += groupWidth(g) + (gaps[r][i] ?? 0);
      });
    }

    /**
     * Moves the groups of one row as close as possible to where each wants to be, keeping
     * their order and minimum gaps (weighted isotonic regression, pool-adjacent-violators).
     */
    const placeRow = (rowIndex: number, desire: (g: string) => number | null) => {
      const row = rows[rowIndex];
      const offsets: number[] = [];
      let acc = 0;
      row.forEach((g, i) => {
        offsets.push(acc);
        acc += groupWidth(g) + (gaps[rowIndex][i] ?? 0);
      });
      const pools: { weight: number; total: number; count: number }[] = [];
      row.forEach((g, i) => {
        const wanted = desire(g);
        const weight = wanted === null ? 1e-4 : 1;
        const value = (wanted ?? x.get(g)!) - offsets[i];
        pools.push({ weight, total: weight * value, count: 1 });
        while (pools.length > 1) {
          const b = pools[pools.length - 1];
          const a = pools[pools.length - 2];
          if (a.total / a.weight <= b.total / b.weight) break;
          a.weight += b.weight;
          a.total += b.total;
          a.count += b.count;
          pools.pop();
        }
      });
      let i = 0;
      for (const pool of pools) {
        const value = pool.total / pool.weight;
        for (let k = 0; k < pool.count; k++, i++) x.set(row[i], value + offsets[i]);
      }
    };

    /** Where a group wants to be so its members sit packed with their siblings under their parents. */
    const underParents = (rowIndex: number) => (g: string) => {
      const shifts: number[] = [];
      for (const m of members.get(g)!) {
        const fam = childFamily.get(m);
        if (!fam || rowOf(fam.parents[0]) >= rowIndex) continue;
        const siblings = fam.children
          .filter((c) => rowOf(c) === rowIndex)
          .sort((a, b) => centerOf(a) - centerOf(b));
        let cursor = 0;
        let previous: string | null = null;
        const packed = new Map<string, number>();
        for (const s of siblings) {
          const sg = groupOf(s);
          if (sg !== previous) {
            if (previous !== null) cursor += groupWidth(previous) + SIBLING_GAP;
            previous = sg;
          }
          packed.set(s, cursor + offsetIn(s));
        }
        const spanCenter = (packed.get(siblings[0])! + packed.get(siblings[siblings.length - 1])!) / 2;
        shifts.push(anchorX(fam) + packed.get(m)! - spanCenter - centerOf(m));
      }
      return shifts.length ? x.get(g)! + mean(shifts) : null;
    };

    /** Where a group wants to be so each couple is centred over their children. */
    const familiesOfGroup = new Map<string, Family[]>();
    for (const fam of families.values()) {
      const g = groupOf(fam.parents[0]);
      if (!familiesOfGroup.has(g)) familiesOfGroup.set(g, []);
      familiesOfGroup.get(g)!.push(fam);
    }
    const overChildren = (rowIndex: number) => (g: string) => {
      const shifts: number[] = [];
      for (const fam of familiesOfGroup.get(g) ?? []) {
        const centers = fam.children.filter((c) => rowOf(c) > rowIndex).map(centerOf);
        if (centers.length === 0) continue;
        shifts.push((Math.min(...centers) + Math.max(...centers)) / 2 - anchorX(fam));
      }
      return shifts.length ? x.get(g)! + mean(shifts) : null;
    };

    for (let pass = 0; pass < 8; pass++) {
      for (let r = 1; r < rows.length; r++) placeRow(r, underParents(r));
      for (let r = rows.length - 2; r >= 0; r--) placeRow(r, overChildren(r));
    }

    let minX = Infinity;
    let maxX = -Infinity;
    for (const g of groups) {
      minX = Math.min(minX, x.get(g)!);
      maxX = Math.max(maxX, x.get(g)! + groupWidth(g));
    }
    for (const g of groups) {
      groupX.set(g, x.get(g)! - minX);
      groupRank.set(g, rankOfGroup.get(g)! - minRank);
    }
    return maxX - minX;
  };

  // The home person's family comes first, then the largest remaining ones.
  const componentGroups = new Map<string, string[]>();
  for (const g of groupIds) {
    const c = components.find(g);
    if (!componentGroups.has(c)) componentGroups.set(c, []);
    componentGroups.get(c)!.push(g);
  }
  const homeComponent = tree.homeId && people[tree.homeId] ? components.find(groupOf(tree.homeId)) : null;
  const size = (groups: string[]) => groups.reduce((n, g) => n + members.get(g)!.length, 0);
  const orderedComponents = [...componentGroups.entries()].sort(
    ([ca, a], [cb, b]) => Number(cb === homeComponent) - Number(ca === homeComponent) || size(b) - size(a),
  );

  const nodes: Record<string, NodePos> = {};
  let cursorX = 0;
  for (const [, groups] of orderedComponents) {
    const width = layoutComponent(groups);
    for (const g of groups) {
      members.get(g)!.forEach((id, i) => {
        nodes[id] = {
          x: Math.round(cursorX + groupX.get(g)! + i * STEP),
          y: groupRank.get(g)! * (CARD_H + RANK_SEP),
        };
      });
    }
    cursorX += width + COMPONENT_GAP;
  }

  // Shift so the anchor person stays exactly where they were (or start at the origin).
  const extent = (): Bounds => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of Object.values(nodes)) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + CARD_W);
      maxY = Math.max(maxY, n.y + CARD_H);
    }
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  };
  const raw = extent();
  const anchored = anchor ? nodes[anchor.id] : undefined;
  const dx = anchor && anchored ? Math.round(anchor.x - anchored.x) : -raw.minX;
  const dy = anchor && anchored ? Math.round(anchor.y - anchored.y) : -raw.minY;
  for (const n of Object.values(nodes)) {
    n.x += dx;
    n.y += dy;
  }
  const bounds = extent();

  // --- 5a. Couple lines -----------------------------------------------------
  const unionLines: UnionLine[] = unions.map((u) => {
    const a = nodes[u.a];
    const b = nodes[u.b];
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const y = l.y + CARD_H / 2;
    const x1 = l.x + CARD_W;
    const x2 = r.x;
    const adjacent = l.y === r.y && x2 - x1 <= PARTNER_GAP + 1;
    const midX = (x1 + x2) / 2;
    if (adjacent) {
      // Two segments, leaving room for the ring drawn at the midpoint.
      const d = `M ${x1} ${y} L ${midX - UNION_RING} ${y} M ${midX + UNION_RING} ${y} L ${x2} ${y}`;
      return { id: u.id, status: u.status, d, midX, midY: y, a: u.a, b: u.b, adjacent: true };
    }
    // Not side by side (rare, e.g. several marriages): arc over the cards in between.
    const top = Math.min(l.y, r.y) - 22;
    const sx = l.x + CARD_W / 2;
    const ex = r.x + CARD_W / 2;
    return {
      id: u.id,
      status: u.status,
      d: `M ${sx} ${l.y} C ${sx} ${top}, ${ex} ${top}, ${ex} ${r.y}`,
      midX: (sx + ex) / 2,
      midY: top + 6,
      a: u.a,
      b: u.b,
      adjacent: false,
    };
  });
  const unionByPair = new Map(unionLines.map((u) => [[u.a, u.b].sort().join('|'), u]));

  // --- 5b. Parent → child connectors ---------------------------------------
  interface Run {
    ax: number;
    ay: number;
    parents: string[];
    children: string[];
    top: number;
    min: number;
    max: number;
    lane: number;
  }
  const runs: Run[] = [];
  for (const [key, fam] of families) {
    const union = fam.parents.length === 2 ? unionByPair.get(key) : undefined;
    const { x: ax, y: ay } = stemFrom(nodes, union, fam.parents)!;
    const centers = fam.children.map((c) => nodes[c].x + CARD_W / 2);
    runs.push({
      ax,
      ay,
      parents: fam.parents,
      children: fam.children,
      top: Math.min(...fam.children.map((c) => nodes[c].y)),
      min: Math.min(ax, ...centers),
      max: Math.max(ax, ...centers),
      lane: 0,
    });
  }

  // Families whose horizontal runs overlap in the same gap get separate lanes.
  const byGap = new Map<number, Run[]>();
  for (const run of runs) {
    if (!byGap.has(run.top)) byGap.set(run.top, []);
    byGap.get(run.top)!.push(run);
  }
  const laneCount = new Map<number, number>();
  for (const [top, list] of byGap) {
    list.sort((a, b) => a.min - b.min);
    const laneEnds: number[] = [];
    for (const run of list) {
      let lane = laneEnds.findIndex((end) => end + 16 < run.min);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = run.max;
      run.lane = lane;
    }
    laneCount.set(top, laneEnds.length);
  }

  const links: ChildLink[] = [];
  for (const run of runs) {
    const lanes = laneCount.get(run.top)!;
    const step = Math.min(LANE_STEP, (RANK_SEP - 44) / Math.max(1, lanes - 1));
    const busY = Math.round(run.top - RANK_SEP / 2 + (run.lane - (lanes - 1) / 2) * step);
    for (const childId of run.children) {
      const cx = nodes[childId].x + CARD_W / 2;
      const cy = nodes[childId].y;
      const delta = cx - run.ax;
      const s = Math.sign(delta);
      const r = Math.max(0, Math.min(CORNER, Math.abs(delta) / 2, busY - run.ay, cy - busY));
      // The command sequence is identical for every link so the path can be CSS-transitioned.
      const d =
        `M ${run.ax} ${run.ay} L ${run.ax} ${busY - r} ` +
        `Q ${run.ax} ${busY} ${run.ax + s * r} ${busY} L ${cx - s * r} ${busY} ` +
        `Q ${cx} ${busY} ${cx} ${busY + r} L ${cx} ${cy}`;
      links.push({ childId, parentIds: run.parents, d });
    }
  }

  const generations = new Set(Object.values(nodes).map((n) => n.y)).size;
  return { nodes, unions: unionLines, links, bounds, generations };
}
