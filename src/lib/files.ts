import type { Tree } from '../types';
import { cropRect, type CropView } from './crop';
import { exportOriginals, getOriginal, putOriginal } from './photoStore';
import { uid } from './tree';

/** A photo picked by the user (or a stored original), loaded and ready to crop or show. */
export interface PhotoSource {
  /** Object URL of `blob`; free it with `releasePhoto`. */
  url: string;
  blob: Blob;
  img: HTMLImageElement;
  width: number;
  height: number;
  /** Set once the photo is kept as someone's original (see `keepOriginal`). */
  originalId?: string;
}

async function fromBlob(blob: Blob): Promise<PhotoSource> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    // `load` rather than `img.decode()`, which can stall until the page next paints.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('unreadable'));
      img.src = url;
    });
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('unreadable');
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return { url, blob, img, width: img.naturalWidth, height: img.naturalHeight };
}

/** Loads an image file for cropping. Rejects with a message fit to show the user. */
export async function loadPhoto(file: File): Promise<PhotoSource> {
  const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!file.type.startsWith('image/') && !heic) throw new Error('Please choose an image file');
  try {
    return await fromBlob(file);
  } catch {
    throw new Error(
      heic ? "This browser can't open HEIC photos - try a JPEG or PNG" : "That image couldn't be read",
    );
  }
}

/** Loads someone's stored full-size photo, e.g. to adjust its crop. */
export async function loadStoredPhoto(id: string): Promise<PhotoSource> {
  const blob = await getOriginal(id);
  if (!blob) throw new Error("The full-size photo isn't saved in this browser any more");
  try {
    return { ...(await fromBlob(blob)), originalId: id };
  } catch {
    throw new Error("The full-size photo couldn't be read");
  }
}

export function releasePhoto(source: PhotoSource) {
  URL.revokeObjectURL(source.url);
}

/** Longest side of a stored original. Plenty to look at full screen, small enough to keep many. */
const ORIGINAL_MAX = 2560;
/** Files at most this big, in a format every browser shows, are kept exactly as picked. */
const KEEP_AS_IS_BYTES = 4 * 1024 * 1024;
const PORTABLE = /^image\/(jpeg|png|webp)$/;

/**
 * Stores the full-size version of a photo that is about to be saved for someone and
 * returns its id. Very large photos are scaled down first. Calling it again for the
 * same source (re-cropping) reuses the stored copy.
 */
export function keepOriginal(source: PhotoSource): string {
  if (source.originalId) return source.originalId;
  const id = uid();
  source.originalId = id;

  const { blob, width, height } = source;
  if (PORTABLE.test(blob.type) && blob.size <= KEEP_AS_IS_BYTES && Math.max(width, height) <= ORIGINAL_MAX) {
    putOriginal(id, Promise.resolve(blob));
    return id;
  }
  // Drawn now rather than later, while the image is certainly still loaded.
  const scale = Math.min(1, ORIGINAL_MAX / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // behind transparent PNGs
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.img, 0, 0, canvas.width, canvas.height);
  putOriginal(
    id,
    new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.9),
    ),
  );
  return id;
}

/** Cuts the chosen square out of a photo as a small JPEG data URL, the form photos are stored in. */
export function cropPhoto(source: PhotoSource, view: CropView, size = 192): string {
  const { x, y, size: side } = cropRect(source, view);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; // behind transparent PNGs
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source.img, x, y, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export function download(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'family-tree'
  );
}

/** Downloads the tree as JSON, with everyone's full-size photos included so nothing is lost. */
export async function downloadTreeJson(tree: Tree) {
  const ids = Object.values(tree.people)
    .map((p) => p.photoOriginal)
    .filter(Boolean);
  const originals = await exportOriginals(ids);
  const data = Object.keys(originals).length > 0 ? { ...tree, originals } : tree;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(url, `${slug(tree.name)}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ExportBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Renders the whole tree (not just what is on screen) to a PNG data URL. */
export async function renderTreePng(world: HTMLElement, box: ExportBox): Promise<string> {
  const { toPng } = await import('html-to-image');
  const margin = 80;
  const width = Math.ceil(box.width + margin * 2);
  const height = Math.ceil(box.height + margin * 2);
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
  // Bound both dimensions and total pixels. A minimum scale defeats the cap for
  // wide pedigrees and can allocate a canvas containing billions of pixels.
  const pixelRatio = Math.min(2, 8000 / Math.max(width, height), Math.sqrt(16_000_000 / (width * height)));
  return toPng(world, {
    width,
    height,
    pixelRatio,
    backgroundColor: background,
    style: { transform: `translate(${margin - box.minX}px, ${margin - box.minY}px)` },
    // Element, not HTMLElement: the highlight layer is an <svg>.
    filter: (node) => !(node instanceof Element && node.hasAttribute('data-no-export')),
  });
}

export async function downloadTreePng(world: HTMLElement, box: ExportBox, name: string) {
  // `data-exporting` switches off selection rings and highlights (see styles.css) so the
  // picture looks the same whatever happens to be selected.
  world.dataset.exporting = '';
  try {
    const dataUrl = await renderTreePng(world, box);
    download(dataUrl, `${slug(name)}.png`);
  } finally {
    delete world.dataset.exporting;
  }
}
