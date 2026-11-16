/** Lets toolbar actions reach the canvas (and the descendants fan) without threading refs through the tree. */
export const canvasHandle: {
  exportPng: (() => Promise<void>) | null;
  exportFanPng: (() => Promise<void>) | null;
  /**
   * Another family is about to be shown (`apply` makes the change): the canvas animates the
   * move - the family on show goes back into the deck as the other one comes out of it.
   */
  swapLine: ((to: string, apply: () => void) => void) | null;
} = {
  exportPng: null,
  exportFanPng: null,
  swapLine: null,
};

/** Changes the family on show through the canvas, so the move is animated where it can be. */
export function swapLine(to: string, apply: () => void) {
  if (canvasHandle.swapLine) canvasHandle.swapLine(to, apply);
  else apply();
}
