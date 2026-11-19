import { create } from 'zustand';
import type { Person, Relation, Tree } from './types';
import type { CropView } from './lib/crop';
import type { PhotoSource } from './lib/files';
import {
  NOTHING_COLLAPSED,
  focusSet,
  pruneCollapsed,
  unfoldTo,
  visibleIds,
  type Collapsed,
  type Focus,
  type FocusScope,
} from './lib/branches';
import { focusTitle } from './lib/sides';
import { familyLines } from './lib/lines';
import { swapLine } from './lib/canvasHandle';
import type { Naming } from './lib/naming';
import { emptyTree, indexOf, shortName } from './lib/tree';
import { NO_SPELLINGS, setNameScriptSource } from './lib/gujaratiNames';
import { onSaveResult, requestPersistence, saveTree } from './lib/treeStore';

const VIEW_KEY = 'kindred.view.v1';
const THEME_KEY = 'kindred.theme';
const HISTORY_LIMIT = 100;

export type Theme = 'light' | 'dark';
/** The family as a tree, everyone's lifetimes on a time axis, one person's descendants as a fan, or everyone as collectible cards. */
export type ViewMode = 'tree' | 'timeline' | 'fan' | 'cards';

const MODE_KEY = 'kindred.mode';
const SIDES_KEY = 'kindred.sides';
const NAMING_KEY = 'kindred.naming';
const FAN_KEY = 'kindred.fan';
const LINES_KEY = 'kindred.lines';
/** How many families back the trail goes. */
const TRAIL_MAX = 6;

/** One family visited: which family line (lib/lines.ts), and whose bridge led there. */
export interface LineStop {
  line: string;
  via: string;
}

/**
 * The tree shown one family at a time: whether it is, and the families visited, in
 * order - the last is the one on show.
 */
export interface Lines {
  on: boolean;
  trail: LineStop[];
}

function loadLinesOn(): boolean {
  try {
    return localStorage.getItem(LINES_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveLinesOn(on: boolean) {
  try {
    localStorage.setItem(LINES_KEY, on ? 'on' : 'off');
  } catch {
    /* the choice just won't persist */
  }
}

/** Where a trail starts: the family "me" is drawn in, or the first person's. */
function homeStop(tree: Tree): LineStop | null {
  const start = tree.homeId && tree.people[tree.homeId] ? tree.homeId : Object.keys(tree.people)[0];
  return start ? { line: familyLines(tree).lineOf.get(start)!, via: start } : null;
}

/**
 * The family on show: the last one in the trail still in the tree, else "me"'s. Null when
 * the whole tree is shown (or it's empty).
 */
export function shownLine(tree: Tree, lines: Lines): string | null {
  if (!lines.on) return null;
  const known = familyLines(tree).members;
  for (let i = lines.trail.length - 1; i >= 0; i--) if (known.has(lines.trail[i].line)) return lines.trail[i].line;
  return homeStop(tree)?.line ?? null;
}

/** The families visited, still in the tree, starting from "me"'s if nothing else is left. */
export function trailOf(tree: Tree, lines: Lines): LineStop[] {
  const known = familyLines(tree).members;
  const trail = lines.trail.filter((s) => known.has(s.line));
  const home = homeStop(tree);
  return trail.length || !home ? trail : [home];
}

/** The trail after going to a family: back along it if it was visited, else on to it. */
function trailTo(tree: Tree, lines: Lines, stop: LineStop): LineStop[] {
  const trail = trailOf(tree, lines);
  const at = trail.findIndex((s) => s.line === stop.line);
  return at >= 0 ? trail.slice(0, at + 1) : [...trail, stop].slice(-TRAIL_MAX);
}

/** Whose descendants the fan shows, whether it follows only the sons' line, and whether husbands and wives are named. */
export interface FanPrefs {
  rootId: string | null;
  sonsOnly: boolean;
  spouses: boolean;
}

function loadFanPrefs(): FanPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FAN_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const { rootId, sonsOnly, spouses } = raw as Partial<FanPrefs>;
      return { rootId: typeof rootId === 'string' ? rootId : null, sonsOnly: sonsOnly === true, spouses: spouses !== false };
    }
  } catch {
    /* defaults */
  }
  return { rootId: null, sonsOnly: false, spouses: true };
}

