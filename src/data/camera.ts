// Camera tunables (view-side, but kept with the other numbers).

export const CAMERA = {
  fov: 30,
  minPitch: (35 * Math.PI) / 180,
  maxPitch: (65 * Math.PI) / 180,
  minDist: 15,
  maxDist: 200,
  startDist: 90,
  startPitch: (50 * Math.PI) / 180,
  startYaw: (-30 * Math.PI) / 180,
  /** Pan speed in screen-heights per second. */
  panSpeed: 0.9,
  rotateSpeed: 1.6, // rad/s for Q/E
  dragRotate: 0.005, // rad per pixel
  zoomStep: 1.15,
  edgeScrollPx: 6,
  /** Exponential smoothing rate, 1/s. */
  damping: 12,
};
