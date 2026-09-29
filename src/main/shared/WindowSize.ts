export const ASPECT_RATIO = 16 / 9;
export const PREFERRED_WIDTH = 1920;
export const MIN_WIDTH = 1024;
const SCREEN_SHARE = 0.9;

export interface Size {
  width: number;
  height: number;
}

/** The largest 16:9 window up to 1920x1080 that fits in 90% of the work area. */
export function initialWindowSize(workArea: Size): Size {
  let width = Math.min(PREFERRED_WIDTH, Math.floor(workArea.width * SCREEN_SHARE));
  let height = Math.round(width / ASPECT_RATIO);
  const maxHeight = Math.floor(workArea.height * SCREEN_SHARE);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * ASPECT_RATIO);
  }
  return { width, height };
}

export function minimumWindowSize(workArea: Size): Size {
  const initial = initialWindowSize(workArea);
  const width = Math.min(MIN_WIDTH, initial.width);
  return { width, height: Math.round(width / ASPECT_RATIO) };
}