function loadNaming(): Naming {
  try {
    const v = localStorage.getItem(NAMING_KEY);
    return v === 'gu' || v === 'gu-latn' ? v : 'en';
  } catch {
    return 'en';
  }
}

/** Whether cards are coloured by side of the family, and whether the list of sides is open. */
interface SidesPrefs {
  colour: boolean;
  open: boolean;
}

function loadSidesPrefs(): SidesPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SIDES_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const { colour, open } = raw as Partial<SidesPrefs>;
      return { colour: colour === true, open: open === true };
    }
  } catch {
    /* defaults */
  }
  // Off by default: the list of sides and the colour tints are opt-in.
  return { colour: false, open: false };
}

function loadMode(): ViewMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'timeline' || v === 'fan' || v === 'cards' ? v : 'tree';
  } catch {
    return 'tree';
  }
}

export type Dialog =
  | { type: 'first' }
  | { type: 'add'; relation: Relation; anchorId: string }
  | { type: 'edit'; personId: string }
  | { type: 'delete'; personId: string }
  | { type: 'reset' }
  | { type: 'sample' }
  | { type: 'shortcuts' }
  /** Cropping a newly picked photo (or re-cropping the original) for someone, outside the edit dialog. */
  | { type: 'photo'; personId: string; source: PhotoSource; view?: CropView }
  /** Someone's photo shown full size. */
  | { type: 'viewPhoto'; personId: string }
  /** Upcoming birthdays and anniversaries, and possible mistakes in the data. */
  | { type: 'insights'; tab: InsightsTab };

export type InsightsTab = 'upcoming' | 'family' | 'checks';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface ViewRequest {
  /** `line`: another family was just shown - all of it in view if it can be read that way, else `id` */
  kind: 'fit' | 'focus' | 'reveal' | 'line';
  id?: string;
  nonce: number;
}

/**
 * One step of undo history: how to get a tree back from the tree beside it in the history.
 * Only what differs is kept, not a copy of everyone - on a tree of thousands each step
 * would otherwise hold its own table of every person.
 */
interface Patch {
  /** The people who differ, as they are in the tree this gives back; null where they aren't in it. */
  people: Map<string, Person | null>;
  /** Everyone's ids in order, when people were added, removed or reordered (the layout reads that order). */
  order: string[] | null;
  /** The rest of that tree, which is small and shares its unions array with its neighbours. */
  rest: Omit<Tree, 'people'>;
}

/** The patch that turns `from` back into `to`. */
function diff(from: Tree, to: Tree): Patch {
  const people = new Map<string, Person | null>();
  const toIds = Object.keys(to.people);
  const fromIds = Object.keys(from.people);
  let sameOrder = toIds.length === fromIds.length;
  for (let i = 0; i < toIds.length; i++) {
    const id = toIds[i];
    if (from.people[id] !== to.people[id]) people.set(id, to.people[id]);
    if (sameOrder && fromIds[i] !== id) sameOrder = false;
  }
  if (!sameOrder) for (const id of fromIds) if (!(id in to.people)) people.set(id, null);
  const { people: _people, ...rest } = to;
  return { people, order: sameOrder ? null : toIds, rest };
}

function applyPatch(base: Tree, patch: Patch): Tree {
  let people: Tree['people'];
  if (patch.order) {
    people = {};
    for (const id of patch.order) people[id] = patch.people.has(id) ? patch.people.get(id)! : base.people[id];
  } else {
    people = { ...base.people };
    for (const [id, p] of patch.people) people[id] = p!;
  }
  return { ...patch.rest, people };
}

