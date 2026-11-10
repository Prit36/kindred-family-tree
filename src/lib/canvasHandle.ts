/** Lets toolbar actions reach the canvas without threading refs through the tree. */
export const canvasHandle: {
  exportPng: (() => Promise<void>) | null;
} = {
  exportPng: null,
};
