export const ASPECT_RATIO = 16 / 9;
export const PREFERRED_WIDTH = 1366;
export const MIN_WIDTH = 1024;
const SCREEN_SHARE = 0.9;
const REFERENCE_SCREEN = { width: 1920, height: 1080 };
const SCALE_STEP = 0.25;
const MAX_SCALE = 2;

export interface Size {
  width: number;
  height: number;
}

export function interfaceScale(workArea: Size): number {
  const room = Math.min(workArea.width / REFERENCE_SCREEN.width, workArea.height / REFERENCE_SCREEN.height);
  const stepped = Math.floor(room / SCALE_STEP) * SCALE_STEP;
  return Math.min(MAX_SCALE, Math.max(1, stepped));
}

function scaled(size: Size, factor: number): Size {
  return { width: Math.round(size.width * factor), height: Math.round(size.height * factor) };
}

function largestWindowIn(workArea: Size): Size {
  let width = Math.min(PREFERRED_WIDTH, Math.floor(workArea.width * SCREEN_SHARE));
  let height = Math.round(width / ASPECT_RATIO);
  const maxHeight = Math.floor(workArea.height * SCREEN_SHARE);
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * ASPECT_RATIO);
  }
  return { width, height };
}

export function initialWindowSize(workArea: Size): Size {
  const scale = interfaceScale(workArea);
  return scaled(largestWindowIn(scaled(workArea, 1 / scale)), scale);
}

export function minimumWindowSize(workArea: Size): Size {
  const scale = interfaceScale(workArea);
  const initial = largestWindowIn(scaled(workArea, 1 / scale));
  const width = Math.min(MIN_WIDTH, initial.width);
  return scaled({ width, height: Math.round(width / ASPECT_RATIO) }, scale);
}