interface State {
  tree: Tree;
  /** Undo steps, oldest first: each gives back the tree before the one after it. */
  past: Patch[];
  /** Redo steps, next first. */
  future: Patch[];
  selectedId: string | null;
  /** A second person picked (Shift+click) to see how they're related to the selected one. */
  compareId: string | null;
  /** The part of the tree shown on its own (someone's line, family or close family), or null for the whole tree. */
  focus: Focus | null;
  /** A part of the tree to highlight for a moment, dimming everyone else (hovering a side in the list). */
  peek: Focus | null;
  /** Colour cards by side of the family, and show the list of sides. */
  sides: SidesPrefs;
  /** Branches folded away at a connector (see lib/branches.ts). Ignored while focused or shown a family at a time. */
  collapsed: Collapsed;
  /** The tree shown one family at a time, unless a focus is set. */
  lines: Lines;
  dialog: Dialog | null;
  toasts: Toast[];
  view: ViewRequest;
  theme: Theme;
  mode: ViewMode;
  /** The words relationships are named in: English, or Gujarati in its own script or in Latin letters. */
  naming: Naming;
  /** The descendants fan: whose family it shows. */
  fan: FanPrefs;
  /** The year the Descendants and Timeline views are turned back to, or null for today. */
  era: number | null;

  /** Apply a change to the tree and record it for undo. */
  commit: (tree: Tree) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Select a person. `focus` centres them; otherwise they're only scrolled into view if
   * off screen. Someone folded away or outside the focused branch is brought back first.
   */
  select: (id: string | null, focus?: boolean) => void;
  /** Pick (or clear) the person to compare the selected one with. */
  compare: (id: string | null) => void;
  /** Show only part of the tree around this person (their direct line by default). */
  focusOn: (id: string, scope?: FocusScope) => void;
  setPeek: (peek: Focus | null) => void;
  setSides: (prefs: Partial<SidesPrefs>) => void;
  clearFocus: () => void;
  /** Fold or unfold a branch by its key. */
  toggleCollapse: (key: string) => void;
  /** Leave focus and unfold everything. */
  showAll: () => void;
  /** Show one family line, reached through `via` (who stays in place on screen). */
  showLine: (line: string, via: string) => void;
  /** Show the tree one family at a time, or the whole of it. */
  setLines: (on: boolean) => void;
  /** Back to "me": their family, with them selected. */
  goHome: () => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  toast: (message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void;
  dismissToast: (id: number) => void;
  fitView: () => void;
  toggleTheme: () => void;
  setMode: (mode: ViewMode) => void;
  setNaming: (naming: Naming) => void;
  setFan: (prefs: Partial<FanPrefs>) => void;
  setEra: (year: number | null) => void;
}

/** Folds are remembered between visits, as long as they still belong to this tree. */
function loadCollapsed(tree: Tree): Collapsed {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const { homeId, collapsed } = raw as { homeId?: unknown; collapsed?: unknown };
      if (homeId === tree.homeId && Array.isArray(collapsed)) {
        return pruneCollapsed(tree, new Set(collapsed.filter((k): k is string => typeof k === 'string')));
      }
    }
  } catch {
    /* start with everything unfolded */
  }
  return NOTHING_COLLAPSED;
}

function loadTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' ? 'dark' : 'light';
}

let nonce = 1;
let toastId = 1;

/** True when two trees share nobody - the view needs re-fitting after swapping between them. */
const unrelated = (a: Tree, b: Tree) => !Object.keys(a.people).some((id) => b.people[id]);

type ViewState = Pick<State, 'selectedId' | 'compareId' | 'focus' | 'collapsed' | 'lines'>;

/** Everyone on the canvas in this view. */
const onScreen = (tree: Tree, s: ViewState) => visibleIds(tree, s.focus, s.collapsed, shownLine(tree, s.lines));

