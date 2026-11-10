import { toPng } from 'html-to-image';
import type { Tree } from '../types';
import { cropRect, type CropView } from './crop';

/** A photo picked by the user, loaded and ready to crop. */
export interface PhotoSource {
  /** Object URL of the original file; free it with `releasePhoto`. */
  url: string;
  img: HTMLImageElement;
  width: number;
  height: number;
}

/** Loads an image file for cropping. Rejects with a message fit to show the user. */
export async function loadPhoto(file: File): Promise<PhotoSource> {
  const heic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!file.type.startsWith('image/') && !heic) throw new Error('Please choose an image file');
  const url = URL.createObjectURL(file);
  const img = new Image();
  try {
    // `load` rather than `img.decode()`, which can stall until the page next paints.
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('unreadable'));
      img.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      heic ? "This browser can't open HEIC photos — try a JPEG or PNG" : "That image couldn't be read",
    );
  }
  if (!img.naturalWidth || !img.naturalHeight) {
    URL.revokeObjectURL(url);
    throw new Error("That image couldn't be read");
  }
  return { url, img, width: img.naturalWidth, height: img.naturalHeight };
}

export function releasePhoto(source: PhotoSource) {
  URL.revokeObjectURL(source.url);
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

function download(href: string, filename: string) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'family-tree'
  );
}

export function downloadTreeJson(tree: Tree) {
  const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
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
export function renderTreePng(world: HTMLElement, box: ExportBox): Promise<string> {
  const margin = 80;
  const width = Math.ceil(box.width + margin * 2);
  const height = Math.ceil(box.height + margin * 2);
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff';
  const pixelRatio = Math.max(0.5, Math.min(2, 8000 / Math.max(width, height)));
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
