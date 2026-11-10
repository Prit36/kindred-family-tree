import type { Tree } from '../types';
import { emptyTree, sanitizeTree } from './tree';

/**
 * Where the tree is saved between visits. It lives in IndexedDB, which can hold far more
 * than the few megabytes localStorage allows (every cropped photo is stored inline in the
 * tree). Trees saved to localStorage by earlier versions are moved over on first load.
 * If IndexedDB isn't available at all, localStorage is used as before.
 */

const DB_NAME = 'kindred.data';
const STORE = 'trees';
const KEY = 'current';
/** Where earlier versions kept the tree. */
const LEGACY_KEY = 'kindred.tree.v1';

interface Saved {
  tree: Tree;
  savedAt: number;
}

let backend: 'idb' | 'local' = 'idb';
let db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db!.transaction(STORE, mode);
    const req = make(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

function readLegacy(): Tree | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? sanitizeTree(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Loads the saved tree (an empty one if there is none). Never rejects. */
export async function loadTree(): Promise<Tree> {
  try {
    db = await openDb();
  } catch {
    backend = 'local';
    return readLegacy() ?? emptyTree();
  }
  try {
    const saved = (await run('readonly', (s) => s.get(KEY))) as Saved | undefined;
    if (saved?.tree) return sanitizeTree(saved.tree);
  } catch {
    /* unreadable: fall back to whatever localStorage has */
  }
  const legacy = readLegacy();
  if (!legacy) return emptyTree();
  // Move it over. The old copy is only removed once the new one is safely written.
  try {
    await run('readwrite', (s) => s.put({ tree: legacy, savedAt: Date.now() } satisfies Saved, KEY));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    backend = 'local';
  }
  return legacy;
}

let listener: ((ok: boolean) => void) | null = null;

/** Told after each save whether it worked, e.g. to warn that storage is full. */
export function onSaveResult(handler: (ok: boolean) => void) {
  listener = handler;
}

let pending: Tree | null = null;
let writing = false;

async function write(tree: Tree) {
  if (backend === 'local') localStorage.setItem(LEGACY_KEY, JSON.stringify(tree));
  else await run('readwrite', (s) => s.put({ tree, savedAt: Date.now() } satisfies Saved, KEY));
}

/**
 * Saves the tree. Writes happen one at a time; if several changes arrive while one is
 * being written, only the latest is written next.
 */
export function saveTree(tree: Tree) {
  pending = tree;
  if (writing) return;
  writing = true;
  void (async () => {
    while (pending) {
      const next = pending;
      pending = null;
      try {
        await write(next);
        listener?.(true);
      } catch {
        listener?.(false);
      }
    }
    writing = false;
  })();
}

let askedToPersist = false;

/**
 * Asks the browser not to clear this site's storage when the disk runs low. Chrome and
 * Edge decide quietly; Firefox may ask the user, so this is only called once there is a
 * tree worth keeping.
 */
export function requestPersistence() {
  if (askedToPersist) return;
  askedToPersist = true;
  const storage = navigator.storage;
  if (!storage?.persist || !storage.persisted) return;
  void storage
    .persisted()
    .then((already) => (already ? true : storage.persist()))
    .catch(() => false);
}