/** Only people who are on the canvas can stay selected. */
const onCanvas = (tree: Tree, s: ViewState): ViewState => {
  const visible = onScreen(tree, s);
  const selectedId = s.selectedId && visible.has(s.selectedId) ? s.selectedId : null;
  const compareId = selectedId && s.compareId && visible.has(s.compareId) ? s.compareId : null;
  return { selectedId, compareId, focus: s.focus, collapsed: s.collapsed, lines: s.lines };
};

/** View state that still makes sense in `tree` (people can vanish on delete or undo). */
const surviving = (tree: Tree, s: ViewState & Pick<State, 'tree'>): ViewState =>
  onCanvas(tree, {
    selectedId: s.selectedId,
    compareId: s.compareId,
    focus: s.focus && tree.people[s.focus.id] ? s.focus : null,
    // Which side of a fold is hidden depends on who "me" is, so a new home person starts afresh.
    collapsed: tree.homeId === s.tree.homeId ? pruneCollapsed(tree, s.collapsed) : NOTHING_COLLAPSED,
    lines: s.lines,
  });

// The saved tree is loaded asynchronously (see lib/treeStore.ts) and put in place by
// `hydrate` before the app first renders.
const initialTree = emptyTree();

export const useStore = create<State>((set, get) => ({
  tree: initialTree,
  past: [],
  future: [],
  selectedId: null,
  compareId: null,
  focus: null,
  peek: null,
  sides: loadSidesPrefs(),
  collapsed: loadCollapsed(initialTree),
  lines: { on: loadLinesOn(), trail: [] },
  dialog: null,
  toasts: [],
  view: { kind: 'fit', nonce: 0 },
  theme: loadTheme(),
  mode: loadMode(),
  naming: loadNaming(),
  fan: loadFanPrefs(),
  era: null,

  commit: (tree) => {
    const { tree: current, past } = get();
    if (tree === current) return;
    set({
      tree,
      past: [...past.slice(-HISTORY_LIMIT + 1), diff(tree, current)],
      future: [],
      ...surviving(tree, get()),
    });
  },

  undo: () => {
    const { tree, past, future } = get();
    if (past.length === 0) return;
    const prev = applyPatch(tree, past[past.length - 1]);
    set({
      tree: prev,
      past: past.slice(0, -1),
      future: [diff(prev, tree), ...future],
      ...surviving(prev, get()),
    });
    if (unrelated(tree, prev)) get().fitView();
  },

  redo: () => {
    const { tree, past, future } = get();
    if (future.length === 0) return;
    const next = applyPatch(tree, future[0]);
    set({
      tree: next,
      past: [...past, diff(next, tree)],
      future: future.slice(1),
      ...surviving(next, get()),
    });
    if (unrelated(tree, next)) get().fitView();
  },

  select: (id, center = false) => {
    const { tree, toast } = get();
    let { focus, collapsed, lines } = get();
    let moved: string | null = null;
    if (id && tree.people[id] && !onScreen(tree, get()).has(id)) {
      if (focus) {
        // Say why the view just changed.
        const where = lines.on ? '' : ' - showing the whole tree again';
        toast(`${shortName(tree.people[id])} isn't part of ${focusTitle(tree, focus)}${where}`);
        focus = null;
      }
      const line = shownLine(tree, lines);
      if (line) {
        // Someone from another family: that family is shown instead.
        const theirs = familyLines(tree).lineOf.get(id)!;
        if (theirs !== line) {
          lines = { on: true, trail: trailTo(tree, lines, { line: theirs, via: id }) };
          moved = theirs;
        }
      } else if (!visibleIds(tree, null, collapsed).has(id)) {
        collapsed = unfoldTo(tree, collapsed, id);
      }
    }
    const apply = () => {
      set({ selectedId: id, compareId: null, focus, collapsed, lines });
      if (id) set({ view: { kind: moved ? 'line' : center ? 'focus' : 'reveal', id, nonce: nonce++ } });
    };
    if (moved) swapLine(moved, apply);
    else apply();
  },

  compare: (id) => {
    const { selectedId } = get();
    // With nobody selected yet, a Shift+click is just a normal selection.
    if (id && !selectedId) return get().select(id);
    set({ compareId: id && id !== selectedId ? id : null });
    if (id && id !== selectedId) set({ view: { kind: 'reveal', id, nonce: nonce++ } });
  },

  focusOn: (id, scope = 'line') => {
    const { tree, toast } = get();
    const person = tree.people[id];
    if (!person) return;
    const focus: Focus = { id, scope };
    const branch = focusSet(tree, focus);
    if (branch.size === Object.keys(tree.people).length) {
      toast(`Everyone in the tree is already part of ${focusTitle(tree, focus)}`);
      return;
    }
    const { selectedId, compareId, collapsed, lines } = get();
    set({
      ...onCanvas(tree, { selectedId: selectedId && branch.has(selectedId) ? selectedId : null, compareId, focus, collapsed, lines }),
      peek: null,
      view: { kind: 'fit', nonce: nonce++ },
    });
  },

  setPeek: (peek) => set({ peek }),

  setSides: (prefs) => {
    const sides = { ...get().sides, ...prefs };
    try {
      localStorage.setItem(SIDES_KEY, JSON.stringify(sides));
    } catch {
      /* the choice just won't persist */
    }
    set({ sides });
  },

  clearFocus: () => {
    const { tree, selectedId, collapsed, focus, lines } = get();
    if (!focus) return;
    // Whoever is selected stays on screen, even if that means opening a fold - or, a
    // family at a time, showing theirs.
    const selected = selectedId && tree.people[selectedId] ? selectedId : null;
    const line = shownLine(tree, lines);
    if (line) {
      const theirs = selected ? familyLines(tree).lineOf.get(selected)! : line;
      const via = selected ?? focus.id;
      const next: Lines = theirs === line ? lines : { on: true, trail: trailTo(tree, lines, { line: theirs, via }) };
      set({
        ...onCanvas(tree, { ...get(), focus: null, lines: next }),
        view: { kind: 'line', id: via, nonce: nonce++ },
      });
      return;
    }
    const keep = selected ? unfoldTo(tree, collapsed, selected) : collapsed;
    set(onCanvas(tree, { ...get(), focus: null, collapsed: keep }));
  },

  toggleCollapse: (key) => {
    const { tree } = get();
    const collapsed = new Set(get().collapsed);
    if (!collapsed.delete(key)) collapsed.add(key);
    set(onCanvas(tree, { ...get(), collapsed: collapsed.size ? collapsed : NOTHING_COLLAPSED }));
  },

  showAll: () => set({ focus: null, collapsed: NOTHING_COLLAPSED }),

  showLine: (line, via) => {
    const { tree, lines } = get();
    if (!familyLines(tree).members.has(line)) return;
    const next: Lines = { on: true, trail: trailTo(tree, lines, { line, via }) };
    if (!lines.on) saveLinesOn(true);
    swapLine(line, () =>
      set({
        ...onCanvas(tree, { ...get(), focus: null, lines: next }),
        peek: null,
        view: { kind: 'line', id: via, nonce: nonce++ },
      }),
    );
  },

  setLines: (on) => {
    const { tree, lines, selectedId } = get();
    if (on === lines.on) return;
    saveLinesOn(on);
    // Turned on with someone selected, it starts from their family.
    const selected = selectedId && tree.people[selectedId] ? selectedId : null;
    const trail = on && selected ? [{ line: familyLines(tree).lineOf.get(selected)!, via: selected }] : lines.trail;
    const next: Lines = { on, trail };
    // Whoever is in the middle of the view stays there while everyone else moves round them.
    const id = selected ?? trailOf(tree, next).at(-1)?.via ?? null;
    set({
      ...onCanvas(tree, { ...get(), focus: null, lines: next }),
      view: id ? { kind: on ? 'line' : 'reveal', id, nonce: nonce++ } : get().view,
    });
  },

  goHome: () => {
    const { tree, lines } = get();
    const home = tree.homeId && tree.people[tree.homeId] ? tree.homeId : null;
    if (!home) return;
    const go = () => {
      if (lines.on) set({ lines: { on: true, trail: [] } });
      get().select(home, true);
    };
    // Back to "me"'s family from another one is a move between families like any other.
    const theirs = familyLines(tree).lineOf.get(home)!;
    if (lines.on && !get().focus && shownLine(tree, lines) !== theirs) swapLine(theirs, go);
    else go();
  },

  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  toast: (message, opts) => {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-2), { id, message, tone: opts?.tone ?? 'info', action: opts?.action }] });
    window.setTimeout(() => get().dismissToast(id), opts?.action ? 7000 : 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  fitView: () => set({ view: { kind: 'fit', nonce: nonce++ } }),

  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'dark' ? '#15130f' : '#f5f1e8',
    );
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* theme just won't persist */
    }
    set({ theme });
  },

  setMode: (mode) => {
    if (mode === get().mode) return;
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* the view just won't persist */
    }
    // Whoever is selected stays in sight in the view being switched to.
    const { selectedId, tree } = get();
    // Opening the descendants fan with someone selected who has children shows their family.
    if (mode === 'fan' && selectedId && tree.people[selectedId]) {
      const hasChildren = Boolean(indexOf(tree).children.get(selectedId)?.length);
      if (hasChildren && get().fan.rootId !== selectedId) get().setFan({ rootId: selectedId });
    }
    set({ mode, view: selectedId ? { kind: 'reveal', id: selectedId, nonce: nonce++ } : get().view });
  },

  setFan: (prefs) => {
    const fan = { ...get().fan, ...prefs };
    try {
      localStorage.setItem(FAN_KEY, JSON.stringify(fan));
    } catch {
      /* the choice just won't persist */
    }
    set({ fan });
  },

  setEra: (year) => {
    if (year !== get().era) set({ era: year });
  },

  setNaming: (naming) => {
    try {
      localStorage.setItem(NAMING_KEY, naming);
    } catch {
      /* the choice just won't persist */
    }
    set({ naming });
  },
}));

