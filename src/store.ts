import { create } from 'zustand';
import type { Relation, Tree } from './types';
import { emptyTree, sanitizeTree } from './lib/tree';

const TREE_KEY = 'kindred.tree.v1';
const THEME_KEY = 'kindred.theme';
const HISTORY_LIMIT = 100;

export type Theme = 'light' | 'dark';

export type Dialog =
  | { type: 'first' }
  | { type: 'add'; relation: Relation; anchorId: string }
  | { type: 'edit'; personId: string }
  | { type: 'delete'; personId: string }
  | { type: 'reset' }
  | { type: 'sample' }
  | { type: 'shortcuts' };

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
  dialog: Dialog | null;
  toasts: Toast[];
  view: ViewRequest;
  theme: Theme;

  /** Apply a change to the tree and record it for undo. */
  commit: (tree: Tree) => void;
  undo: () => void;
  redo: () => void;
  /** Select a person. `focus` centres them; otherwise they're only scrolled into view if hidden. */
  select: (id: string | null, focus?: boolean) => void;
  /** Pick (or clear) the person to compare the selected one with. */
  compare: (id: string | null) => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  toast: (message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void;
  dismissToast: (id: number) => void;
  fitView: () => void;
  toggleTheme: () => void;
}

function loadTree(): Tree {
  try {
    const raw = localStorage.getItem(TREE_KEY);
    if (raw) return sanitizeTree(JSON.parse(raw));
  } catch {
    /* fall through to an empty tree */
  }
  return emptyTree();
}

function loadTheme(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === 'dark' ? 'dark' : 'light';
}

let nonce = 1;
let toastId = 1;

/** True when two trees share nobody — the view needs re-fitting after swapping between them. */
const unrelated = (a: Tree, b: Tree) => !Object.keys(a.people).some((id) => b.people[id]);

/** Selection that still makes sense in `tree` (people can vanish on delete or undo). */
const surviving = (tree: Tree, s: Pick<State, 'selectedId' | 'compareId'>) => {
  const selectedId = s.selectedId && tree.people[s.selectedId] ? s.selectedId : null;
  return { selectedId, compareId: selectedId && s.compareId && tree.people[s.compareId] ? s.compareId : null };
};

export const useStore = create<State>((set, get) => ({
  tree: loadTree(),
  past: [],
  future: [],
  selectedId: null,
  compareId: null,
  dialog: null,
  toasts: [],
  view: { kind: 'fit', nonce: 0 },
  theme: loadTheme(),

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
    set({ selectedId: id, compareId: null });
    if (id) set({ view: { kind: focus ? 'focus' : 'reveal', id, nonce: nonce++ } });
  },

  compare: (id) => {
    const { selectedId } = get();
    // With nobody selected yet, a Shift+click is just a normal selection.
    if (id && !selectedId) return get().select(id);
    set({ compareId: id && id !== selectedId ? id : null });
    if (id && id !== selectedId) set({ view: { kind: 'reveal', id, nonce: nonce++ } });
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
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* theme just won't persist */
    }
    set({ theme });
  },
}));

// Autosave. Photos are stored inline, so a very large tree can hit the browser's quota.
let warnedAboutStorage = false;
useStore.subscribe((state, prev) => {
  if (state.tree === prev.tree) return;
  try {
    localStorage.setItem(TREE_KEY, JSON.stringify(state.tree));
    warnedAboutStorage = false;
  } catch {
    if (!warnedAboutStorage) {
      warnedAboutStorage = true;
      state.toast("Couldn't save — browser storage is full. Export a backup and remove some photos.", {
        tone: 'error',
      });
    }
  }
});
