import { create } from 'zustand';
import type { Relation, Tree } from './types';
import type { CropView } from './lib/crop';
import type { PhotoSource } from './lib/files';
import { NOTHING_COLLAPSED, branchOf, pruneCollapsed, unfoldTo, visibleIds, type Collapsed } from './lib/branches';
import { emptyTree, shortName } from './lib/tree';
import { onSaveResult, requestPersistence, saveTree } from './lib/treeStore';

const VIEW_KEY = 'kindred.view.v1';
const THEME_KEY = 'kindred.theme';
const HISTORY_LIMIT = 100;

export type Theme = 'light' | 'dark';
/** The family as a tree, or everyone's lifetimes on a time axis. */
export type ViewMode = 'tree' | 'timeline';

const MODE_KEY = 'kindred.mode';

function loadMode(): ViewMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'timeline' ? 'timeline' : 'tree';
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

export type InsightsTab = 'upcoming' | 'checks';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
}

export interface ViewRequest {
  kind: 'fit' | 'focus' | 'reveal';
  id?: string;
  nonce: number;
}

interface State {
  tree: Tree;
  past: Tree[];
  future: Tree[];
  selectedId: string | null;
  /** A second person picked (Shift+click) to see how they're related to the selected one. */
  compareId: string | null;
  /** The person whose branch is shown on its own, or null for the whole tree. */
  focusId: string | null;
  /** Branches folded away at a connector (see lib/branches.ts). Ignored while focused. */
  collapsed: Collapsed;
  dialog: Dialog | null;
  toasts: Toast[];
  view: ViewRequest;
  theme: Theme;
  mode: ViewMode;

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
  /** Show only this person's branch: ancestors, descendants and immediate family. */
  focusOn: (id: string) => void;
  clearFocus: () => void;
  /** Fold or unfold a branch by its key. */
  toggleCollapse: (key: string) => void;
  /** Leave focus and unfold everything. */
  showAll: () => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  toast: (message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void;
  dismissToast: (id: number) => void;
  fitView: () => void;
  toggleTheme: () => void;
  setMode: (mode: ViewMode) => void;
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

type ViewState = Pick<State, 'selectedId' | 'compareId' | 'focusId' | 'collapsed'>;

/** Only people who are on the canvas can stay selected. */
const onCanvas = (tree: Tree, s: ViewState): ViewState => {
  const visible = visibleIds(tree, s.focusId, s.collapsed);
  const selectedId = s.selectedId && visible.has(s.selectedId) ? s.selectedId : null;
  const compareId = selectedId && s.compareId && visible.has(s.compareId) ? s.compareId : null;
  return { selectedId, compareId, focusId: s.focusId, collapsed: s.collapsed };
};

/** View state that still makes sense in `tree` (people can vanish on delete or undo). */
const surviving = (tree: Tree, s: ViewState & Pick<State, 'tree'>): ViewState =>
  onCanvas(tree, {
    selectedId: s.selectedId,
    compareId: s.compareId,
    focusId: s.focusId && tree.people[s.focusId] ? s.focusId : null,
    // Which side of a fold is hidden depends on who "me" is, so a new home person starts afresh.
    collapsed: tree.homeId === s.tree.homeId ? pruneCollapsed(tree, s.collapsed) : NOTHING_COLLAPSED,
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
  focusId: null,
  collapsed: loadCollapsed(initialTree),
  dialog: null,
  toasts: [],
  view: { kind: 'fit', nonce: 0 },
  theme: loadTheme(),
  mode: loadMode(),

  commit: (tree) => {
    const { tree: current, past } = get();
    if (tree === current) return;
    set({
      tree,
      past: [...past.slice(-HISTORY_LIMIT + 1), current],
      future: [],
      ...surviving(tree, get()),
    });
  },

  undo: () => {
    const { tree, past, future } = get();
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      tree: prev,
      past: past.slice(0, -1),
      future: [tree, ...future],
      ...surviving(prev, get()),
    });
    if (unrelated(tree, prev)) get().fitView();
  },

  redo: () => {
    const { tree, past, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      tree: next,
      past: [...past, tree],
      future: future.slice(1),
      ...surviving(next, get()),
    });
    if (unrelated(tree, next)) get().fitView();
  },

  select: (id, focus = false) => {
    const { tree, toast } = get();
    let { focusId, collapsed } = get();
    if (id && tree.people[id] && !visibleIds(tree, focusId, collapsed).has(id)) {
      if (focusId) {
        // Say why the view just changed.
        toast(`${shortName(tree.people[id])} isn't in ${shortName(tree.people[focusId])}'s branch - showing the whole tree again`);
        focusId = null;
      }
      if (!visibleIds(tree, null, collapsed).has(id)) collapsed = unfoldTo(tree, collapsed, id);
    }
    set({ selectedId: id, compareId: null, focusId, collapsed });
    if (id) set({ view: { kind: focus ? 'focus' : 'reveal', id, nonce: nonce++ } });
  },

  compare: (id) => {
    const { selectedId } = get();
    // With nobody selected yet, a Shift+click is just a normal selection.
    if (id && !selectedId) return get().select(id);
    set({ compareId: id && id !== selectedId ? id : null });
    if (id && id !== selectedId) set({ view: { kind: 'reveal', id, nonce: nonce++ } });
  },

  focusOn: (id) => {
    const { tree, toast } = get();
    const person = tree.people[id];
    if (!person) return;
    const branch = branchOf(tree, id);
    if (branch.size === Object.keys(tree.people).length) {
      toast(`Everyone in the tree is already part of ${shortName(person)}'s branch`);
      return;
    }
    const { selectedId, compareId, collapsed } = get();
    set({
      ...onCanvas(tree, { selectedId: selectedId && branch.has(selectedId) ? selectedId : id, compareId, focusId: id, collapsed }),
      view: { kind: 'fit', nonce: nonce++ },
    });
  },

  clearFocus: () => {
    const { tree, selectedId, collapsed, focusId } = get();
    if (!focusId) return;
    // Whoever is selected stays on screen, even if that means opening a fold.
    const keep = selectedId && tree.people[selectedId] ? unfoldTo(tree, collapsed, selectedId) : collapsed;
    set(onCanvas(tree, { ...get(), focusId: null, collapsed: keep }));
  },

  toggleCollapse: (key) => {
    const { tree } = get();
    const collapsed = new Set(get().collapsed);
    if (!collapsed.delete(key)) collapsed.add(key);
    set(onCanvas(tree, { ...get(), collapsed: collapsed.size ? collapsed : NOTHING_COLLAPSED }));
  },

  showAll: () => set({ focusId: null, collapsed: NOTHING_COLLAPSED }),

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
    const { selectedId } = get();
    set({ mode, view: selectedId ? { kind: 'reveal', id: selectedId, nonce: nonce++ } : get().view });
  },
}));

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
  useStore.setState({ tree, collapsed: loadCollapsed(tree) });
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