// People's names are written in Gujarati along with everything else when ગુજરાતી is chosen.
setNameScriptSource(() => {
  const { naming, tree } = useStore.getState();
  return { gujarati: naming === 'gu', spellings: tree.spellings ?? NO_SPELLINGS };
});

// Remember which branches are folded.
useStore.subscribe((state, prev) => {
  if (state.collapsed === prev.collapsed && state.tree.homeId === prev.tree.homeId) return;
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ homeId: state.tree.homeId, collapsed: [...state.collapsed] }));
  } catch {
    /* folds just won't persist */
  }
});

let hydrated = false;

/** Puts the tree loaded from storage in place. Called once, before the first render. */
export function hydrate(tree: Tree) {
  useStore.setState({ tree, collapsed: loadCollapsed(tree), lines: { on: useStore.getState().lines.on, trail: [] } });
  hydrated = true;
  if (Object.keys(tree.people).length > 0) requestPersistence();
}

// Autosave, to IndexedDB (lib/treeStore.ts). Cropped photos are stored inline in the tree.
let warnedAboutStorage = false;
onSaveResult((ok) => {
  if (ok) {
    warnedAboutStorage = false;
  } else if (!warnedAboutStorage) {
    warnedAboutStorage = true;
    useStore.getState().toast("Couldn't save - browser storage is full. Export a backup and remove some photos.", {
      tone: 'error',
    });
  }
});
useStore.subscribe((state, prev) => {
  if (!hydrated || state.tree === prev.tree) return;
  saveTree(state.tree);
  if (Object.keys(state.tree.people).length > 0) requestPersistence();
});
