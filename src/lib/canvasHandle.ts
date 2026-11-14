/** Lets toolbar actions reach the canvas (and the descendants fan) without threading refs through the tree. */
export const canvasHandle: {
  exportPng: (() => Promise<void>) | null;
  exportFanPng: (() => Promise<void>) | null;
} = {
  exportPng: null,
  exportFanPng: null,
};
