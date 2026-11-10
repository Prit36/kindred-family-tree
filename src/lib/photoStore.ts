/**
 * Full-size originals of people's photos, kept in IndexedDB. The tree (saved to
 * localStorage, which only holds a few megabytes) keeps just the small cropped square
 * and the id of the original it came from, so originals don't count against that limit.
 *
 * Originals are immutable: a new photo gets a new id, and re-cropping keeps the old one.
 * Ones nobody refers to any more are cleared out on the next visit (`pruneOriginals`),
 * since until then undo can still bring them back.
 */

const DB_NAME = 'kindred.photos';
const STORE = 'originals';

interface Entry {
  blob: Blob;
  /** When it was stored (ms), so brand-new ones survive pruning. */
  created: number;
}

/** Originals saved during this visit, so they show up straight away and even without IndexedDB. */
const recent = new Map<string, Promise<Blob>>();

let opening: Promise<IDBDatabase> | null = null;

function database(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available');
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err: unknown) => {
    opening = null; // try again next time
    throw err;
  });
  return opening;
}

/** Runs one request in its own transaction and resolves once that transaction has committed. */
async function request<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = make(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

let onFailure: ((err: unknown) => void) | null = null;

/** Called (once per failure) when an original couldn't be written to storage. */
export function onStoreFailure(handler: (err: unknown) => void) {
  onFailure = handler;
}

/**
 * Stores an original under `id`. Takes a promise because encoding it is asynchronous,
 * and readers asking for it in the meantime should wait rather than miss it.
 */
export function putOriginal(id: string, blob: Promise<Blob>): void {
  recent.set(id, blob);
  blob
    .then((b) => request('readwrite', (s) => s.put({ blob: b, created: Date.now() } satisfies Entry, id)))
    .catch((err: unknown) => onFailure?.(err));
}

/** The original stored under `id`, or undefined if it's gone (or storage isn't available). */
export async function getOriginal(id: string): Promise<Blob | undefined> {
  const pending = recent.get(id);
  if (pending) {
    try {
      return await pending;
    } catch {
      return undefined;
    }
  }
  try {
    const entry = (await request('readonly', (s) => s.get(id))) as Entry | undefined;
    return entry?.blob instanceof Blob ? entry.blob : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Deletes originals that no one in the tree refers to. Ones stored in the last hour are
 * left alone: another tab may be in the middle of using them.
 */
export async function pruneOriginals(keep: Set<string>): Promise<void> {
  const cutoff = Date.now() - 60 * 60 * 1000;
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const cursorReq = tx.objectStore(STORE).openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const id = String(cursor.key);
        const entry = cursor.value as Partial<Entry> | undefined;
        if (!keep.has(id) && !recent.has(id) && (entry?.created ?? 0) < cutoff) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    /* tidying up is best-effort */
  }
}

/** Ids look like the ones `uid()` makes; anything else in an imported file is ignored. */
export const isOriginalId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9]{6,40}$/.test(id);

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The originals behind `ids` as data URLs, for putting in a backup file. Missing ones are skipped. */
export async function exportOriginals(ids: Iterable<string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of new Set(ids)) {
    const blob = await getOriginal(id);
    if (blob) out[id] = await blobToDataUrl(blob);
  }
  return out;
}

/** Stores the originals found in a backup file (a map of id → image data URL). */
export async function importOriginals(raw: unknown, wanted: Set<string>): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!wanted.has(id) || !isOriginalId(id) || typeof value !== 'string' || !value.startsWith('data:image/')) continue;
    try {
      // A data: URL is decoded locally; nothing goes over the network.
      const blob = await (await fetch(value)).blob();
      putOriginal(id, Promise.resolve(blob));
    } catch {
      /* a damaged image just won't have its full-size version */
    }
  }
}
