import { toPng } from 'html-to-image';
import type { Tree } from '../types';

/** Reads an image file and returns a small, centre-cropped square JPEG data URL. */
export function readPhoto(file: File, size = 192): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, size, size);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        img,
        (img.naturalWidth - side) / 2,
        (img.naturalHeight - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.84));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image couldn't be read"));
    };
    img.src = url;
  });
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
    filter: (node) => !(node instanceof HTMLElement && node.dataset.noExport !== undefined),
  });
}

export async function downloadTreePng(world: HTMLElement, box: ExportBox, name: string) {
  const dataUrl = await renderTreePng(world, box);
  download(dataUrl, `${slug(name)}.png`);
}
