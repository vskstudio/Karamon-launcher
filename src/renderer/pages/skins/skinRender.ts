export type SkinView = 'front' | 'right' | 'back' | 'left';
export type SkinModel = 'classic' | 'slim';

export const SKIN_CANVAS_WIDTH = 16;
export const SKIN_CANVAS_HEIGHT = 32;

type Side = 'front' | 'back' | 'left' | 'right';

interface Cube {
  u: number;
  v: number;
  width: number;
  height: number;
  depth: number;
}

interface Limb {
  base: Cube;
  overlay: Cube | null;
  mirrored: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Placement {
  limb: Limb;
  side: Side;
  x: number;
  y: number;
}

interface Rig {
  head: Limb;
  body: Limb;
  rightArm: Limb;
  leftArm: Limb;
  rightLeg: Limb;
  leftLeg: Limb;
  armWidth: number;
}

function cube(u: number, v: number, width: number, height: number, depth: number): Cube {
  return { u, v, width, height, depth };
}

function faceRect(source: Cube, side: Side): Rect {
  const { u, v, width, height, depth } = source;
  if (side === 'right') return { x: u, y: v + depth, w: depth, h: height };
  if (side === 'front') return { x: u + depth, y: v + depth, w: width, h: height };
  if (side === 'left') return { x: u + depth + width, y: v + depth, w: depth, h: height };
  return { x: u + 2 * depth + width, y: v + depth, w: width, h: height };
}

function mirroredSide(side: Side): Side {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side;
}

function rigOf(image: HTMLImageElement, model: SkinModel): Rig {
  const legacy = image.naturalHeight === 32;
  const arm = !legacy && model === 'slim' ? 3 : 4;
  const head: Limb = { base: cube(0, 0, 8, 8, 8), overlay: cube(32, 0, 8, 8, 8), mirrored: false };
  const rightArmBase = cube(40, 16, arm, 12, 4);
  const rightLegBase = cube(0, 16, 4, 12, 4);
  if (legacy) {
    return {
      head,
      body: { base: cube(16, 16, 8, 12, 4), overlay: null, mirrored: false },
      rightArm: { base: rightArmBase, overlay: null, mirrored: false },
      leftArm: { base: rightArmBase, overlay: null, mirrored: true },
      rightLeg: { base: rightLegBase, overlay: null, mirrored: false },
      leftLeg: { base: rightLegBase, overlay: null, mirrored: true },
      armWidth: arm,
    };
  }
  return {
    head,
    body: { base: cube(16, 16, 8, 12, 4), overlay: cube(16, 32, 8, 12, 4), mirrored: false },
    rightArm: { base: rightArmBase, overlay: cube(40, 32, arm, 12, 4), mirrored: false },
    leftArm: { base: cube(32, 48, arm, 12, 4), overlay: cube(48, 48, arm, 12, 4), mirrored: false },
    rightLeg: { base: rightLegBase, overlay: cube(0, 32, 4, 12, 4), mirrored: false },
    leftLeg: { base: cube(16, 48, 4, 12, 4), overlay: cube(0, 48, 4, 12, 4), mirrored: false },
    armWidth: arm,
  };
}

function placementsFor(rig: Rig, view: SkinView): Placement[] {
  const a = rig.armWidth;
  if (view === 'front') {
    return [
      { limb: rig.head, side: 'front', x: 4, y: 0 },
      { limb: rig.body, side: 'front', x: 4, y: 8 },
      { limb: rig.rightArm, side: 'front', x: 4 - a, y: 8 },
      { limb: rig.leftArm, side: 'front', x: 12, y: 8 },
      { limb: rig.rightLeg, side: 'front', x: 4, y: 20 },
      { limb: rig.leftLeg, side: 'front', x: 8, y: 20 },
    ];
  }
  if (view === 'back') {
    return [
      { limb: rig.head, side: 'back', x: 4, y: 0 },
      { limb: rig.body, side: 'back', x: 4, y: 8 },
      { limb: rig.leftArm, side: 'back', x: 4 - a, y: 8 },
      { limb: rig.rightArm, side: 'back', x: 12, y: 8 },
      { limb: rig.leftLeg, side: 'back', x: 4, y: 20 },
      { limb: rig.rightLeg, side: 'back', x: 8, y: 20 },
    ];
  }
  const arm = view === 'left' ? rig.leftArm : rig.rightArm;
  const leg = view === 'left' ? rig.leftLeg : rig.rightLeg;
  return [
    { limb: rig.head, side: view, x: 4, y: 0 },
    { limb: rig.body, side: view, x: 6, y: 8 },
    { limb: leg, side: view, x: 6, y: 20 },
    { limb: arm, side: view, x: 6, y: 8 },
  ];
}

function drawFace(context: CanvasRenderingContext2D, image: HTMLImageElement, source: Cube, limb: Limb, side: Side, x: number, y: number): void {
  const rect = faceRect(source, limb.mirrored ? mirroredSide(side) : side);
  if (!limb.mirrored) {
    context.drawImage(image, rect.x, rect.y, rect.w, rect.h, x, y, rect.w, rect.h);
    return;
  }
  context.save();
  context.translate(x + rect.w, y);
  context.scale(-1, 1);
  context.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  context.restore();
}

export function drawSkin(canvas: HTMLCanvasElement, image: HTMLImageElement | null, model: SkinModel, view: SkinView): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!image) return;
  const placements = placementsFor(rigOf(image, model), view);
  for (const { limb, side, x, y } of placements) {
    drawFace(context, image, limb.base, limb, side, x, y);
    if (limb.overlay) drawFace(context, image, limb.overlay, limb, side, x, y);
  }
}

export function detectModel(image: HTMLImageElement): SkinModel {
  if (image.naturalWidth !== 64 || image.naturalHeight !== 64) return 'classic';
  const probe = document.createElement('canvas');
  probe.width = 64;
  probe.height = 64;
  const context = probe.getContext('2d');
  if (!context) return 'classic';
  try {
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(54, 20, 2, 12).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) return 'classic';
    }
    return 'slim';
  } catch {
    return 'classic';
  }
}

function loadImage(url: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = url;
  });
}

export function loadSkinImage(url: string): Promise<HTMLImageElement> {
  if (url.startsWith('data:')) return loadImage(url, false);
  return loadImage(url, true).catch(() => loadImage(url, false));
}
