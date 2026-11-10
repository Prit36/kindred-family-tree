/**
 * The geometry behind the photo cropper. A crop is a square of the original image,
 * described by its centre (in image pixels) and a zoom: at zoom 1 the square spans the
 * image's short side, at zoom 2 half of it, and so on. Positions passed to `panBy` and
 * `zoomAt` are fractions of the on-screen crop circle's diameter, so this file never
 * needs to know how big anything is drawn.
 */

export interface ImageSize {
  width: number;
  height: number;
}

export interface CropView {
  /** Centre of the crop, in image pixels. */
  cx: number;
  cy: number;
  /** 1 = the crop spans the image's short side. */
  zoom: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How far in you can zoom: until the crop is about 100 px of the original, but always 3× and never past 10×. */
export function maxZoom(img: ImageSize): number {
  return clamp(Math.min(img.width, img.height) / 100, 3, 10);
}

/** Side of the square crop, in image pixels. */
export function cropSide(img: ImageSize, zoom: number): number {
  return Math.min(img.width, img.height) / zoom;
}

/** Keeps the zoom in range and the crop entirely inside the image. */
export function clampView(img: ImageSize, view: CropView): CropView {
  const zoom = clamp(view.zoom, 1, maxZoom(img));
  const half = cropSide(img, zoom) / 2;
  return {
    zoom,
    cx: clamp(view.cx, half, img.width - half),
    cy: clamp(view.cy, half, img.height - half),
  };
}

/**
 * Where a new photo starts: as large as possible, centred. In a portrait shot the face
 * is nearly always in the upper part, so the crop is nudged up a little there.
 */
export function initialView(img: ImageSize): CropView {
  const portrait = img.height > img.width * 1.05;
  return clampView(img, { zoom: 1, cx: img.width / 2, cy: portrait ? img.height * 0.4 : img.height / 2 });
}

/** Moves the photo by (fx, fy) crop-diameters, the way dragging it does. */
export function panBy(img: ImageSize, view: CropView, fx: number, fy: number): CropView {
  const side = cropSide(img, view.zoom);
  return clampView(img, { ...view, cx: view.cx - fx * side, cy: view.cy - fy * side });
}

/**
 * Zooms to `zoom`, keeping the point (fx, fy) — measured from the crop's centre in
 * crop-diameters — fixed under the cursor or fingers.
 */
export function zoomAt(img: ImageSize, view: CropView, zoom: number, fx = 0, fy = 0): CropView {
  const next = clamp(zoom, 1, maxZoom(img));
  const before = cropSide(img, view.zoom);
  const after = cropSide(img, next);
  return clampView(img, {
    zoom: next,
    cx: view.cx + fx * (before - after),
    cy: view.cy + fy * (before - after),
  });
}

/** The square of the original image that a view keeps. */
export function cropRect(img: ImageSize, view: CropView): { x: number; y: number; size: number } {
  const size = cropSide(img, view.zoom);
  return { x: view.cx - size / 2, y: view.cy - size / 2, size };
}
